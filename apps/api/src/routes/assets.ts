import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { prisma } from "../prisma.js";
import { notFound } from "../lib/errors.js";
import { ASSET_TYPES, ASSET_STATUSES } from "../lib/enums.js";

const upsertSchema = z.object({
  name: z.string().min(1),
  assetType: z.enum(ASSET_TYPES),
  serialNumber: z.string().optional().nullable(),
  assignedEmployeeId: z.string().optional().nullable(),
  assignedVehicleId: z.string().optional().nullable(),
  status: z.enum(ASSET_STATUSES).optional(),
  serviceDueAt: z.coerce.date().optional().nullable(),
});

const idParam = z.object({ id: z.string() });

export async function assetRoutes(app: FastifyInstance) {
  app.get("/", { schema: { tags: ["Assets"], summary: "List assets" } }, async () =>
    prisma.asset.findMany({
      orderBy: { name: "asc" },
      include: { assignedEmployee: true, assignedVehicle: true },
    })
  );

  app.post("/", { schema: { tags: ["Assets"], summary: "Create asset", body: upsertSchema } }, async (req, reply) => {
    const data = req.body as z.infer<typeof upsertSchema>;
    reply.status(201);
    return prisma.asset.create({ data });
  });

  app.put("/:id", { schema: { tags: ["Assets"], summary: "Update asset", params: idParam, body: upsertSchema.partial() } }, async (req) => {
    const { id } = req.params as z.infer<typeof idParam>;
    const existing = await prisma.asset.findUnique({ where: { id } });
    if (!existing) throw notFound("Asset");
    const data = req.body as Partial<z.infer<typeof upsertSchema>>;
    return prisma.asset.update({ where: { id }, data });
  });
}
