import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { prisma } from "../prisma.js";
import { parse } from "../lib/validate.js";
import { notFound } from "../lib/errors.js";

const upsertSchema = z.object({
  name: z.string().min(1),
  contactName: z.string().optional().nullable(),
  email: z.string().email().optional().nullable(),
  phone: z.string().optional().nullable(),
  address: z.string().optional().nullable(),
  paymentTerms: z.string().optional().nullable(),
  notes: z.string().optional().nullable(),
});

export async function supplierRoutes(app: FastifyInstance) {
  app.get("/", { schema: { tags: ["Suppliers"], summary: "List suppliers" } }, async () =>
    prisma.supplier.findMany({
      orderBy: { name: "asc" },
      include: { _count: { select: { purchaseOrders: true } } },
    })
  );

  app.get("/:id", { schema: { tags: ["Suppliers"], summary: "Get supplier" } }, async (req) => {
    const { id } = req.params as { id: string };
    const supplier = await prisma.supplier.findUnique({
      where: { id },
      include: { purchaseOrders: { orderBy: { createdAt: "desc" } } },
    });
    if (!supplier) throw notFound("Supplier");
    return supplier;
  });

  app.post("/", { schema: { tags: ["Suppliers"], summary: "Create supplier" } }, async (req, reply) => {
    const data = parse(upsertSchema, req.body);
    reply.status(201);
    return prisma.supplier.create({ data });
  });

  app.put("/:id", { schema: { tags: ["Suppliers"], summary: "Update supplier" } }, async (req) => {
    const { id } = req.params as { id: string };
    const existing = await prisma.supplier.findUnique({ where: { id } });
    if (!existing) throw notFound("Supplier");
    const data = parse(upsertSchema.partial(), req.body);
    return prisma.supplier.update({ where: { id }, data });
  });
}
