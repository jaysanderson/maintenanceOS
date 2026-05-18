import type { FastifyInstance } from "fastify";
import { prisma } from "../prisma.js";
import { computeJobCosting, computeStockLevels, round } from "../lib/costing.js";

const OPEN = [
  "NEW", "TRIAGE", "QUOTE_REQUIRED", "AWAITING_APPROVAL", "APPROVED",
  "SCHEDULED", "DISPATCHED", "IN_PROGRESS", "WAITING_ON_PARTS",
];

const monthKey = (d: Date) =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;

export async function reportRoutes(app: FastifyInstance) {
  app.get("/revenue", { schema: { tags: ["Reports"], summary: "Revenue by month" } }, async () => {
    const invoices = await prisma.invoice.findMany({
      where: { issuedAt: { not: null } },
    });
    const map = new Map<string, { month: string; subtotal: number; gst: number; total: number; count: number }>();
    for (const i of invoices) {
      const k = monthKey(new Date(i.issuedAt!));
      const row = map.get(k) ?? { month: k, subtotal: 0, gst: 0, total: 0, count: 0 };
      row.subtotal += i.subtotal;
      row.gst += i.gst;
      row.total += i.total;
      row.count += 1;
      map.set(k, row);
    }
    return Array.from(map.values())
      .map((r) => ({ ...r, subtotal: round(r.subtotal), gst: round(r.gst), total: round(r.total) }))
      .sort((a, b) => a.month.localeCompare(b.month));
  });

  app.get("/margin", { schema: { tags: ["Reports"], summary: "Gross margin by month" } }, async () => {
    const invoices = await prisma.invoice.findMany({
      where: { issuedAt: { not: null }, workOrderId: { not: null } },
    });
    const map = new Map<string, { month: string; revenue: number; profit: number }>();
    for (const i of invoices) {
      const c = await computeJobCosting(i.workOrderId!);
      if (!c) continue;
      const k = monthKey(new Date(i.issuedAt!));
      const row = map.get(k) ?? { month: k, revenue: 0, profit: 0 };
      row.revenue += c.revenue;
      row.profit += c.grossProfit;
      map.set(k, row);
    }
    return Array.from(map.values())
      .map((r) => ({
        month: r.month,
        revenue: round(r.revenue),
        grossProfit: round(r.profit),
        grossMarginPercent: r.revenue > 0 ? round((r.profit / r.revenue) * 100) : 0,
      }))
      .sort((a, b) => a.month.localeCompare(b.month));
  });

  app.get("/work-orders", { schema: { tags: ["Reports"], summary: "Work orders by status & account" } }, async () => {
    const byStatusRaw = await prisma.workOrder.groupBy({
      by: ["status"],
      _count: { _all: true },
    });
    const byStatus = byStatusRaw.map((r) => ({ status: r.status, count: r._count._all }));

    const accounts = await prisma.account.findMany({
      include: { _count: { select: { workOrders: true } } },
      orderBy: { name: "asc" },
    });
    const byAccount = accounts
      .map((a) => ({ accountId: a.id, account: a.name, count: a._count.workOrders }))
      .filter((a) => a.count > 0)
      .sort((a, b) => b.count - a.count);

    return { byStatus, byAccount };
  });

  app.get("/technician-utilization", { schema: { tags: ["Reports"], summary: "Technician utilization" } }, async () => {
    const techs = await prisma.employee.findMany({
      where: { active: true, role: { in: ["TECHNICIAN", "SENIOR_TECHNICIAN"] } },
      include: {
        workOrders: {
          where: { status: { in: ["SCHEDULED", "DISPATCHED", "IN_PROGRESS", "COMPLETED", "INVOICED"] } },
        },
      },
      orderBy: { lastName: "asc" },
    });
    return techs.map((t) => {
      const active = t.workOrders.filter((w) =>
        ["SCHEDULED", "DISPATCHED", "IN_PROGRESS"].includes(w.status)
      ).length;
      const completed = t.workOrders.filter((w) =>
        ["COMPLETED", "INVOICED"].includes(w.status)
      ).length;
      const loggedHours = round(
        t.workOrders.reduce((s, w) => s + (w.actualHours ?? 0), 0)
      );
      return {
        employeeId: t.id,
        name: `${t.firstName} ${t.lastName}`,
        role: t.role,
        territory: t.territory,
        activeJobs: active,
        completedJobs: completed,
        loggedHours,
      };
    });
  });

  app.get("/low-stock", { schema: { tags: ["Reports"], summary: "Low stock report" } }, async () => {
    const levels = await computeStockLevels();
    return levels.filter((l) => l.lowStock);
  });

  app.get("/sla-breaches", { schema: { tags: ["Reports"], summary: "SLA breach report" } }, async () => {
    const now = new Date();
    const breached = await prisma.workOrder.findMany({
      where: { status: { in: OPEN }, slaDueAt: { lt: now } },
      include: { account: true, site: true, assignedEmployee: true },
      orderBy: { slaDueAt: "asc" },
    });
    return breached.map((w) => ({
      id: w.id,
      workOrderNumber: w.workOrderNumber,
      title: w.title,
      account: w.account.name,
      site: w.site.name,
      priority: w.priority,
      status: w.status,
      slaDueAt: w.slaDueAt,
      assignedTo: w.assignedEmployee
        ? `${w.assignedEmployee.firstName} ${w.assignedEmployee.lastName}`
        : null,
      hoursOverdue: w.slaDueAt
        ? round((now.getTime() - new Date(w.slaDueAt).getTime()) / 3600000)
        : 0,
    }));
  });

  app.get("/margin-leakage", { schema: { tags: ["Reports"], summary: "Margin leakage report" } }, async () => {
    const jobs = await prisma.workOrder.findMany({
      where: { status: { in: ["COMPLETED", "INVOICED", "CLOSED"] } },
      orderBy: { updatedAt: "desc" },
      take: 100,
      select: { id: true },
    });
    const costed = [];
    for (const j of jobs) {
      const c = await computeJobCosting(j.id);
      if (c && c.revenue > 0) costed.push(c);
    }
    return costed
      .filter((c) => c.marginRisk)
      .sort((a, b) => a.grossMarginPercent - b.grossMarginPercent);
  });
}
