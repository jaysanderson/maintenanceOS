import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { prisma } from "../prisma.js";
import { parse } from "../lib/validate.js";

const skillSchema = z.object({
  name: z.string().min(1),
  category: z.string().optional().nullable(),
});

export async function skillRoutes(app: FastifyInstance) {
  app.get("/skills", { schema: { tags: ["Skills"], summary: "List skills" } }, async () => {
    return prisma.skill.findMany({
      orderBy: { name: "asc" },
      include: { _count: { select: { employees: true } } },
    });
  });

  app.post("/skills", { schema: { tags: ["Skills"], summary: "Create skill" } }, async (req, reply) => {
    const data = parse(skillSchema, req.body);
    reply.status(201);
    return prisma.skill.create({ data });
  });
}
