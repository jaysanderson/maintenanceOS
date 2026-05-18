import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { prisma } from "../prisma.js";
import { parse } from "../lib/validate.js";
import { notFound } from "../lib/errors.js";
import { EMPLOYEE_ROLES, EMPLOYMENT_TYPES } from "../lib/enums.js";

const upsertSchema = z.object({
  firstName: z.string().min(1),
  lastName: z.string().min(1),
  role: z.enum(EMPLOYEE_ROLES),
  email: z.string().email().optional().nullable(),
  phone: z.string().optional().nullable(),
  hourlyCost: z.number().nonnegative().default(0),
  employmentType: z.enum(EMPLOYMENT_TYPES),
  territory: z.string().optional().nullable(),
  active: z.boolean().optional(),
});

export async function employeeRoutes(app: FastifyInstance) {
  app.get("/", { schema: { tags: ["Employees"], summary: "List employees" } }, async (req) => {
    const { role, active } = req.query as { role?: string; active?: string };
    return prisma.employee.findMany({
      where: {
        ...(role ? { role } : {}),
        ...(active !== undefined ? { active: active === "true" } : {}),
      },
      orderBy: [{ active: "desc" }, { lastName: "asc" }],
      include: {
        skills: { include: { skill: true } },
        _count: { select: { workOrders: true } },
      },
    });
  });

  app.get("/:id", { schema: { tags: ["Employees"], summary: "Get employee" } }, async (req) => {
    const { id } = req.params as { id: string };
    const employee = await prisma.employee.findUnique({
      where: { id },
      include: {
        skills: { include: { skill: true } },
        workOrders: { orderBy: { createdAt: "desc" }, include: { account: true, site: true } },
        vehicles: true,
        assets: true,
      },
    });
    if (!employee) throw notFound("Employee");
    return employee;
  });

  app.post("/", { schema: { tags: ["Employees"], summary: "Create employee" } }, async (req, reply) => {
    const data = parse(upsertSchema, req.body);
    reply.status(201);
    return prisma.employee.create({ data });
  });

  app.put("/:id", { schema: { tags: ["Employees"], summary: "Update employee" } }, async (req) => {
    const { id } = req.params as { id: string };
    const data = parse(upsertSchema.partial(), req.body);
    const existing = await prisma.employee.findUnique({ where: { id } });
    if (!existing) throw notFound("Employee");
    return prisma.employee.update({ where: { id }, data });
  });

  app.delete("/:id", { schema: { tags: ["Employees"], summary: "Delete employee" } }, async (req, reply) => {
    const { id } = req.params as { id: string };
    const existing = await prisma.employee.findUnique({ where: { id } });
    if (!existing) throw notFound("Employee");
    await prisma.employee.delete({ where: { id } });
    reply.status(204);
    return null;
  });

  // POST /api/employees/:id/skills  { skillId }
  app.post("/:id/skills", { schema: { tags: ["Employees"], summary: "Assign skill to employee" } }, async (req, reply) => {
    const { id } = req.params as { id: string };
    const { skillId } = parse(z.object({ skillId: z.string().min(1) }), req.body);
    const employee = await prisma.employee.findUnique({ where: { id } });
    if (!employee) throw notFound("Employee");
    const link = await prisma.employeeSkill.upsert({
      where: { employeeId_skillId: { employeeId: id, skillId } },
      create: { employeeId: id, skillId },
      update: {},
      include: { skill: true },
    });
    reply.status(201);
    return link;
  });

  app.delete("/:id/skills/:skillId", { schema: { tags: ["Employees"], summary: "Remove skill from employee" } }, async (req, reply) => {
    const { id, skillId } = req.params as { id: string; skillId: string };
    await prisma.employeeSkill.deleteMany({ where: { employeeId: id, skillId } });
    reply.status(204);
    return null;
  });
}
