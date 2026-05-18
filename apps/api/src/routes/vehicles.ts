import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { prisma } from "../prisma.js";
import { parse } from "../lib/validate.js";
import { notFound } from "../lib/errors.js";

const upsertSchema = z.object({
  name: z.string().min(1),
  registration: z.string().min(1),
  assignedEmployeeId: z.string().optional().nullable(),
  make: z.string().optional().nullable(),
  model: z.string().optional().nullable(),
  year: z.number().int().optional().nullable(),
  odometer: z.number().int().nonnegative().optional(),
  serviceDueAt: z.coerce.date().optional().nullable(),
  registrationDueAt: z.coerce.date().optional().nullable(),
  active: z.boolean().optional(),
});

export async function vehicleRoutes(app: FastifyInstance) {
  app.get("/", { schema: { tags: ["Vehicles"], summary: "List vehicles" } }, async () => {
    const vehicles = await prisma.vehicle.findMany({
      orderBy: { name: "asc" },
      include: { assignedEmployee: true, assets: true },
    });
    const soon = new Date(Date.now() + 30 * 86400000);
    return vehicles.map((v) => ({
      ...v,
      serviceDueSoon: !!v.serviceDueAt && new Date(v.serviceDueAt) < soon,
      registrationDueSoon: !!v.registrationDueAt && new Date(v.registrationDueAt) < soon,
    }));
  });

  app.post("/", { schema: { tags: ["Vehicles"], summary: "Create vehicle" } }, async (req, reply) => {
    const data = parse(upsertSchema, req.body);
    reply.status(201);
    return prisma.vehicle.create({ data });
  });

  app.put("/:id", { schema: { tags: ["Vehicles"], summary: "Update vehicle" } }, async (req) => {
    const { id } = req.params as { id: string };
    const existing = await prisma.vehicle.findUnique({ where: { id } });
    if (!existing) throw notFound("Vehicle");
    const data = parse(upsertSchema.partial(), req.body);
    return prisma.vehicle.update({ where: { id }, data });
  });
}
