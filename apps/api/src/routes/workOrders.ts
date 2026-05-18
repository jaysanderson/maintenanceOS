import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { prisma } from "../prisma.js";
import { notFound, badRequest, conflict } from "../lib/errors.js";
import { nextWorkOrderNumber } from "../lib/numbering.js";
import { computeJobCosting } from "../lib/costing.js";
import { JOB_TYPES, PRIORITIES, WORK_ORDER_STATUSES } from "../lib/enums.js";
import { audit } from "../lib/audit.js";

// Allowed forward transitions. Any open status may also go to CANCELLED;
// terminal states (INVOICED/CLOSED/CANCELLED) are locked.
const TRANSITIONS: Record<string, string[]> = {
  NEW: ["TRIAGE", "QUOTE_REQUIRED", "SCHEDULED", "CANCELLED"],
  TRIAGE: ["QUOTE_REQUIRED", "AWAITING_APPROVAL", "SCHEDULED", "CANCELLED"],
  QUOTE_REQUIRED: ["AWAITING_APPROVAL", "CANCELLED"],
  AWAITING_APPROVAL: ["APPROVED", "QUOTE_REQUIRED", "CANCELLED"],
  APPROVED: ["SCHEDULED", "DISPATCHED", "CANCELLED"],
  SCHEDULED: ["DISPATCHED", "IN_PROGRESS", "WAITING_ON_PARTS", "CANCELLED"],
  DISPATCHED: ["IN_PROGRESS", "WAITING_ON_PARTS", "CANCELLED"],
  IN_PROGRESS: ["WAITING_ON_PARTS", "COMPLETED", "CANCELLED"],
  WAITING_ON_PARTS: ["IN_PROGRESS", "COMPLETED", "CANCELLED"],
  COMPLETED: ["INVOICED", "CLOSED"],
  INVOICED: ["CLOSED"],
  CLOSED: [],
  CANCELLED: [],
};

function assertTransition(from: string, to: string) {
  if (from === to) return;
  const allowed = TRANSITIONS[from] ?? [];
  if (!allowed.includes(to)) {
    throw badRequest(
      `Invalid status change ${from} → ${to}. Allowed: ${allowed.join(", ") || "none"}`
    );
  }
}

const OPEN_STATUSES = WORK_ORDER_STATUSES.filter(
  (s) => !["COMPLETED", "INVOICED", "CLOSED", "CANCELLED"].includes(s)
);

function withSla<T extends { status: string; slaDueAt: Date | null }>(wo: T) {
  const slaBreached =
    !!wo.slaDueAt &&
    OPEN_STATUSES.includes(wo.status as (typeof OPEN_STATUSES)[number]) &&
    new Date(wo.slaDueAt) < new Date();
  return { ...wo, slaBreached };
}

const createSchema = z.object({
  accountId: z.string().min(1),
  siteId: z.string().min(1),
  title: z.string().min(1),
  description: z.string().optional().nullable(),
  jobType: z.enum(JOB_TYPES),
  priority: z.enum(PRIORITIES).default("NORMAL"),
  status: z.enum(WORK_ORDER_STATUSES).optional(),
  requiredSkillIds: z.array(z.string()).optional().default([]),
  assignedEmployeeId: z.string().optional().nullable(),
  scheduledStart: z.coerce.date().optional().nullable(),
  scheduledEnd: z.coerce.date().optional().nullable(),
  slaDueAt: z.coerce.date().optional().nullable(),
  estimatedHours: z.number().nonnegative().optional().nullable(),
  customerNotes: z.string().optional().nullable(),
  internalNotes: z.string().optional().nullable(),
});

const idParam = z.object({ id: z.string() });
const entryParams = z.object({ id: z.string(), entryId: z.string() });
const listQuery = z.object({
  status: z.string().optional(),
  priority: z.string().optional(),
  assignedEmployeeId: z.string().optional(),
  accountId: z.string().optional(),
  unassigned: z.string().optional(),
  dueBefore: z.string().optional(),
  q: z.string().optional(),
  limit: z.coerce.number().int().positive().max(500).optional(),
  offset: z.coerce.number().int().nonnegative().optional(),
});
const statusSchema = z.object({ status: z.enum(WORK_ORDER_STATUSES) });
const assignSchema = z.object({ assignedEmployeeId: z.string().nullable() });
const scheduleSchema = z.object({
  scheduledStart: z.coerce.date().nullable(),
  scheduledEnd: z.coerce.date().nullable(),
});
const completeSchema = z.object({
  actualHours: z.number().nonnegative(),
  completionNotes: z.string().optional().nullable(),
});
const timeEntrySchema = z.object({
  employeeId: z.string().min(1),
  hours: z.number().positive(),
  date: z.coerce.date().optional(),
  notes: z.string().optional().nullable(),
  billable: z.boolean().optional(),
});

const woInclude = {
  account: true,
  site: true,
  assignedEmployee: true,
  requiredSkills: { include: { skill: true } },
  quotes: { orderBy: { createdAt: "desc" as const } },
  invoices: true,
  attachments: { orderBy: { createdAt: "desc" as const } },
  timeEntries: {
    include: { employee: true },
    orderBy: { date: "desc" as const },
  },
};

