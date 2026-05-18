import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { prisma } from "../prisma.js";
import { notFound } from "../lib/errors.js";

const idParam = z.object({ id: z.string() });
const listQuery = z.object({
  accountId: z.string().optional(),
});

const upsertSchema = z.object({
  accountId: z.string().min(1),
  name: z.string().min(1),
  address: z.string().min(1),
  suburb: z.string().min(1),
  state: z.string().min(1),
  postcode: z.string().min(1),
  accessNotes: z.string().optional().nullable(),
  siteContactName: z.string().optional().nullable(),
  siteContactPhone: z.string().optional().nullable(),
  petsOnSite: z.boolean().optional(),
  preferredVisitWindow: z.string().optional().nullable(),
});

export async function siteRoutes(app: FastifyInstance) {
  app.get("/", { schema: { tags: ["Sites"], summary: "List sites (optionally by account)", querystring: listQuery } }, async (req) => {
    const { accountId } = req.query as z.infer<typeof listQuery>;
    return prisma.site.findMany({
      where: accountId ? { accountId } : {},
      orderBy: { name: "asc" },
      include: { account: true, _count: { select: { workOrders: true } } },
    });
  });

  app.get("/:id", { schema: { tags: ["Sites"], summary: "Get site with account & work orders", params: idParam } }, async (req) => {
    const { id } = req.params as z.infer<typeof idParam>;
    const site = await prisma.site.findUnique({
      where: { id },
      include: {
        account: true,
        workOrders: { orderBy: { createdAt: "desc" }, include: { assignedEmployee: true } },
      },
    });
    if (!site) throw notFound("Site");
    return site;
  });

  app.post("/", { schema: { tags: ["Sites"], summary: "Create site", body: upsertSchema } }, async (req, reply) => {
    const data = req.body as z.infer<typeof upsertSchema>;
    reply.status(201);
    return prisma.site.create({ data });
  });

  app.put("/:id", { schema: { tags: ["Sites"], summary: "Update site", params: idParam, body: upsertSchema.partial() } }, async (req) => {
    const { id } = req.params as z.infer<typeof idParam>;
    const data = req.body as Partial<z.infer<typeof upsertSchema>>;
    const existing = await prisma.site.findUnique({ where: { id } });
    if (!existing) throw notFound("Site");
    return prisma.site.update({ where: { id }, data });
  });

  app.delete("/:id", { schema: { tags: ["Sites"], summary: "Delete site", params: idParam } }, async (req, reply) => {
    const { id } = req.params as z.infer<typeof idParam>;
    const existing = await prisma.site.findUnique({ where: { id } });
    if (!existing) throw notFound("Site");
    await prisma.site.delete({ where: { id } });
    reply.status(204);
    return null;
  });
}
