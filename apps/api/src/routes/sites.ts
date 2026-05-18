import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { prisma } from "../prisma.js";
import { parse } from "../lib/validate.js";
import { notFound } from "../lib/errors.js";

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
  app.get("/", { schema: { tags: ["Sites"], summary: "List sites" } }, async (req) => {
    const { accountId } = req.query as { accountId?: string };
    return prisma.site.findMany({
      where: accountId ? { accountId } : {},
      orderBy: { name: "asc" },
      include: { account: true, _count: { select: { workOrders: true } } },
    });
  });

  app.get("/:id", { schema: { tags: ["Sites"], summary: "Get site" } }, async (req) => {
    const { id } = req.params as { id: string };
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

  app.post("/", { schema: { tags: ["Sites"], summary: "Create site" } }, async (req, reply) => {
    const data = parse(upsertSchema, req.body);
    reply.status(201);
    return prisma.site.create({ data });
  });

  app.put("/:id", { schema: { tags: ["Sites"], summary: "Update site" } }, async (req) => {
    const { id } = req.params as { id: string };
    const data = parse(upsertSchema.partial(), req.body);
    const existing = await prisma.site.findUnique({ where: { id } });
    if (!existing) throw notFound("Site");
    return prisma.site.update({ where: { id }, data });
  });

  app.delete("/:id", { schema: { tags: ["Sites"], summary: "Delete site" } }, async (req, reply) => {
    const { id } = req.params as { id: string };
    const existing = await prisma.site.findUnique({ where: { id } });
    if (!existing) throw notFound("Site");
    await prisma.site.delete({ where: { id } });
    reply.status(204);
    return null;
  });
}
