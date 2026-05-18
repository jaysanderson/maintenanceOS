import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { prisma } from "../prisma.js";
import { notFound, badRequest } from "../lib/errors.js";
import { nextPurchaseOrderNumber } from "../lib/numbering.js";
import { round } from "../lib/costing.js";

const lineSchema = z.object({
  inventoryItemId: z.string().min(1),
  quantity: z.number().positive(),
  unitCost: z.number().nonnegative(),
});

const createSchema = z.object({
  supplierId: z.string().min(1),
  expectedDate: z.coerce.date().optional().nullable(),
  notes: z.string().optional().nullable(),
  lines: z.array(lineSchema).min(1),
});

const idParam = z.object({ id: z.string() });
const listQuery = z.object({
  status: z.string().optional(),
});
const updateSchema = z.object({
  status: z.enum(["DRAFT", "SENT", "PART_RECEIVED", "RECEIVED", "CANCELLED"]).optional(),
  expectedDate: z.coerce.date().optional().nullable(),
  notes: z.string().optional().nullable(),
});
const receiveSchema = z.object({
  toLocationId: z.string().min(1),
  lines: z
    .array(z.object({ lineId: z.string(), quantity: z.number().positive() }))
    .optional(),
});

const poInclude = {
  supplier: true,
  lines: { include: { inventoryItem: true } },
};

export async function purchaseOrderRoutes(app: FastifyInstance) {
  app.get("/", { schema: { tags: ["Purchase Orders"], summary: "List purchase orders (filter by status)", querystring: listQuery } }, async (req) => {
    const { status } = req.query as z.infer<typeof listQuery>;
    return prisma.purchaseOrder.findMany({
      where: status ? { status } : {},
      orderBy: { createdAt: "desc" },
      include: poInclude,
    });
  });

  app.get("/:id", { schema: { tags: ["Purchase Orders"], summary: "Get purchase order", params: idParam } }, async (req) => {
    const { id } = req.params as z.infer<typeof idParam>;
    const po = await prisma.purchaseOrder.findUnique({ where: { id }, include: poInclude });
    if (!po) throw notFound("Purchase order");
    return po;
  });

  app.post("/", { schema: { tags: ["Purchase Orders"], summary: "Create purchase order", body: createSchema } }, async (req, reply) => {
    const data = req.body as z.infer<typeof createSchema>;
    const supplier = await prisma.supplier.findUnique({ where: { id: data.supplierId } });
    if (!supplier) throw notFound("Supplier");
    const po = await prisma.purchaseOrder.create({
      data: {
        poNumber: await nextPurchaseOrderNumber(),
        supplierId: data.supplierId,
        expectedDate: data.expectedDate,
        notes: data.notes,
        status: "DRAFT",
        lines: {
          create: data.lines.map((l) => ({
            inventoryItemId: l.inventoryItemId,
            quantity: l.quantity,
            unitCost: l.unitCost,
            total: round(l.quantity * l.unitCost),
          })),
        },
      },
      include: poInclude,
    });
    reply.status(201);
    return po;
  });

  app.put("/:id", { schema: { tags: ["Purchase Orders"], summary: "Update PO status/details", params: idParam, body: updateSchema } }, async (req) => {
    const { id } = req.params as z.infer<typeof idParam>;
    const existing = await prisma.purchaseOrder.findUnique({ where: { id } });
    if (!existing) throw notFound("Purchase order");
    const data = req.body as z.infer<typeof updateSchema>;
    return prisma.purchaseOrder.update({ where: { id }, data, include: poInclude });
  });

  // Receive stock into a location → creates PURCHASE_RECEIPT movements.
  app.post("/:id/receive", { schema: { tags: ["Purchase Orders"], summary: "Receive PO stock into a location", params: idParam, body: receiveSchema } }, async (req) => {
    const { id } = req.params as z.infer<typeof idParam>;
    const { toLocationId, lines } = req.body as z.infer<typeof receiveSchema>;
    const po = await prisma.purchaseOrder.findUnique({ where: { id }, include: { lines: true } });
    if (!po) throw notFound("Purchase order");
    const location = await prisma.inventoryLocation.findUnique({ where: { id: toLocationId } });
    if (!location) throw notFound("Inventory location");

    const receiveMap = new Map<string, number>();
    if (lines) {
      for (const l of lines) receiveMap.set(l.lineId, l.quantity);
    } else {
      for (const l of po.lines) receiveMap.set(l.id, l.quantity - l.receivedQty);
    }

    for (const line of po.lines) {
      const qty = receiveMap.get(line.id) ?? 0;
      if (qty <= 0) continue;
      if (line.receivedQty + qty > line.quantity) {
        throw badRequest(`Receiving more than ordered for line ${line.id}`);
      }
      await prisma.stockMovement.create({
        data: {
          inventoryItemId: line.inventoryItemId,
          toLocationId,
          workOrderId: null,
          quantity: qty,
          movementType: "PURCHASE_RECEIPT",
          notes: `Received against ${po.poNumber}`,
        },
      });
      await prisma.purchaseOrderLine.update({
        where: { id: line.id },
        data: { receivedQty: line.receivedQty + qty },
      });
    }

    const refreshed = await prisma.purchaseOrder.findUnique({
      where: { id },
      include: { lines: true },
    });
    const allReceived = refreshed!.lines.every((l) => l.receivedQty >= l.quantity);
    const anyReceived = refreshed!.lines.some((l) => l.receivedQty > 0);
    const status = allReceived ? "RECEIVED" : anyReceived ? "PART_RECEIVED" : po.status;
    return prisma.purchaseOrder.update({
      where: { id },
      data: { status },
      include: poInclude,
    });
  });
}
