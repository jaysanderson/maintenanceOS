import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { prisma } from "../prisma.js";

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

  app.post("/skills", { schema: { tags: ["Skills"], summary: "Create skill", body: skillSchema } }, async (req, reply) => {
    const data = req.body as z.infer<typeof skillSchema>;
    reply.status(201);
    return prisma.skill.create({ data });
  });
}
