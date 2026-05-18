import type { FastifyInstance } from "fastify";
import { prisma } from "../prisma.js";
import { computeJobCosting, computeStockLevels, round } from "../lib/costing.js";

const OPEN = [
  "NEW",
  "TRIAGE",
  "QUOTE_REQUIRED",
  "AWAITING_APPROVAL",
  "APPROVED",
  "SCHEDULED",
  "DISPATCHED",
  "IN_PROGRESS",
  "WAITING_ON_PARTS",
];

function monthRange(d = new Date()) {
  const start = new Date(d.getFullYear(), d.getMonth(), 1);
  const end = new Date(d.getFullYear(), d.getMonth() + 1, 1);
  return { start, end };
}

export async function dashboardRoutes(app: FastifyInstance) {
  app.get("/summary", { schema: { tags: ["Dashboard"], summary: "Operational KPIs" } }, async () => {
    const now = new Date();
    const { start, end } = monthRange(now);
    const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    const todayEnd = new Date(todayStart.getTime() + 86400000);

    const [
      openWorkOrders,
      unassignedJobs,
      jobsDueToday,
      jobsWaitingOnParts,
      allOpen,
      activeTechs,
      monthInvoices,
      outstandingInvoices,
      vehicles,
    ] = await Promise.all([
      prisma.workOrder.count({ where: { status: { in: OPEN } } }),
      prisma.workOrder.count({ where: { status: { in: OPEN }, assignedEmployeeId: null } }),
      prisma.workOrder.count({
        where: { status: { in: OPEN }, slaDueAt: { gte: todayStart, lt: todayEnd } },
      }),
      prisma.workOrder.count({ where: { status: "WAITING_ON_PARTS" } }),
      prisma.workOrder.findMany({
        where: { status: { in: OPEN }, slaDueAt: { lt: now } },
        select: { id: true },
      }),
      prisma.employee.findMany({
        where: { active: true, role: { in: ["TECHNICIAN", "SENIOR_TECHNICIAN"] } },
        select: { id: true },
      }),
      prisma.invoice.findMany({
        where: { issuedAt: { gte: start, lt: end } },
        include: { workOrder: true },
      }),
      prisma.invoice.findMany({ where: { status: { in: ["SENT", "OVERDUE"] } } }),
      prisma.vehicle.findMany(),
    ]);

    const slaBreaches = allOpen.length;

    const techsWithWork = await prisma.workOrder.groupBy({
      by: ["assignedEmployeeId"],
      where: { status: { in: ["SCHEDULED", "DISPATCHED", "IN_PROGRESS"] }, assignedEmployeeId: { not: null } },
    });
    const technicianUtilization =
      activeTechs.length > 0
        ? round((techsWithWork.length / activeTechs.length) * 100)
        : 0;

    const revenueThisMonth = round(
      monthInvoices.reduce((s, i) => s + i.subtotal, 0)
    );

    // Gross margin this month: cost the work orders behind this month's invoices.
    let monthRevenue = 0;
    let monthProfit = 0;
    for (const inv of monthInvoices) {
      if (!inv.workOrderId) continue;
      const c = await computeJobCosting(inv.workOrderId);
      if (c) {
        monthRevenue += c.revenue;
        monthProfit += c.grossProfit;
      }
    }
    const grossMarginThisMonth =
      monthRevenue > 0 ? round((monthProfit / monthRevenue) * 100) : 0;

    const outstandingTotal = round(
      outstandingInvoices.reduce((s: number, i: { total: number }) => s + i.total, 0)
    );

    const stock = await computeStockLevels();
    const lowStockItems = stock.filter((s) => s.lowStock).length;

    const soon = new Date(now.getTime() + 30 * 86400000);
    const vehiclesDueForService = vehicles.filter(
      (v) => v.serviceDueAt && new Date(v.serviceDueAt) < soon
    ).length;

    // Worst jobs by margin leakage among completed/invoiced.
    const recentJobs = await prisma.workOrder.findMany({
      where: { status: { in: ["COMPLETED", "INVOICED", "CLOSED"] } },
      orderBy: { updatedAt: "desc" },
      take: 60,
      select: { id: true },
    });
    const costed = [];
    for (const j of recentJobs) {
      const c = await computeJobCosting(j.id);
      if (c && c.revenue > 0) costed.push(c);
    }
    const worstJobsByMargin = costed
      .sort((a, b) => a.grossMarginPercent - b.grossMarginPercent)
      .slice(0, 5);

    return {
      openWorkOrders,
      unassignedJobs,
      jobsDueToday,
      slaBreaches,
      jobsWaitingOnParts,
      technicianUtilization,
      revenueThisMonth,
      grossMarginThisMonth,
      outstandingInvoices: outstandingTotal,
      outstandingInvoiceCount: outstandingInvoices.length,
      lowStockItems,
      vehiclesDueForService,
      worstJobsByMargin,
    };
  });
}
