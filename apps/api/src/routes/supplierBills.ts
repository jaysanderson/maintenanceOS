import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { prisma } from "../prisma.js";
import { notFound } from "../lib/errors.js";
import { nextSupplierBillNumber } from "../lib/numbering.js";
import { round } from "../lib/costing.js";

// Accounts-payable: a bill RECEIVED from a supplier (the money we owe), as
// opposed to a Purchase Order (what we ordered) or an Invoice (what we bill
// customers). Lines may or may not match an inventory item — a bill line can
// be a freight/labour/service charge — so inventoryItemId is optional and the
// extracted `description` is always carried.
const lineSchema = z.object({
  inventoryItemId: z.string().min(1).optional().nullable(),
  description: z.string().min(1),
  quantity: z.number().positive(),
  unitCost: z.number().nonnegative(),
});

const createSchema = z.object({
  supplierId: z.string().min(1),
  supplierRef: z.string().optional().nullable(),
  purchaseOrderId: z.string().optional().nullable(),
  issueDate: z.coerce.date().optional().nullable(),
  dueDate: z.coerce.date().optional().nullable(),
  tax: z.number().nonnegative().optional(),
  notes: z.string().optional().nullable(),
  lines: z.array(lineSchema).min(1),
});

const idParam = z.object({ id: z.string() });
const listQuery = z.object({ status: z.string().optional() });
const updateSchema = z.object({
  status: z.enum(["DRAFT", "APPROVED", "PAID", "DISPUTED", "VOID"]).optional(),
  supplierRef: z.string().optional().nullable(),
  issueDate: z.coerce.date().optional().nullable(),
  dueDate: z.coerce.date().optional().nullable(),
  notes: z.string().optional().nullable(),
});

const billInclude = {
  supplier: true,
  purchaseOrder: { select: { id: true, poNumber: true } },
  lines: { include: { inventoryItem: true } },
};

export async function supplierBillRoutes(app: FastifyInstance) {
  app.get(
    "/",
    { schema: { tags: ["Supplier Bills"], summary: "List supplier bills (AP, filter by status)", querystring: listQuery } },
    async (req) => {
      const { status } = req.query as z.infer<typeof listQuery>;
      return prisma.supplierBill.findMany({
        where: status ? { status } : {},
        orderBy: { createdAt: "desc" },
        include: billInclude,
      });
    }
  );

  app.get(
    "/:id",
    { schema: { tags: ["Supplier Bills"], summary: "Get supplier bill", params: idParam } },
    async (req) => {
      const { id } = req.params as z.infer<typeof idParam>;
      const bill = await prisma.supplierBill.findUnique({ where: { id }, include: billInclude });
      if (!bill) throw notFound("Supplier bill");
      return bill;
    }
  );

  app.post(
    "/",
    { schema: { tags: ["Supplier Bills"], summary: "Create a supplier bill (AP)", body: createSchema } },
    async (req, reply) => {
      const data = req.body as z.infer<typeof createSchema>;
      const supplier = await prisma.supplier.findUnique({ where: { id: data.supplierId } });
      if (!supplier) throw notFound("Supplier");

      const lines = data.lines.map((l) => ({
        inventoryItemId: l.inventoryItemId || null,
        description: l.description,
        quantity: l.quantity,
        unitCost: l.unitCost,
        total: round(l.quantity * l.unitCost),
      }));
      const subtotal = round(lines.reduce((s, l) => s + l.total, 0));
      const tax = round(data.tax ?? 0);
      const total = round(subtotal + tax);

      const bill = await prisma.supplierBill.create({
        data: {
          billNumber: await nextSupplierBillNumber(),
          supplierId: data.supplierId,
          supplierRef: data.supplierRef ?? null,
          purchaseOrderId: data.purchaseOrderId ?? null,
          issueDate: data.issueDate ?? null,
          dueDate: data.dueDate ?? null,
          notes: data.notes ?? null,
          status: "DRAFT",
          subtotal,
          tax,
          total,
          lines: { create: lines },
        },
        include: billInclude,
      });
      reply.status(201);
      return bill;
    }
  );

  app.put(
    "/:id",
    { schema: { tags: ["Supplier Bills"], summary: "Update supplier bill status/details", params: idParam, body: updateSchema } },
    async (req) => {
      const { id } = req.params as z.infer<typeof idParam>;
      const existing = await prisma.supplierBill.findUnique({ where: { id } });
      if (!existing) throw notFound("Supplier bill");
      const data = req.body as z.infer<typeof updateSchema>;
      return prisma.supplierBill.update({ where: { id }, data, include: billInclude });
    }
  );
}
