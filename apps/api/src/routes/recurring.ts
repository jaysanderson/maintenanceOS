import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { prisma } from "../prisma.js";
import { parse } from "../lib/validate.js";
import { notFound } from "../lib/errors.js";
import { nextWorkOrderNumber } from "../lib/numbering.js";
import { audit } from "../lib/audit.js";
import { notify } from "../lib/notify.js";
import { JOB_TYPES, PRIORITIES } from "../lib/enums.js";

const upsertSchema = z.object({
  accountId: z.string().min(1),
  siteId: z.string().min(1),
  title: z.string().min(1),
  description: z.string().optional().nullable(),
  jobType: z.enum(JOB_TYPES).default("RECURRING_SERVICE"),
  priority: z.enum(PRIORITIES).default("NORMAL"),
  intervalDays: z.number().int().positive(),
  nextRunAt: z.coerce.date().optional(),
  active: z.boolean().optional(),
});

export async function recurringRoutes(app: FastifyInstance) {
  app.get("/", { schema: { tags: ["Recurring"], summary: "List recurring plans" } }, async () =>
    prisma.recurringPlan.findMany({
      include: { account: true, site: true },
      orderBy: { nextRunAt: "asc" },
    })
  );

  app.post("/", { schema: { tags: ["Recurring"], summary: "Create recurring plan" } }, async (req, reply) => {
    const b = parse(upsertSchema, req.body);
    const plan = await prisma.recurringPlan.create({
      data: {
        accountId: b.accountId,
        siteId: b.siteId,
        title: b.title,
        description: b.description ?? null,
        jobType: b.jobType,
        priority: b.priority,
        intervalDays: b.intervalDays,
        nextRunAt: b.nextRunAt ?? new Date(),
        active: b.active ?? true,
      },
      include: { account: true, site: true },
    });
    reply.status(201);
    return plan;
  });

  app.put("/:id", { schema: { tags: ["Recurring"], summary: "Update recurring plan" } }, async (req) => {
    const { id } = req.params as { id: string };
    const existing = await prisma.recurringPlan.findUnique({ where: { id } });
    if (!existing) throw notFound("Recurring plan");
    const b = parse(upsertSchema.partial(), req.body);
    return prisma.recurringPlan.update({
      where: { id },
      data: b,
      include: { account: true, site: true },
    });
  });

  app.delete("/:id", { schema: { tags: ["Recurring"], summary: "Delete recurring plan" } }, async (req, reply) => {
    const { id } = req.params as { id: string };
    await prisma.recurringPlan.deleteMany({ where: { id } });
    reply.status(204);
    return null;
  });

  // Generate work orders for any plan whose nextRunAt is due.
  app.post("/run", { schema: { tags: ["Recurring"], summary: "Generate due recurring work orders" } }, async (req) => {
    const now = new Date();
    const due = await prisma.recurringPlan.findMany({
      where: { active: true, nextRunAt: { lte: now } },
    });
    const created: string[] = [];
    for (const plan of due) {
      const number = await nextWorkOrderNumber();
      await prisma.workOrder.create({
        data: {
          workOrderNumber: number,
          accountId: plan.accountId,
          siteId: plan.siteId,
          title: plan.title,
          description: plan.description,
          jobType: plan.jobType,
          priority: plan.priority,
          status: "NEW",
          slaDueAt: new Date(now.getTime() + plan.intervalDays * 86400000),
        },
      });
      await prisma.recurringPlan.update({
        where: { id: plan.id },
        data: {
          lastGeneratedAt: now,
          nextRunAt: new Date(
            now.getTime() + plan.intervalDays * 86400000
          ),
        },
      });
      created.push(number);
    }
    if (created.length) {
      await audit(req.authUser, {
        action: "RECURRING_GENERATED",
        summary: `Generated ${created.length} recurring work orders`,
        meta: created,
      });
      await notify({
        type: "RECURRING_GENERATED",
        message: `${created.length} recurring work order(s) generated: ${created.join(", ")}`,
      });
    }
    return { generated: created.length, workOrderNumbers: created };
  });
}
