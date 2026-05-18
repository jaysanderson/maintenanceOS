import { prisma } from "../prisma.js";
import { GST_RATE } from "./enums.js";
import { getMarginRiskThreshold } from "./config.js";

export interface QuoteCostInput {
  labourHours: number;
  labourRate: number;
  materialCost: number;
  subcontractorCost: number;
  equipmentCost: number;
  travelCost: number;
  disposalCost: number;
  marginPercent: number;
}

/** Server-side quote maths. Margin is applied as a markup on the cost base. */
export function calcQuoteTotals(input: QuoteCostInput, gstRate = GST_RATE) {
  const labourCost = round(input.labourHours * input.labourRate);
  const costBase = round(
    labourCost +
      input.materialCost +
      input.subcontractorCost +
      input.equipmentCost +
      input.travelCost +
      input.disposalCost
  );
  const subtotal = round(costBase * (1 + input.marginPercent / 100));
  const gst = round(subtotal * gstRate);
  const total = round(subtotal + gst);
  return { labourCost, costBase, subtotal, gst, total };
}

export function calcInvoiceTotals(subtotal: number, gstRate = GST_RATE) {
  const s = round(subtotal);
  const gst = round(s * gstRate);
  return { subtotal: s, gst, total: round(s + gst) };
}

export function round(n: number) {
  return Math.round((n + Number.EPSILON) * 100) / 100;
}

/**
 * Full job profitability for a work order.
 * Revenue = invoice subtotal if invoiced, otherwise latest quote subtotal.
 * Actual labour = actualHours x assigned employee hourly cost.
 * Material = sum of stock consumed on the job at unit cost.
 */
export async function computeJobCosting(workOrderId: string) {
  const wo = await prisma.workOrder.findUnique({
    where: { id: workOrderId },
    include: {
      assignedEmployee: true,
      quotes: { orderBy: { createdAt: "desc" } },
      invoices: { orderBy: { createdAt: "desc" } },
      stockMovements: {
        where: { movementType: "CONSUMED_ON_JOB" },
        include: { inventoryItem: true },
      },
      timeEntries: { include: { employee: true } },
    },
  });
  if (!wo) return null;

  const latestQuote = wo.quotes[0];
  const latestInvoice = wo.invoices[0];

  const hourlyCost = wo.assignedEmployee?.hourlyCost ?? 0;
  const estLabourCost = round((wo.estimatedHours ?? 0) * hourlyCost);

  // Prefer logged timesheets for actual labour; fall back to actualHours.
  const timesheetHours = round(
    wo.timeEntries.reduce((s, t) => s + t.hours, 0)
  );
  const timesheetCost = round(
    wo.timeEntries.reduce((s, t) => s + t.hours * t.employee.hourlyCost, 0)
  );
  const actualLabourCost =
    wo.timeEntries.length > 0
      ? timesheetCost
      : round((wo.actualHours ?? 0) * hourlyCost);

  const materialCost = round(
    wo.stockMovements.reduce(
      (sum, m) => sum + m.quantity * m.inventoryItem.unitCost,
      0
    )
  );

  const subcontractorCost = latestQuote?.subcontractorCost ?? 0;
  const equipmentCost = latestQuote?.equipmentCost ?? 0;
  const travelCost = latestQuote?.travelCost ?? 0;
  const disposalCost = latestQuote?.disposalCost ?? 0;

  const quotedRevenue = latestQuote?.subtotal ?? 0;
  const invoiceRevenue = latestInvoice?.subtotal ?? 0;
  const revenue = invoiceRevenue > 0 ? invoiceRevenue : quotedRevenue;

  const totalActualCost = round(
    actualLabourCost +
      materialCost +
      subcontractorCost +
      equipmentCost +
      travelCost +
      disposalCost
  );

  const grossProfit = round(revenue - totalActualCost);
  const grossMarginPercent =
    revenue > 0 ? round((grossProfit / revenue) * 100) : 0;
  const varianceFromQuote = round(revenue - quotedRevenue);
  const marginRisk =
    revenue > 0 && grossProfit / revenue < (await getMarginRiskThreshold());

  return {
    workOrderId,
    workOrderNumber: wo.workOrderNumber,
    title: wo.title,
    status: wo.status,
    quotedRevenue,
    invoiceRevenue,
    revenue,
    estLabourCost,
    actualLabourCost,
    timesheetHours,
    labourSource: wo.timeEntries.length > 0 ? "TIMESHEET" : "ACTUAL_HOURS",
    materialCost,
    subcontractorCost,
    equipmentCost,
    travelCost,
    disposalCost,
    totalActualCost,
    grossProfit,
    grossMarginPercent,
    varianceFromQuote,
    marginRisk,
  };
}

/** Available quantity per inventory item across all non-damaged locations. */
export async function computeStockLevels() {
  const items = await prisma.inventoryItem.findMany({
    include: { movements: { include: { fromLocation: true, toLocation: true } } },
  });

  return items.map((item) => {
    const byLocation = new Map<string, { name: string; qty: number }>();
    let total = 0;
    for (const m of item.movements) {
      if (m.toLocation) {
        const cur = byLocation.get(m.toLocation.id) ?? {
          name: m.toLocation.name,
          qty: 0,
        };
        cur.qty += m.quantity;
        byLocation.set(m.toLocation.id, cur);
        total += m.quantity;
      }
      if (m.fromLocation) {
        const cur = byLocation.get(m.fromLocation.id) ?? {
          name: m.fromLocation.name,
          qty: 0,
        };
        cur.qty -= m.quantity;
        byLocation.set(m.fromLocation.id, cur);
        total -= m.quantity;
      }
    }
    return {
      itemId: item.id,
      sku: item.sku,
      name: item.name,
      category: item.category,
      unit: item.unit,
      unitCost: item.unitCost,
      sellPrice: item.sellPrice,
      reorderPoint: item.reorderPoint,
      totalQuantity: round(total),
      lowStock: round(total) < item.reorderPoint,
      locations: Array.from(byLocation.entries()).map(([id, v]) => ({
        locationId: id,
        name: v.name,
        quantity: round(v.qty),
      })),
    };
  });
}
