import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { prisma } from "../prisma.js";
import { parse } from "../lib/validate.js";
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

export async function assetRoutes(app: FastifyInstance) {
  app.get("/", { schema: { tags: ["Assets"], summary: "List assets" } }, async () =>
    prisma.asset.findMany({
      orderBy: { name: "asc" },
      include: { assignedEmployee: true, assignedVehicle: true },
    })
  );

  app.post("/", { schema: { tags: ["Assets"], summary: "Create asset" } }, async (req, reply) => {
    const data = parse(upsertSchema, req.body);
    reply.status(201);
    return prisma.asset.create({ data });
  });

  app.put("/:id", { schema: { tags: ["Assets"], summary: "Update asset" } }, async (req) => {
    const { id } = req.params as { id: string };
    const existing = await prisma.asset.findUnique({ where: { id } });
    if (!existing) throw notFound("Asset");
    const data = parse(upsertSchema.partial(), req.body);
    return prisma.asset.update({ where: { id }, data });
  });
}