export async function workOrderRoutes(app: FastifyInstance) {
  app.get("/", { schema: { tags: ["Work Orders"], summary: "List work orders (filter/search/paginate)", querystring: listQuery } }, async (req, reply) => {
    const { status, priority, assignedEmployeeId, accountId, unassigned, dueBefore, q, limit, offset } =
      req.query as z.infer<typeof listQuery>;

    const where: Record<string, unknown> = {};
    if (status) where.status = status;
    if (priority) where.priority = priority;
    if (accountId) where.accountId = accountId;
    if (assignedEmployeeId) where.assignedEmployeeId = assignedEmployeeId;
    if (unassigned === "true") where.assignedEmployeeId = null;
    if (dueBefore) where.slaDueAt = { lte: new Date(dueBefore) };
    if (q)
      where.OR = [
        { workOrderNumber: { contains: q } },
        { title: { contains: q } },
        { account: { is: { name: { contains: q } } } },
      ];

    const total = await prisma.workOrder.count({ where });
    reply.header("X-Total-Count", String(total));
    const orders = await prisma.workOrder.findMany({
      where,
      orderBy: [{ createdAt: "desc" }],
      include: woInclude,
      ...(limit ? { take: limit } : {}),
      ...(offset ? { skip: offset } : {}),
    });
    return orders.map(withSla);
  });

  app.get("/:id", { schema: { tags: ["Work Orders"], summary: "Get work order with full detail", params: idParam } }, async (req) => {
    const { id } = req.params as z.infer<typeof idParam>;
    const wo = await prisma.workOrder.findUnique({
      where: { id },
      include: {
        ...woInclude,
        stockMovements: { include: { inventoryItem: true } },
      },
    });
    if (!wo) throw notFound("Work order");
    return withSla(wo);
  });

  app.get("/:id/costing", { schema: { tags: ["Work Orders"], summary: "Job costing & margin", params: idParam } }, async (req) => {
    const { id } = req.params as z.infer<typeof idParam>;
    const costing = await computeJobCosting(id);
    if (!costing) throw notFound("Work order");
    return costing;
  });

  app.post("/", { schema: { tags: ["Work Orders"], summary: "Create work order", body: createSchema } }, async (req, reply) => {
    const data = req.body as z.infer<typeof createSchema>;
    const { requiredSkillIds, ...rest } = data;
    const workOrderNumber = await nextWorkOrderNumber();
    const wo = await prisma.workOrder.create({
      data: {
        ...rest,
        workOrderNumber,
        status: rest.status ?? "NEW",
        requiredSkills: {
          create: requiredSkillIds.map((skillId) => ({ skillId })),
        },
      },
      include: woInclude,
    });
    reply.status(201);
    return withSla(wo);
  });

  app.put("/:id", { schema: { tags: ["Work Orders"], summary: "Update work order", params: idParam, body: createSchema.partial() } }, async (req) => {
    const { id } = req.params as z.infer<typeof idParam>;
    const data = req.body as Partial<z.infer<typeof createSchema>>;
    const { requiredSkillIds, ...rest } = data;
    const existing = await prisma.workOrder.findUnique({ where: { id } });
    if (!existing) throw notFound("Work order");

    if (requiredSkillIds) {
      await prisma.workOrderRequiredSkill.deleteMany({ where: { workOrderId: id } });
      await prisma.workOrderRequiredSkill.createMany({
        data: requiredSkillIds.map((skillId) => ({ workOrderId: id, skillId })),
      });
    }
    const wo = await prisma.workOrder.update({
      where: { id },
      data: rest,
      include: woInclude,
    });
    return withSla(wo);
  });

  app.patch("/:id/status", { schema: { tags: ["Work Orders"], summary: "Change work order status (validated transitions)", params: idParam, body: statusSchema } }, async (req) => {
    const { id } = req.params as z.infer<typeof idParam>;
    const { status } = req.body as z.infer<typeof statusSchema>;
    const existing = await prisma.workOrder.findUnique({ where: { id } });
    if (!existing) throw notFound("Work order");
    assertTransition(existing.status, status);
    const wo = await prisma.workOrder.update({
      where: { id },
      data: { status },
      include: woInclude,
    });
    await audit(req.authUser, {
      action: "WORK_ORDER_STATUS",
      entity: "WorkOrder",
      entityId: id,
      summary: `${wo.workOrderNumber}: ${existing.status} → ${status}`,
    });
    return withSla(wo);
  });

  app.patch("/:id/assign", { schema: { tags: ["Work Orders"], summary: "Assign technician", params: idParam, body: assignSchema } }, async (req) => {
    const { id } = req.params as z.infer<typeof idParam>;
    const { assignedEmployeeId } = req.body as z.infer<typeof assignSchema>;
    const existing = await prisma.workOrder.findUnique({ where: { id } });
    if (!existing) throw notFound("Work order");
    const advance =
      assignedEmployeeId &&
      ["NEW", "TRIAGE", "APPROVED"].includes(existing.status);
    const wo = await prisma.workOrder.update({
      where: { id },
      data: {
        assignedEmployeeId,
        ...(advance ? { status: "SCHEDULED" } : {}),
      },
      include: woInclude,
    });
    await audit(req.authUser, {
      action: "WORK_ORDER_ASSIGN",
      entity: "WorkOrder",
      entityId: id,
      summary: `${wo.workOrderNumber} assigned to ${
        wo.assignedEmployee
          ? `${wo.assignedEmployee.firstName} ${wo.assignedEmployee.lastName}`
          : "Unassigned"
      }`,
    });
    return withSla(wo);
  });

  app.patch("/:id/schedule", { schema: { tags: ["Work Orders"], summary: "Set schedule window", params: idParam, body: scheduleSchema } }, async (req) => {
    const { id } = req.params as z.infer<typeof idParam>;
    const body = req.body as z.infer<typeof scheduleSchema>;
    if (body.scheduledStart && body.scheduledEnd && body.scheduledEnd < body.scheduledStart) {
      throw badRequest("scheduledEnd must be after scheduledStart");
    }
    const existing = await prisma.workOrder.findUnique({ where: { id } });
    if (!existing) throw notFound("Work order");
    const wo = await prisma.workOrder.update({
      where: { id },
      data: {
        ...body,
        ...(["NEW", "TRIAGE", "APPROVED"].includes(existing.status)
          ? { status: "SCHEDULED" }
          : {}),
      },
      include: woInclude,
    });
    return withSla(wo);
  });

  app.post("/:id/complete", { schema: { tags: ["Work Orders"], summary: "Complete work order", params: idParam, body: completeSchema } }, async (req) => {
    const { id } = req.params as z.infer<typeof idParam>;
    const { actualHours, completionNotes } = req.body as z.infer<typeof completeSchema>;
    const existing = await prisma.workOrder.findUnique({ where: { id } });
    if (!existing) throw notFound("Work order");
    const wo = await prisma.workOrder.update({
      where: { id },
      data: { actualHours, completionNotes, status: "COMPLETED" },
      include: woInclude,
    });
    await audit(req.authUser, {
      action: "WORK_ORDER_COMPLETE",
      entity: "WorkOrder",
      entityId: id,
      summary: `${wo.workOrderNumber} completed (${actualHours}h)`,
    });
    return withSla(wo);
  });

  app.delete("/:id", { schema: { tags: ["Work Orders"], summary: "Delete work order (only if no invoices)", params: idParam } }, async (req, reply) => {
    const { id } = req.params as z.infer<typeof idParam>;
    const existing = await prisma.workOrder.findUnique({
      where: { id },
      include: { invoices: true },
    });
    if (!existing) throw notFound("Work order");
    if (existing.invoices.length > 0) {
      throw conflict("Cannot delete a work order that has invoices");
    }
    await prisma.workOrderRequiredSkill.deleteMany({ where: { workOrderId: id } });
    await prisma.quote.deleteMany({ where: { workOrderId: id } });
    await prisma.stockMovement.deleteMany({ where: { workOrderId: id } });
    await prisma.workOrder.delete({ where: { id } });
    await audit(req.authUser, {
      action: "WORK_ORDER_DELETE",
      entity: "WorkOrder",
      entityId: id,
      summary: `${existing.workOrderNumber} deleted`,
    });
    reply.status(204);
    return null;
  });

  // ---- Timesheets ----
  app.get("/:id/time-entries", { schema: { tags: ["Work Orders"], summary: "List time entries", params: idParam } }, async (req) => {
    const { id } = req.params as z.infer<typeof idParam>;
    return prisma.timeEntry.findMany({
      where: { workOrderId: id },
      include: { employee: true },
      orderBy: { date: "desc" },
    });
  });

  app.post("/:id/time-entries", { schema: { tags: ["Work Orders"], summary: "Log time against a work order", params: idParam, body: timeEntrySchema } }, async (req, reply) => {
    const { id } = req.params as z.infer<typeof idParam>;
    const body = req.body as z.infer<typeof timeEntrySchema>;
    const wo = await prisma.workOrder.findUnique({ where: { id } });
    if (!wo) throw notFound("Work order");
    const entry = await prisma.timeEntry.create({
      data: {
        workOrderId: id,
        employeeId: body.employeeId,
        hours: body.hours,
        date: body.date ?? new Date(),
        notes: body.notes ?? null,
        billable: body.billable ?? true,
      },
      include: { employee: true },
    });
    await audit(req.authUser, {
      action: "TIME_LOGGED",
      entity: "WorkOrder",
      entityId: id,
      summary: `${wo.workOrderNumber}: ${body.hours}h logged`,
    });
    reply.status(201);
    return entry;
  });

  app.delete("/:id/time-entries/:entryId", { schema: { tags: ["Work Orders"], summary: "Delete a time entry", params: entryParams } }, async (req, reply) => {
    const { entryId } = req.params as z.infer<typeof entryParams>;
    await prisma.timeEntry.deleteMany({ where: { id: entryId } });
    reply.status(204);
    return null;
  });
}
