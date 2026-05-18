import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { prisma } from "../prisma.js";
import { notFound } from "../lib/errors.js";
import { computeStockLevels } from "../lib/costing.js";
import { LOCATION_TYPES, MOVEMENT_TYPES } from "../lib/enums.js";

const itemSchema = z.object({
  sku: z.string().min(1),
  name: z.string().min(1),
  category: z.string().optional().nullable(),
  unit: z.string().default("EA"),
  unitCost: z.number().nonnegative().default(0),
  sellPrice: z.number().nonnegative().default(0),
  reorderPoint: z.number().nonnegative().default(0),
  active: z.boolean().optional(),
});

const locationSchema = z.object({
  name: z.string().min(1),
  type: z.enum(LOCATION_TYPES),
});

const movementSchema = z.object({
  inventoryItemId: z.string().min(1),
  fromLocationId: z.string().optional().nullable(),
  toLocationId: z.string().optional().nullable(),
  workOrderId: z.string().optional().nullable(),
  quantity: z.number().positive(),
  movementType: z.enum(MOVEMENT_TYPES),
  notes: z.string().optional().nullable(),
});

const idParam = z.object({ id: z.string() });
const movementsQuery = z.object({
  workOrderId: z.string().optional(),
});

export async function inventoryRoutes(app: FastifyInstance) {
  app.get("/items", { schema: { tags: ["Inventory"], summary: "List inventory items" } }, async () =>
    prisma.inventoryItem.findMany({ orderBy: { name: "asc" } })
  );

  app.get("/items/:id", { schema: { tags: ["Inventory"], summary: "Get inventory item with movements", params: idParam } }, async (req) => {
    const { id } = req.params as z.infer<typeof idParam>;
    const item = await prisma.inventoryItem.findUnique({
      where: { id },
      include: { movements: { include: { fromLocation: true, toLocation: true }, orderBy: { createdAt: "desc" } } },
    });
    if (!item) throw notFound("Inventory item");
    return item;
  });

  app.post("/items", { schema: { tags: ["Inventory"], summary: "Create inventory item", body: itemSchema } }, async (req, reply) => {
    const data = req.body as z.infer<typeof itemSchema>;
    reply.status(201);
    return prisma.inventoryItem.create({ data });
  });

  app.put("/items/:id", { schema: { tags: ["Inventory"], summary: "Update inventory item", params: idParam, body: itemSchema.partial() } }, async (req) => {
    const { id } = req.params as z.infer<typeof idParam>;
    const existing = await prisma.inventoryItem.findUnique({ where: { id } });
    if (!existing) throw notFound("Inventory item");
    const data = req.body as Partial<z.infer<typeof itemSchema>>;
    return prisma.inventoryItem.update({ where: { id }, data });
  });

  app.get("/locations", { schema: { tags: ["Inventory"], summary: "List locations" } }, async () =>
    prisma.inventoryLocation.findMany({ orderBy: { name: "asc" } })
  );

  app.post("/locations", { schema: { tags: ["Inventory"], summary: "Create location", body: locationSchema } }, async (req, reply) => {
    const data = req.body as z.infer<typeof locationSchema>;
    reply.status(201);
    return prisma.inventoryLocation.create({ data });
  });

  app.get("/stock-levels", { schema: { tags: ["Inventory"], summary: "Stock by item & location" } }, async () =>
    computeStockLevels()
  );

  app.get("/low-stock", { schema: { tags: ["Inventory"], summary: "Items below reorder point" } }, async () => {
    const levels = await computeStockLevels();
    return levels.filter((l) => l.lowStock);
  });

  app.get("/movements", { schema: { tags: ["Inventory"], summary: "List stock movements (optionally by work order)", querystring: movementsQuery } }, async (req) => {
    const { workOrderId } = req.query as z.infer<typeof movementsQuery>;
    return prisma.stockMovement.findMany({
      where: workOrderId ? { workOrderId } : {},
      orderBy: { createdAt: "desc" },
      include: { inventoryItem: true, fromLocation: true, toLocation: true, workOrder: true },
    });
  });

  app.post("/movements", { schema: { tags: ["Inventory"], summary: "Record stock movement (incl. consume on job)", body: movementSchema } }, async (req, reply) => {
    const data = req.body as z.infer<typeof movementSchema>;
    const item = await prisma.inventoryItem.findUnique({ where: { id: data.inventoryItemId } });
    if (!item) throw notFound("Inventory item");
    reply.status(201);
    return prisma.stockMovement.create({
      data,
      include: { inventoryItem: true, fromLocation: true, toLocation: true },
    });
  });
}
