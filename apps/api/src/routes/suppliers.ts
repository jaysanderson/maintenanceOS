import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { prisma } from "../prisma.js";
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

const idParam = z.object({ id: z.string() });

export async function supplierRoutes(app: FastifyInstance) {
  app.get("/", { schema: { tags: ["Suppliers"], summary: "List suppliers" } }, async () =>
    prisma.supplier.findMany({
      orderBy: { name: "asc" },
      include: { _count: { select: { purchaseOrders: true } } },
    })
  );

  app.get("/:id", { schema: { tags: ["Suppliers"], summary: "Get supplier with purchase orders", params: idParam } }, async (req) => {
    const { id } = req.params as z.infer<typeof idParam>;
    const supplier = await prisma.supplier.findUnique({
      where: { id },
      include: { purchaseOrders: { orderBy: { createdAt: "desc" } } },
    });
    if (!supplier) throw notFound("Supplier");
    return supplier;
  });

  app.post("/", { schema: { tags: ["Suppliers"], summary: "Create supplier", body: upsertSchema } }, async (req, reply) => {
    const data = req.body as z.infer<typeof upsertSchema>;
    reply.status(201);
    return prisma.supplier.create({ data });
  });

  app.put("/:id", { schema: { tags: ["Suppliers"], summary: "Update supplier", params: idParam, body: upsertSchema.partial() } }, async (req) => {
    const { id } = req.params as z.infer<typeof idParam>;
    const existing = await prisma.supplier.findUnique({ where: { id } });
    if (!existing) throw notFound("Supplier");
    const data = req.body as Partial<z.infer<typeof upsertSchema>>;
    return prisma.supplier.update({ where: { id }, data });
  });
}
