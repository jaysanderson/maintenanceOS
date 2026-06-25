/**
 * Agent-backed AI features F3/F4/F5, implemented with the HYBRID pattern:
 * MaintenanceOS computes the exact structured data from its own database,
 * then ARAG (the only AI gateway) turns it into the briefing / ranked
 * actions / quote draft via /predict/chat. This gives correct numbers
 * (no LLM arithmetic) while keeping all generation in ARAG, and sidesteps
 * the deployment's agent-retrieval bugs.
 */
import { prisma } from "../prisma.js";
import { computeJobCosting, computeStockLevels } from "./costing.js";
import { getMarginRiskThreshold, getCompanyConfig } from "./config.js";
import {
  predictChat,
  ask,
  upsertErpDoc,
  isLowConfidenceAnswer,
  LOW_CONFIDENCE_MESSAGE,
  ingestAndExtractText,
  DOC_EXTRACT_STRATEGY_ID,
} from "./arag.js";

interface PlaybookShape {
  title?: string;
  estimatedHours?: number;
  requiredSkills?: string[];
  typicalMaterials?: string[];
  steps?: string[];
  safetyControls?: string[];
}

/**
 * Save a generated playbook back into the KB as a reusable template
 * (doctype=playbook), so it's searchable by the Knowledge Copilot and
 * reusable across the team. Idempotent by slug.
 */
export async function savePlaybook(
  jobDescription: string,
  playbook: PlaybookShape
): Promise<{ slug: string }> {
  const slug =
    "playbook-" +
    jobDescription.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 60);
  const title = `Playbook: ${playbook.title ?? jobDescription}`;
  const body = [
    `# ${title}`,
    ``,
    `- Estimated hours: ${playbook.estimatedHours ?? "—"}`,
    `- Required skills: ${(playbook.requiredSkills ?? []).join(", ") || "—"}`,
    `- Typical materials: ${(playbook.typicalMaterials ?? []).join(", ") || "—"}`,
    ``,
    `## Steps`,
    ...(playbook.steps ?? []).map((s, i) => `${i + 1}. ${s}`),
    ``,
    `## Safety controls`,
    ...(playbook.safetyControls ?? []).map((s) => `- ${s}`),
  ].join("\n");
  await upsertErpDoc({
    slug,
    title,
    body,
    path: "/playbooks",
    labels: [["doctype", "playbook"]],
    relations: [],
  });
  return { slug };
}

const OPEN = [
  "NEW", "TRIAGE", "QUOTE_REQUIRED", "AWAITING_APPROVAL", "APPROVED",
  "SCHEDULED", "DISPATCHED", "IN_PROGRESS", "WAITING_ON_PARTS",
];
const TERMINAL = ["COMPLETED", "INVOICED", "CLOSED", "CANCELLED"];

/** Extract the first JSON value (object or array) from an LLM answer. */
function extractJson(text: string): unknown | null {
  const cleaned = text.replace(/```json/gi, "").replace(/```/g, "");
  const firstObj = cleaned.indexOf("{");
  const firstArr = cleaned.indexOf("[");
  const candidates = [firstObj, firstArr].filter((i) => i >= 0);
  if (!candidates.length) return null;
  const start = Math.min(...candidates);
  const open = cleaned[start];
  const close = open === "{" ? "}" : "]";
  const end = cleaned.lastIndexOf(close);
  if (end <= start) return null;
  try {
    return JSON.parse(cleaned.slice(start, end + 1));
  } catch {
    return null;
  }
}

// ── F4: Daily Operations Briefing ────────────────────────────────────────

export async function generateBriefing(): Promise<{
  briefing: string;
  data: Record<string, unknown>;
}> {
  const now = new Date();
  const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const todayEnd = new Date(todayStart.getTime() + 86400000);
  const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);
  const monthEnd = new Date(now.getFullYear(), now.getMonth() + 1, 1);

  const [openCount, unassignedCount, dueToday, breachedWOs, overdueInvoices, monthInvoices] =
    await Promise.all([
      prisma.workOrder.count({ where: { status: { in: OPEN } } }),
      prisma.workOrder.count({ where: { status: { in: OPEN }, assignedEmployeeId: null } }),
      prisma.workOrder.count({
        where: { status: { in: OPEN }, slaDueAt: { gte: todayStart, lt: todayEnd } },
      }),
      prisma.workOrder.findMany({
        where: { status: { in: OPEN }, slaDueAt: { lt: now } },
        include: { account: true },
        orderBy: { slaDueAt: "asc" },
        take: 8,
      }),
      prisma.invoice.findMany({
        where: { status: { in: ["SENT", "OVERDUE"] }, dueAt: { lt: now } },
        include: { account: true },
        orderBy: { dueAt: "asc" },
        take: 8,
      }),
      prisma.invoice.findMany({
        where: { issuedAt: { gte: monthStart, lt: monthEnd } },
        select: { subtotal: true, workOrderId: true },
      }),
    ]);

  const revenueThisMonth = Math.round(monthInvoices.reduce((s, i) => s + i.subtotal, 0));

  const stock = await computeStockLevels();
  const lowStock = stock.filter((s) => s.lowStock).map((s) => ({ name: s.name, available: s.totalQuantity, reorderPoint: s.reorderPoint }));

  // Worst-margin recently completed jobs.
  const recent = await prisma.workOrder.findMany({
    where: { status: { in: ["COMPLETED", "INVOICED", "CLOSED"] } },
    orderBy: { updatedAt: "desc" },
    take: 40,
    select: { id: true },
  });
  const costed = [];
  for (const j of recent) {
    const c = await computeJobCosting(j.id);
    if (c && c.revenue > 0) costed.push(c);
  }
  const worstMargin = costed
    .sort((a, b) => a.grossMarginPercent - b.grossMarginPercent)
    .slice(0, 5)
    .map((c) => ({
      id: c.workOrderId,
      workOrder: c.workOrderNumber,
      title: c.title,
      grossMarginPercent: c.grossMarginPercent,
      revenue: c.revenue,
    }));

  // Include record IDs so the UI can fetch full detail in a quick modal
  // when the manager clicks a SLA-breach / invoice / margin-risk row.
  const data = {
    openWorkOrders: openCount,
    unassignedJobs: unassignedCount,
    jobsDueToday: dueToday,
    slaBreaches: breachedWOs.length,
    slaBreachedJobs: breachedWOs.map((w) => ({
      id: w.id,
      workOrder: w.workOrderNumber, title: w.title, account: w.account.name,
      priority: w.priority, slaDueAt: w.slaDueAt,
    })),
    overdueInvoices: overdueInvoices.map((i) => ({
      id: i.id,
      invoice: i.invoiceNumber, account: i.account.name, total: i.total, dueAt: i.dueAt,
    })),
    revenueThisMonthAud: revenueThisMonth,
    lowStockItems: lowStock,
    worstMarginJobs: worstMargin,
  };

  // The narrative is a short executive insight, not a bullet list — the UI
  // renders the SLA breaches, overdue invoices, margin risk and stock as
  // interactive cards using `data` directly. ARAG's job here is the "what
  // should I focus on first?" hot-take a manager wants over their coffee.
  const system =
    "You are the operations manager's daily briefing assistant for a property-maintenance company. " +
    "Read the DATA and write a 2-3 sentence executive headline — what is the single most important thing " +
    "to focus on right now, and why. Be specific: name accounts, cite WO-/INV- numbers, give exact dollar " +
    "amounts when they matter. Do NOT enumerate every item (the dashboard already lists them). Plain prose, " +
    "no bullet points, no markdown headings. Use ONLY the numbers in the data; do not invent figures.";

  const briefing = await predictChat(
    "Write today's executive briefing headline.",
    [system, `DATA:\n${JSON.stringify(data)}`],
    { systemPrompt: system }
  );

  return { briefing, data };
}

// ── F5: Dispatcher Next-Best-Action ──────────────────────────────────────

export async function dispatchActions(territory?: string): Promise<{
  actions: unknown;
  raw?: string;
  context: Record<string, unknown>;
}> {
  const now = new Date();
  const openJobs = await prisma.workOrder.findMany({
    where: { status: { in: OPEN }, assignedEmployeeId: null },
    include: { account: true, site: true, requiredSkills: { include: { skill: true } } },
    orderBy: [{ priority: "desc" }, { slaDueAt: "asc" }],
    take: 20,
  });

  const technicians = await prisma.employee.findMany({
    where: { active: true, role: { in: ["TECHNICIAN", "SENIOR_TECHNICIAN"] } },
    include: { skills: { include: { skill: true } } },
  });

  const jobs = openJobs.map((w) => {
    const breached = w.slaDueAt && new Date(w.slaDueAt) < now;
    return {
      workOrder: w.workOrderNumber,
      title: w.title,
      priority: w.priority,
      status: w.status,
      slaDueAt: w.slaDueAt,
      slaBreached: Boolean(breached),
      suburb: w.site.suburb,
      state: w.site.state,
      account: w.account.name,
      requiredSkills: w.requiredSkills.map((s) => s.skill.name),
    };
  });

  const techs = technicians.map((t) => ({
    name: `${t.firstName} ${t.lastName}`,
    role: t.role,
    territory: t.territory,
    skills: t.skills.map((s) => s.skill.name),
  }));

  const context = { territory: territory ?? null, openUnassignedJobs: jobs, technicians: techs };

  const system =
    "You are a dispatch optimisation assistant for a property-maintenance company. Given the unassigned jobs " +
    "and available technicians, return a prioritised list of next-best actions as a JSON array. Each item: " +
    '{ "workOrder": string, "action": "ASSIGN"|"ESCALATE"|"RESCHEDULE", "recommendedTechnician": string|null, ' +
    '"reason": string }. Rank URGENT and SLA-breached jobs first. Only recommend a technician who has ALL of the ' +
    "job's requiredSkills (match by skill name); prefer same territory. If no technician qualifies, use ESCALATE. " +
    (territory ? `Focus on the ${territory} territory. ` : "") +
    "Return ONLY the JSON array, max 10 items. Use only the provided data.";

  const raw = await predictChat(
    "Rank the next best dispatch actions.",
    [system, `DATA:\n${JSON.stringify(context)}`],
    { systemPrompt: system }
  );
  const actions = extractJson(raw);

  // Resolve the LLM's work-order numbers + technician names back to ids so the
  // UI can apply each action (assign) with one click.
  if (Array.isArray(actions)) {
    const woByNumber = new Map(openJobs.map((w) => [w.workOrderNumber, w.id]));
    const techByName = new Map(
      technicians.map((t) => [`${t.firstName} ${t.lastName}`.toLowerCase(), t.id])
    );
    for (const a of actions as Array<Record<string, unknown>>) {
      const wn = typeof a.workOrder === "string" ? a.workOrder : "";
      a.workOrderId = woByNumber.get(wn) ?? null;
      const rt = typeof a.recommendedTechnician === "string" ? a.recommendedTechnician : "";
      a.recommendedTechnicianId = rt ? techByName.get(rt.toLowerCase()) ?? null : null;
    }
  }
  return { actions: actions ?? null, raw: actions ? undefined : raw, context };
}

// ── F3: Site-Adaptive Quote Drafting ─────────────────────────────────────

export async function draftQuote(workOrderId: string): Promise<{
  draft: unknown;
  comparables: { workOrder: string; labourHours: number; materialCost: number; total: number; marginPercent: number }[];
  raw?: string;
} | null> {
  const wo = await prisma.workOrder.findUnique({
    where: { id: workOrderId },
    include: { account: true, site: true, requiredSkills: { include: { skill: true } } },
  });
  if (!wo) return null;

  // Comparable completed/invoiced jobs of the same job type.
  const comparableWOs = await prisma.workOrder.findMany({
    where: {
      jobType: wo.jobType,
      status: { in: ["COMPLETED", "INVOICED", "CLOSED"] },
      id: { not: wo.id },
    },
    orderBy: { updatedAt: "desc" },
    take: 8,
    include: { quotes: { orderBy: { createdAt: "desc" }, take: 1 } },
  });

  const comparables = [];
  for (const c of comparableWOs) {
    const cost = await computeJobCosting(c.id);
    const q = c.quotes[0];
    if (cost && (cost.revenue > 0 || q)) {
      comparables.push({
        workOrder: c.workOrderNumber,
        title: c.title,
        labourHours: cost.timesheetHours || q?.labourHours || 0,
        labourRate: q?.labourRate ?? 0,
        materialCost: cost.materialCost,
        marginPercent: q?.marginPercent ?? cost.grossMarginPercent,
        total: q?.total ?? cost.revenue,
      });
    }
    if (comparables.length >= 6) break;
  }

  const marginThreshold = await getMarginRiskThreshold();

  // Digest comparables into guidance so the model anchors on sensible
  // central values rather than copying a single comparable's zeros or an
  // outlier computed margin.
  const median = (xs: number[]): number => {
    const v = xs.filter((n) => n > 0).sort((a, b) => a - b);
    if (!v.length) return 0;
    const m = Math.floor(v.length / 2);
    return v.length % 2 ? v[m] : Math.round((v[m - 1] + v[m]) / 2);
  };
  // Standard labour rate: median of non-zero comparable rates, else the
  // company's typical field rate.
  const STANDARD_LABOUR_RATE = 110;
  const typicalLabourRate = median(comparables.map((c) => c.labourRate)) || STANDARD_LABOUR_RATE;
  const typicalLabourHours = median(comparables.map((c) => c.labourHours)) || wo.estimatedHours || 2;
  const typicalMaterialCost = median(comparables.map((c) => c.materialCost));

  const context = {
    workOrder: {
      number: wo.workOrderNumber, title: wo.title, jobType: wo.jobType,
      description: wo.description, account: wo.account.name,
      site: `${wo.site.name}, ${wo.site.suburb} ${wo.site.state}`,
      requiredSkills: wo.requiredSkills.map((s) => s.skill.name),
      estimatedHours: wo.estimatedHours,
    },
    guidance: {
      standardLabourRate: STANDARD_LABOUR_RATE,
      typicalLabourRate,
      typicalLabourHours,
      typicalMaterialCost,
      minGrossMarginPercent: Math.round(marginThreshold * 100),
    },
    comparableJobs: comparables,
  };

  const system =
    "You are an estimator for a property-maintenance company. Draft a realistic quote for the work order, " +
    "anchored in the comparable jobs and the provided guidance. Return ONLY a JSON object: " +
    '{ "labourHours": number, "labourRate": number, "materialCost": number, "subcontractorCost": number, ' +
    '"equipmentCost": number, "travelCost": number, "disposalCost": number, "marginPercent": number, ' +
    '"reasoning": string }. RULES: ' +
    "labourRate MUST be non-zero — use guidance.typicalLabourRate (never 0). " +
    "labourHours should reflect the work order's estimatedHours or guidance.typicalLabourHours. " +
    "materialCost should be a realistic estimate for the described work (use guidance.typicalMaterialCost as a " +
    "starting point; only use 0 if the job genuinely needs no materials). " +
    "marginPercent must be a sensible ROUND figure (e.g. 20, 25 or 30), at least guidance.minGrossMarginPercent — " +
    "do NOT copy a comparable job's computed margin. " +
    "The server computes subtotal/GST/total — do not include them. Use only the provided data.";

  const raw = await predictChat(
    "Draft the quote.",
    [system, `DATA:\n${JSON.stringify(context)}`],
    { systemPrompt: system }
  );
  const draft = extractJson(raw) as Record<string, number> | null;
  // Safety net: never surface a zero/blank labour rate even if the model slips.
  if (draft && (!draft.labourRate || draft.labourRate <= 0)) draft.labourRate = typicalLabourRate;
  if (draft && (!draft.labourHours || draft.labourHours <= 0)) draft.labourHours = typicalLabourHours;
  if (draft && (!draft.marginPercent || draft.marginPercent <= 0)) {
    draft.marginPercent = Math.max(25, Math.round(marginThreshold * 100));
  }

  return {
    draft: draft ?? null,
    comparables: comparables.map((c) => ({
      workOrder: c.workOrder, labourHours: c.labourHours, materialCost: c.materialCost,
      total: c.total, marginPercent: c.marginPercent,
    })),
    raw: draft ? undefined : raw,
  };
}

// ── #5 "Ask your business" Ops Assistant (hybrid) ────────────────────────
//
// The agent's `sql` driver would be ideal here but it needs a network-reachable
// DSN, and our SQLite-on-Fly DB isn't exposed. The hybrid pattern (same as F4
// Briefing / F5 Dispatch / F3 Quote-draft) is reliable: gather a rich ops
// snapshot from Prisma, then ARAG /predict/chat narrates an answer grounded
// in that snapshot. Stays consistent with "ARAG is the only AI gateway".

async function gatherOpsSnapshot(): Promise<Record<string, unknown>> {
  const now = new Date();
  const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const todayEnd = new Date(todayStart.getTime() + 86400000);
  const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);
  const monthEnd = new Date(now.getFullYear(), now.getMonth() + 1, 1);
  const nextWeek = new Date(now.getTime() + 7 * 86400000);

  const [
    openCount,
    unassignedCount,
    dueToday,
    waitingOnParts,
    breachedWOs,
    overdueInvoices,
    monthInvoices,
    technicians,
    recentCompleted,
    upcoming,
  ] = await Promise.all([
    prisma.workOrder.count({ where: { status: { in: OPEN } } }),
    prisma.workOrder.count({ where: { status: { in: OPEN }, assignedEmployeeId: null } }),
    prisma.workOrder.count({
      where: { status: { in: OPEN }, slaDueAt: { gte: todayStart, lt: todayEnd } },
    }),
    prisma.workOrder.count({ where: { status: "WAITING_ON_PARTS" } }),
    prisma.workOrder.findMany({
      where: { status: { in: OPEN }, slaDueAt: { lt: now } },
      include: { account: true, assignedEmployee: true },
      orderBy: { slaDueAt: "asc" },
      take: 10,
    }),
    prisma.invoice.findMany({
      where: { status: { in: ["SENT", "OVERDUE"] }, dueAt: { lt: now } },
      include: { account: true },
      orderBy: { dueAt: "asc" },
      take: 10,
    }),
    prisma.invoice.findMany({
      where: { issuedAt: { gte: monthStart, lt: monthEnd } },
      select: { subtotal: true, total: true, status: true, workOrderId: true },
    }),
    prisma.employee.findMany({
      where: { active: true, role: { in: ["TECHNICIAN", "SENIOR_TECHNICIAN"] } },
      include: {
        skills: { include: { skill: true } },
        workOrders: { where: { status: { in: OPEN } }, select: { id: true } },
      },
    }),
    prisma.workOrder.findMany({
      where: { status: { in: ["COMPLETED", "INVOICED", "CLOSED"] } },
      orderBy: { updatedAt: "desc" },
      take: 30,
      select: { id: true },
    }),
    prisma.workOrder.findMany({
      where: { scheduledStart: { gte: now, lt: nextWeek }, status: { in: OPEN } },
      include: { account: true, assignedEmployee: true },
      orderBy: { scheduledStart: "asc" },
      take: 20,
    }),
  ]);

  const revenueThisMonth = Math.round(monthInvoices.reduce((s, i) => s + i.subtotal, 0));
  const outstandingThisMonth = Math.round(
    monthInvoices
      .filter((i) => ["SENT", "OVERDUE"].includes(i.status))
      .reduce((s, i) => s + i.total, 0)
  );

  // Worst-margin among recently completed (mirrors the briefing).
  const costed = [];
  for (const j of recentCompleted) {
    const c = await computeJobCosting(j.id);
    if (c && c.revenue > 0) costed.push(c);
  }
  const worstMargin = costed
    .sort((a, b) => a.grossMarginPercent - b.grossMarginPercent)
    .slice(0, 5)
    .map((c) => ({
      workOrder: c.workOrderNumber,
      title: c.title,
      grossMarginPercent: c.grossMarginPercent,
      revenue: c.revenue,
    }));

  const stock = await computeStockLevels();
  const lowStock = stock
    .filter((s) => s.lowStock)
    .slice(0, 10)
    .map((s) => ({ name: s.name, available: s.totalQuantity, reorderPoint: s.reorderPoint }));

  const techName = (t: { firstName: string; lastName: string } | null) =>
    t ? `${t.firstName} ${t.lastName}` : null;

  return {
    asOf: now.toISOString(),
    counts: {
      openWorkOrders: openCount,
      unassignedJobs: unassignedCount,
      jobsDueToday: dueToday,
      slaBreaches: breachedWOs.length,
      waitingOnParts,
    },
    revenue: {
      thisMonthAud: revenueThisMonth,
      outstandingThisMonthAud: outstandingThisMonth,
    },
    slaBreachedJobs: breachedWOs.map((w) => ({
      workOrder: w.workOrderNumber,
      title: w.title,
      account: w.account.name,
      priority: w.priority,
      slaDueAt: w.slaDueAt,
      technician: techName(w.assignedEmployee),
    })),
    overdueInvoices: overdueInvoices.map((i) => ({
      invoice: i.invoiceNumber,
      account: i.account.name,
      total: i.total,
      dueAt: i.dueAt,
    })),
    worstMarginJobs: worstMargin,
    technicians: technicians.map((t) => ({
      name: `${t.firstName} ${t.lastName}`,
      role: t.role,
      territory: t.territory,
      openJobs: t.workOrders.length,
      skills: t.skills.map((s) => s.skill.name),
    })),
    lowStockItems: lowStock,
    upcomingScheduled: upcoming.map((w) => ({
      workOrder: w.workOrderNumber,
      title: w.title,
      account: w.account.name,
      scheduledStart: w.scheduledStart,
      technician: techName(w.assignedEmployee),
    })),
  };
}

/**
 * "Ask your business" — NL question against a live ops snapshot, narrated
 * by ARAG. Returns a friendly low-confidence message when the snapshot
 * doesn't cover the question.
 */
export async function opsAssistant(
  question: string
): Promise<{ answer: string; lowConfidence: boolean; snapshotKeys: string[] }> {
  const snapshot = await gatherOpsSnapshot();
  const system =
    "You are MaintenanceOS's operations assistant for a property-maintenance company. " +
    "Answer the operations manager's question using ONLY the JSON ops snapshot provided. " +
    "Cite specific work-order numbers (WO-...), invoice numbers (INV-...) and account names. " +
    "Be concise (a few sentences or short bullets). Show actual numbers from the snapshot. " +
    "If the snapshot doesn't contain the information needed, reply briefly that the data " +
    "isn't in the current snapshot — never invent figures or use outside knowledge.";

  const answer = await predictChat(
    question,
    [system, `OPS SNAPSHOT (current live state):\n${JSON.stringify(snapshot)}`],
    { systemPrompt: system }
  );
  const lowConfidence = isLowConfidenceAnswer(answer);
  return {
    answer: lowConfidence ? LOW_CONFIDENCE_MESSAGE : answer,
    lowConfidence,
    snapshotKeys: Object.keys(snapshot),
  };
}

// ── J1: Supplier document → Purchase Order draft (write-path) ─────────────
//
// Hybrid, like the read features but inbound: ARAG's vision model reads the
// uploaded supplier PO / order-confirmation and returns structured JSON; the
// app matches it against our own supplier + inventory catalogue and returns
// a DRAFT for human review. Nothing is written here — the reviewed draft is
// posted to the existing POST /api/purchase-orders endpoint.

/** One line as the vision model returns it (before we match it). */
interface ExtractedPoLine {
  description: string;
  sku: string | null;
  quantity: number;
  unitCost: number;
}

/** A line after matching against our InventoryItem catalogue. */
export interface DraftPoLine extends ExtractedPoLine {
  /** Matched inventory item, or null when nothing in our catalogue fits. */
  matchedItemId: string | null;
  matchedItemName: string | null;
  matchedSku: string | null;
  /** "sku" = exact SKU hit, "name" = fuzzy name hit, null = unmatched. */
  /** "sku"/"name" = confident exact match; "fuzzy" = partial (confirm); null = none. */
  matchBy: "sku" | "name" | "fuzzy" | null;
}

export interface PurchaseOrderDraft {
  supplierName: string | null;
  supplierRef: string | null;
  /** Buyer's PO number the document references (for 3-way match). */
  poRef: string | null;
  orderDate: string | null;
  expectedDate: string | null;
  currency: string | null;
  /** Matched supplier in our DB (null → user picks one). */
  matchedSupplierId: string | null;
  matchedSupplierName: string | null;
  /** Matched Purchase Order in our DB (3-way match; null → user picks/none). */
  matchedPurchaseOrderId: string | null;
  matchedPurchaseOrderNumber: string | null;
  lines: DraftPoLine[];
}

const PO_EXTRACT_SYSTEM =
  "You are a precise document data-extraction engine for a property " +
  "maintenance company's purchasing/payables system. You are given the " +
  "extracted text of a supplier document — a purchase order, order " +
  "confirmation, or a supplier invoice/bill. Extract its contents as " +
  "STRICT JSON only — no prose, no markdown fences. Use this exact shape: " +
  '{"supplierName": string, "supplierRef": string|null, "poRef": string|null, ' +
  '"orderDate": string|null, "expectedDate": string|null, "currency": ' +
  'string|null, "lines": [{"description": string, "sku": string|null, ' +
  '"quantity": number, "unitCost": number}]}. ' +
  "supplierName is the supplier's trading/brand name as shown prominently in " +
  "the letterhead (e.g. 'Reece Plumbing'), NOT the legal entity in the fine " +
  "print (e.g. 'Reece Pty Ltd'). " +
  "supplierRef is the document's own number (the supplier's PO or invoice " +
  "number). poRef is the BUYER's purchase-order number the document " +
  "references back to — labels like 'Customer PO', 'Your Order', 'Order No', " +
  "'PO Number' (e.g. 'PO-2026-0004') — null if none. " +
  "For an invoice, put the invoice date in orderDate and the payment due " +
  "date in expectedDate. " +
  "Dates as ISO yyyy-mm-dd where possible. unitCost is the ex-tax unit " +
  "price as a number (no currency symbol). If a field is absent use null " +
  "(or [] for lines). If this document is NOT a purchase order, order " +
  'confirmation or supplier invoice/bill, return {"notAPurchaseOrder": true}.';

function num(v: unknown, d = 0): number {
  const n = typeof v === "string" ? Number(v.replace(/[^0-9.-]/g, "")) : Number(v);
  return Number.isFinite(n) ? n : d;
}

// Company legal-form / filler words stripped before matching a supplier name,
// so "Reece Pty Ltd" (legal entity on an invoice) still resolves to our
// "Reece Plumbing" (trading name in the catalogue).
const COMPANY_SUFFIXES = new Set([
  "pty", "ltd", "limited", "llc", "inc", "incorporated", "co", "company",
  "pl", "group", "australia", "aust", "the",
]);

export function normalizeCompanyName(s: string): string {
  return s
    .toLowerCase()
    .replace(/&/g, " and ")
    .replace(/[^a-z0-9]+/g, " ")
    .split(" ")
    .filter((w) => w && !COMPANY_SUFFIXES.has(w))
    .join(" ")
    .trim();
}

/**
 * Match an extracted supplier name to one of our suppliers, tolerant of
 * legal-form noise and word order. Tiered so the most confident hit wins:
 * raw exact → normalized exact → normalized substring → shared first word.
 */
export function matchSupplierName<T extends { id: string; name: string }>(
  extracted: string,
  suppliers: T[]
): T | null {
  const rawNeedle = extracted.toLowerCase().trim();
  const needle = normalizeCompanyName(extracted);
  const needleFirst = needle.split(" ")[0] ?? "";
  let best: { s: T; score: number } | null = null;
  for (const s of suppliers) {
    const raw = s.name.toLowerCase().trim();
    const norm = normalizeCompanyName(s.name);
    const first = norm.split(" ")[0] ?? "";
    let score = 0;
    if (raw === rawNeedle) score = 100;
    else if (norm && norm === needle) score = 90;
    else if (norm && needle && (norm.includes(needle) || needle.includes(norm))) score = 70;
    else if (needleFirst && needleFirst === first && needleFirst.length >= 3) score = 50;
    if (score > 0 && (!best || score > best.score)) best = { s, score };
  }
  return best?.s ?? null;
}

/**
 * Extract a draft Purchase Order from an uploaded supplier document.
 * Returns `{ draft: null, lowConfidence: true }` when the file isn't a PO
 * or the vision model can't read one — never fabricates a PO.
 */
const MIME_EXT: Record<string, string> = {
  "application/pdf": "pdf",
  "image/png": "png",
  "image/jpeg": "jpg",
  "image/webp": "webp",
  "image/gif": "gif",
};

export async function extractPurchaseOrderDraft(
  fileBuffer: Buffer,
  mimeType: string,
  onProgress?: (message: string) => void
): Promise<{
  draft: PurchaseOrderDraft | null;
  lowConfidence: boolean;
  message?: string;
  model: string;
}> {
  // ARAG's compat endpoint can't read images on this deployment, so we ingest
  // the file, let ARAG extract/OCR its text, then structure that text with the
  // (text-only) generation gateway. ARAG remains the only AI gateway.
  //
  // Single fast pass (default OCR ~6–30s). The OCR text can be noisy on a
  // photo/scan, so the prompt is told to tolerate OCR errors. We don't chain a
  // slow VLLM retry synchronously — that pushed worst-case latency to minutes.
  const ext = MIME_EXT[mimeType] ?? "bin";
  const filename = `purchase-order.${ext}`;
  const report = onProgress ?? (() => {});

  report("Uploading the document…");
  const text = await ingestAndExtractText(fileBuffer, filename, mimeType, {
    onPoll: (sec) => report(`Reading the document… (${sec}s)`),
  });
  if (!text.trim()) {
    return {
      draft: null,
      lowConfidence: true,
      message:
        "Couldn't read any text from this document. Make sure it's a clear supplier " +
        "invoice, PO or order confirmation (a digital PDF reads best) and try again.",
      model: "ingest+extract",
    };
  }

  report("Extracting the purchase order…");
  const answer = await predictChat(
    "Extract the purchase order as JSON. The text was OCR'd and may contain minor " +
      "errors — interpret it sensibly and still extract the order.",
    [PO_EXTRACT_SYSTEM, `DOCUMENT TEXT (extracted by ARAG):\n${text}`],
    { systemPrompt: PO_EXTRACT_SYSTEM }
  );
  const parsed = extractJson(answer) as Record<string, unknown> | null;

  if (
    !parsed ||
    parsed.notAPurchaseOrder === true ||
    !Array.isArray(parsed.lines) ||
    parsed.lines.length === 0
  ) {
    // Image OCR often reads the header but misses the line-items table; a
    // text-layer PDF extracts cleanly. Steer the user to the better input.
    const wasImage = mimeType.startsWith("image/");
    return {
      draft: null,
      lowConfidence: true,
      message: wasImage
        ? "Read the document, but couldn't pull the line items from this image — " +
          "screenshots and photos often lose the table. For best results, upload the " +
          "original PDF of the purchase order."
        : "Read the document, but couldn't extract line items. Make " +
          "sure it's a supplier invoice, PO or order confirmation and try again.",
      model: "ingest+extract",
    };
  }

  report("Matching to your catalogue…");

  // Match supplier by name (exact, then contains either direction).
  const supplierName =
    typeof parsed.supplierName === "string" ? parsed.supplierName.trim() : null;
  let matchedSupplierId: string | null = null;
  let matchedSupplierName: string | null = null;
  if (supplierName) {
    const suppliers = await prisma.supplier.findMany({
      select: { id: true, name: true },
    });
    const hit = matchSupplierName(supplierName, suppliers);
    if (hit) {
      matchedSupplierId = hit.id;
      matchedSupplierName = hit.name;
    }
  }

  // 3-way match: link this bill to one of our Purchase Orders. Prefer the PO
  // number the document references (poRef); otherwise, if the matched supplier
  // has exactly one still-open PO, suggest that. The user confirms in review.
  const poRef = typeof parsed.poRef === "string" ? parsed.poRef.trim() : null;
  let matchedPurchaseOrderId: string | null = null;
  let matchedPurchaseOrderNumber: string | null = null;
  if (poRef) {
    // A referenced PO number is globally unique — match across all POs.
    const needle = poRef.toLowerCase().replace(/\s+/g, "");
    const allPos = await prisma.purchaseOrder.findMany({
      select: { id: true, poNumber: true },
      orderBy: { createdAt: "desc" },
    });
    const hit = allPos.find((p) => {
      const n = p.poNumber.toLowerCase().replace(/\s+/g, "");
      return n === needle || n.includes(needle) || needle.includes(n);
    });
    if (hit) {
      matchedPurchaseOrderId = hit.id;
      matchedPurchaseOrderNumber = hit.poNumber;
    }
  }
  if (!matchedPurchaseOrderId && matchedSupplierId) {
    // No referenced PO — if this supplier has exactly one still-open PO, suggest it.
    const open = await prisma.purchaseOrder.findMany({
      where: { supplierId: matchedSupplierId, status: { notIn: ["RECEIVED", "CANCELLED"] } },
      select: { id: true, poNumber: true },
    });
    if (open.length === 1) {
      matchedPurchaseOrderId = open[0].id;
      matchedPurchaseOrderNumber = open[0].poNumber;
    }
  }

  // Match each line against the inventory catalogue: exact SKU first, then a
  // case-insensitive name contains. Unmatched lines are flagged, not faked.
  const items = await prisma.inventoryItem.findMany({
    where: { active: true },
    select: { id: true, sku: true, name: true },
  });
  const bySku = new Map(items.map((i) => [i.sku.toLowerCase(), i]));

  const lines: DraftPoLine[] = (parsed.lines as unknown[]).map((l) => {
    const line = (l ?? {}) as Record<string, unknown>;
    const extracted: ExtractedPoLine = {
      description: typeof line.description === "string" ? line.description : "",
      sku: typeof line.sku === "string" && line.sku.trim() ? line.sku.trim() : null,
      quantity: num(line.quantity, 1),
      unitCost: num(line.unitCost, 0),
    };

    // 1) exact SKU, 2) exact name, 3) fuzzy contains. Exact matches (1 & 2) are
    // confident; only fuzzy (3) is flagged for the user to confirm.
    let match = extracted.sku ? bySku.get(extracted.sku.toLowerCase()) : undefined;
    let matchBy: DraftPoLine["matchBy"] = match ? "sku" : null;
    if (!match && extracted.description) {
      const desc = extracted.description.toLowerCase().trim();
      const exact = items.find((i) => i.name.toLowerCase() === desc);
      if (exact) {
        match = exact;
        matchBy = "name";
      } else {
        const head = desc.split(/[(,\-]/)[0].trim();
        match = items.find(
          (i) => desc.includes(i.name.toLowerCase()) || i.name.toLowerCase().includes(head)
        );
        if (match) matchBy = "fuzzy";
      }
    }
    return {
      ...extracted,
      matchedItemId: match?.id ?? null,
      matchedItemName: match?.name ?? null,
      matchedSku: match?.sku ?? null,
      matchBy,
    };
  });

  return {
    draft: {
      supplierName,
      supplierRef:
        typeof parsed.supplierRef === "string" ? parsed.supplierRef : null,
      poRef,
      orderDate: typeof parsed.orderDate === "string" ? parsed.orderDate : null,
      expectedDate:
        typeof parsed.expectedDate === "string" ? parsed.expectedDate : null,
      currency: typeof parsed.currency === "string" ? parsed.currency : null,
      matchedSupplierId,
      matchedSupplierName,
      matchedPurchaseOrderId,
      matchedPurchaseOrderNumber,
      lines,
    },
    lowConfidence: false,
    model: "ingest+extract",
  };
}

// ── L1: Duplicate / callback / warranty detection ────────────────────────
//
// On a work order, compare it against other jobs at the SAME site: open
// ones (possible duplicate) and recently-completed ones (possible callback
// / warranty rework). The candidate set is deterministic (same site); ARAG
// makes the semantic judgement of which are genuinely related.

const CALLBACK_WINDOW_DAYS = 120;

export async function flagSimilarWorkOrders(workOrderId: string): Promise<{
  duplicates: { workOrder: string; reason: string; confidence: string }[];
  callbacks: { workOrder: string; reason: string; confidence: string }[];
  summary: string;
  checked: number;
} | null> {
  const wo = await prisma.workOrder.findUnique({
    where: { id: workOrderId },
    include: { site: true },
  });
  if (!wo) return null;

  const since = new Date(Date.now() - CALLBACK_WINDOW_DAYS * 86400_000);
  const siblings = await prisma.workOrder.findMany({
    where: {
      siteId: wo.siteId,
      id: { not: wo.id },
      OR: [
        { status: { notIn: TERMINAL } },
        { status: { in: ["COMPLETED", "INVOICED", "CLOSED"] }, updatedAt: { gte: since } },
      ],
    },
    orderBy: { updatedAt: "desc" },
    take: 20,
    select: {
      workOrderNumber: true, title: true, description: true,
      status: true, jobType: true, updatedAt: true, completionNotes: true,
    },
  });

  if (siblings.length === 0) {
    return {
      duplicates: [], callbacks: [],
      summary: "No other recent jobs at this site to compare against.",
      checked: 0,
    };
  }

  const open = siblings.filter((s) => !TERMINAL.includes(s.status));
  const completed = siblings.filter((s) =>
    ["COMPLETED", "INVOICED", "CLOSED"].includes(s.status)
  );

  const context = {
    target: {
      number: wo.workOrderNumber, title: wo.title,
      description: wo.description, jobType: wo.jobType,
      site: `${wo.site.name}, ${wo.site.suburb}`,
    },
    openJobsAtSite: open.map((s) => ({
      number: s.workOrderNumber, title: s.title, description: s.description, jobType: s.jobType,
    })),
    recentlyCompletedAtSite: completed.map((s) => ({
      number: s.workOrderNumber, title: s.title, jobType: s.jobType,
      completedNote: s.completionNotes, when: s.updatedAt.toISOString().slice(0, 10),
    })),
  };

  const system =
    "You are a quality-control checker for a property-maintenance company. " +
    "Given a TARGET work order and other jobs at the SAME site, identify: " +
    "(1) DUPLICATES — open jobs that appear to be the same work as the target; " +
    "(2) CALLBACKS — recently completed jobs the target appears to be rework of " +
    "(a warranty/callback risk, i.e. the same problem coming back). " +
    "Only flag genuine matches by trade and symptom — do not force matches. " +
    'Return ONLY JSON: {"duplicates":[{"workOrder":"WO-...","reason":string,' +
    '"confidence":"high|medium|low"}],"callbacks":[{"workOrder":"WO-...",' +
    '"reason":string,"confidence":"high|medium|low"}],"summary":string}. ' +
    "Empty arrays if nothing matches.";

  const raw = await predictChat(
    "Check for duplicates and callbacks.",
    [system, `DATA:\n${JSON.stringify(context)}`],
    { systemPrompt: system }
  );
  const parsed = extractJson(raw) as {
    duplicates?: { workOrder: string; reason: string; confidence: string }[];
    callbacks?: { workOrder: string; reason: string; confidence: string }[];
    summary?: string;
  } | null;

  return {
    duplicates: parsed?.duplicates ?? [],
    callbacks: parsed?.callbacks ?? [],
    summary: parsed?.summary ?? "No clear duplicates or callbacks found.",
    checked: siblings.length,
  };
}

// ── L2: Parts prediction / job kitting ───────────────────────────────────
//
// Predict the parts a tech should load for a job, grounded in ACTUAL stock
// consumption (CONSUMED_ON_JOB) on comparable completed jobs of the same
// type — quantitative, vs the playbook's generic "typical materials".

export async function suggestPartsKit(workOrderId: string): Promise<{
  kit: { sku: string; name: string; quantity: number; reason: string }[];
  usage: { sku: string; name: string; jobsUsedOn: number; avgQty: number }[];
  lowConfidence: boolean;
  message?: string;
} | null> {
  const wo = await prisma.workOrder.findUnique({
    where: { id: workOrderId },
    select: { id: true, title: true, description: true, jobType: true },
  });
  if (!wo) return null;

  const comps = await prisma.workOrder.findMany({
    where: {
      jobType: wo.jobType,
      status: { in: ["COMPLETED", "INVOICED", "CLOSED"] },
      id: { not: wo.id },
    },
    orderBy: { updatedAt: "desc" },
    take: 25,
    select: { id: true },
  });
  const compIds = comps.map((c) => c.id);

  const moves = compIds.length
    ? await prisma.stockMovement.findMany({
        where: { workOrderId: { in: compIds }, movementType: "CONSUMED_ON_JOB" },
        select: { inventoryItemId: true, quantity: true, workOrderId: true, inventoryItem: { select: { sku: true, name: true } } },
      })
    : [];

  if (moves.length === 0) {
    return {
      kit: [], usage: [], lowConfidence: true,
      message: "No parts-usage history for comparable jobs yet — can't suggest a kit confidently.",
    };
  }

  // Aggregate consumption per item across comparable jobs.
  const agg = new Map<string, { sku: string; name: string; qty: number; jobs: Set<string> }>();
  for (const m of moves) {
    const k = m.inventoryItemId;
    const cur = agg.get(k) ?? { sku: m.inventoryItem.sku, name: m.inventoryItem.name, qty: 0, jobs: new Set() };
    cur.qty += m.quantity;
    if (m.workOrderId) cur.jobs.add(m.workOrderId);
    agg.set(k, cur);
  }
  const usage = [...agg.values()]
    .map((u) => ({ sku: u.sku, name: u.name, jobsUsedOn: u.jobs.size, avgQty: Math.round((u.qty / u.jobs.size) * 10) / 10 }))
    .sort((a, b) => b.jobsUsedOn - a.jobsUsedOn)
    .slice(0, 15);

  const system =
    "You are a field-logistics assistant for a property-maintenance company. " +
    "Given a job and the parts ACTUALLY consumed on comparable past jobs (with " +
    "how many jobs used each and the average quantity), recommend a kit to load. " +
    "Prefer items used on many comparable jobs. Round quantities sensibly. " +
    'Return ONLY JSON: {"kit":[{"sku":string,"name":string,"quantity":number,' +
    '"reason":string}],"notes":string}. Only include parts that fit the job.';

  const raw = await predictChat(
    "Recommend the parts kit.",
    [system, `JOB:\n${JSON.stringify({ title: wo.title, description: wo.description, jobType: wo.jobType })}\nHISTORICAL USAGE:\n${JSON.stringify(usage)}`],
    { systemPrompt: system }
  );
  const parsed = extractJson(raw) as { kit?: { sku: string; name: string; quantity: number; reason: string }[] } | null;

  return {
    kit: parsed?.kit ?? [],
    usage,
    lowConfidence: false,
  };
}

// ── L3: Technician day-plan narrative + clash detection ──────────────────

export async function technicianDayPlan(
  employeeId: string,
  dateISO?: string
): Promise<{
  technician: string;
  date: string;
  jobs: { workOrder: string; title: string; site: string; start: string | null; end: string | null; priority: string }[];
  clashes: { a: string; b: string }[];
  narrative: string;
} | null> {
  const emp = await prisma.employee.findUnique({ where: { id: employeeId } });
  if (!emp) return null;

  const day = dateISO ? new Date(dateISO) : new Date();
  const start = new Date(day); start.setHours(0, 0, 0, 0);
  const end = new Date(day); end.setHours(23, 59, 59, 999);

  const wos = await prisma.workOrder.findMany({
    where: {
      assignedEmployeeId: employeeId,
      scheduledStart: { gte: start, lte: end },
    },
    orderBy: { scheduledStart: "asc" },
    include: { site: true },
  });

  const jobs = wos.map((w) => ({
    workOrder: w.workOrderNumber,
    title: w.title,
    site: `${w.site.name}, ${w.site.suburb}`,
    start: w.scheduledStart?.toISOString() ?? null,
    end: w.scheduledEnd?.toISOString() ?? null,
    priority: w.priority,
  }));

  // Deterministic time-overlap detection.
  const clashes: { a: string; b: string }[] = [];
  for (let i = 0; i < wos.length; i++) {
    for (let j = i + 1; j < wos.length; j++) {
      const a = wos[i], b = wos[j];
      if (a.scheduledStart && a.scheduledEnd && b.scheduledStart && b.scheduledEnd) {
        if (a.scheduledStart < b.scheduledEnd && b.scheduledStart < a.scheduledEnd) {
          clashes.push({ a: a.workOrderNumber, b: b.workOrderNumber });
        }
      }
    }
  }

  const dateStr = start.toISOString().slice(0, 10);
  if (jobs.length === 0) {
    return { technician: `${emp.firstName} ${emp.lastName}`, date: dateStr, jobs, clashes, narrative: "No jobs scheduled for this day." };
  }

  const system =
    "You are a dispatch assistant for a property-maintenance company. " +
    "Given a technician's scheduled jobs for one day (with sites/suburbs and any " +
    "detected time clashes), write a short brief: the run order, any time clashes " +
    "to fix, and wasteful travel between suburbs (suggest a better order if useful). " +
    "Be concise — a few bullet points. Use the actual WO numbers and suburbs.";

  const narrative = await predictChat(
    "Brief this technician's day.",
    [system, `DATA:\n${JSON.stringify({ technician: `${emp.firstName} ${emp.lastName}`, territory: emp.territory, jobs, clashes })}`],
    { systemPrompt: system }
  );

  return { technician: `${emp.firstName} ${emp.lastName}`, date: dateStr, jobs, clashes, narrative };
}

// ── H1: Completion-note writer ───────────────────────────────────────────

export async function draftCompletionNote(workOrderId: string): Promise<{
  draft: string;
  lowConfidence: boolean;
  message?: string;
} | null> {
  const wo = await prisma.workOrder.findUnique({
    where: { id: workOrderId },
    include: {
      site: true,
      assignedEmployee: true,
      requiredSkills: { include: { skill: true } },
      timeEntries: { orderBy: { date: "asc" } },
      stockMovements: { where: { movementType: "CONSUMED_ON_JOB" }, include: { inventoryItem: true } },
    },
  });
  if (!wo) return null;

  const context = {
    title: wo.title,
    description: wo.description,
    jobType: wo.jobType,
    site: `${wo.site.name}, ${wo.site.suburb}`,
    technician: wo.assignedEmployee ? `${wo.assignedEmployee.firstName} ${wo.assignedEmployee.lastName}` : null,
    skills: wo.requiredSkills.map((s) => s.skill.name),
    hoursLogged: wo.timeEntries.reduce((s, t) => s + t.hours, 0),
    timeEntryNotes: wo.timeEntries.map((t) => t.notes).filter(Boolean),
    partsUsed: wo.stockMovements.map((m) => `${m.quantity}× ${m.inventoryItem.name}`),
    customerNotes: wo.customerNotes,
  };

  const system =
    "You are a maintenance technician writing the completion note for a finished job. " +
    "Using ONLY the job data provided, write a concise, professional completion note " +
    "(3–5 sentences): what was done, parts used, and any follow-up. Plain prose, " +
    "first-person plural ('we'). Do not invent work that isn't supported by the data. " +
    "If there's very little data, write a brief note and say a manual review is advised.";

  const draft = await predictChat(
    "Write the completion note.",
    [system, `JOB DATA:\n${JSON.stringify(context)}`],
    { systemPrompt: system }
  );
  return { draft: draft.trim(), lowConfidence: isLowConfidenceAnswer(draft) };
}

// ── H3: Work-order timeline narrative ────────────────────────────────────

export async function workOrderTimeline(workOrderId: string): Promise<{
  events: { when: string; event: string }[];
  narrative: string;
} | null> {
  const wo = await prisma.workOrder.findUnique({
    where: { id: workOrderId },
    include: {
      timeEntries: { orderBy: { date: "asc" }, include: { employee: true } },
      quotes: { orderBy: { createdAt: "asc" } },
      invoices: { orderBy: { createdAt: "asc" } },
      account: true,
    },
  });
  if (!wo) return null;

  // Build an event list from the timestamps we actually have.
  const events: { when: string; event: string }[] = [];
  const push = (d: Date | null, e: string) => { if (d) events.push({ when: d.toISOString(), event: e }); };
  push(wo.createdAt, `Job raised: ${wo.title}`);
  push(wo.scheduledStart, `Scheduled to start`);
  for (const t of wo.timeEntries) {
    push(t.date, `${t.employee.firstName} ${t.employee.lastName} logged ${t.hours}h${t.notes ? ` — ${t.notes}` : ""}`);
  }
  for (const q of wo.quotes) push(q.createdAt, `Quote ${q.quoteNumber} (${q.status}), total ${q.total}`);
  push(wo.status === "COMPLETED" || wo.status === "INVOICED" || wo.status === "CLOSED" ? wo.updatedAt : null, `Marked ${wo.status}`);
  for (const inv of wo.invoices) push(inv.createdAt, `Invoice ${inv.invoiceNumber} (${inv.status}), total ${inv.total}`);
  events.sort((a, b) => a.when.localeCompare(b.when));

  const system =
    "You are summarising the history of a maintenance job for a handover/dispute. " +
    "Given the ordered events, write 2–3 sentences in plain English describing what " +
    "happened on this job from start to finish. Reference the work order number. " +
    "Use only the events provided — do not invent anything.";

  const narrative = await predictChat(
    "Summarise this job's history.",
    [system, `WORK ORDER ${wo.workOrderNumber} for ${wo.account.name}\nEVENTS:\n${JSON.stringify(events)}`],
    { systemPrompt: system }
  );
  return { events, narrative: narrative.trim() };
}

// ── H4: Site access briefing ─────────────────────────────────────────────

export async function siteAccessBriefing(workOrderId: string): Promise<{
  site: { name: string; address: string; contact: string | null; phone: string | null; window: string | null; pets: boolean; accessNotes: string | null };
  briefing: string;
} | null> {
  const wo = await prisma.workOrder.findUnique({
    where: { id: workOrderId },
    include: { site: true },
  });
  if (!wo) return null;
  const s = wo.site;
  const site = {
    name: s.name,
    address: `${s.address}, ${s.suburb} ${s.state} ${s.postcode}`,
    contact: s.siteContactName,
    phone: s.siteContactPhone,
    window: s.preferredVisitWindow,
    pets: s.petsOnSite,
    accessNotes: s.accessNotes,
  };

  const system =
    "You are briefing a technician before they arrive on site. Using ONLY the site " +
    "data, write a short 'before you arrive' note: who to contact, the access/parking " +
    "notes, the preferred visit window, and any warnings (e.g. pets on site). Keep it " +
    "to a few short bullet points. If a detail is missing, omit it — don't invent it.";

  const briefing = await predictChat(
    "Write the site access briefing.",
    [system, `JOB: ${wo.title}\nSITE DATA:\n${JSON.stringify(site)}`],
    { systemPrompt: system }
  );
  return { site, briefing: briefing.trim() };
}

// ── H5: Time-entry anomaly flag ──────────────────────────────────────────

export async function timeEntryAnomaly(workOrderId: string): Promise<{
  workOrder: string;
  loggedHours: number;
  typicalHours: number;
  comparableJobs: number;
  flagged: boolean;
  narrative: string;
} | null> {
  const wo = await prisma.workOrder.findUnique({
    where: { id: workOrderId },
    include: { timeEntries: true },
  });
  if (!wo) return null;
  const loggedHours = wo.timeEntries.reduce((s, t) => s + t.hours, 0);

  // Typical hours = mean total logged hours across comparable completed jobs.
  const comps = await prisma.workOrder.findMany({
    where: { jobType: wo.jobType, status: { in: ["COMPLETED", "INVOICED", "CLOSED"] }, id: { not: wo.id } },
    include: { timeEntries: true },
    take: 40,
  });
  const totals = comps
    .map((c) => c.timeEntries.reduce((s, t) => s + t.hours, 0))
    .filter((h) => h > 0);
  const typicalHours = totals.length
    ? Math.round((totals.reduce((a, b) => a + b, 0) / totals.length) * 10) / 10
    : 0;

  // Flag if logged is >1.75× typical (and we have a baseline).
  const flagged = typicalHours > 0 && loggedHours > typicalHours * 1.75;

  let narrative = "";
  if (typicalHours === 0) {
    narrative = "No comparable jobs with logged time yet — can't assess.";
  } else if (flagged) {
    const system =
      "You are a job-costing reviewer. The logged hours on a job are well above the " +
      "typical for its type. In one or two sentences, flag this for review before " +
      "invoicing, citing the numbers. Be matter-of-fact.";
    narrative = (await predictChat(
      "Flag this time anomaly.",
      [system, `JOB ${wo.workOrderNumber} (${wo.jobType}): logged ${loggedHours}h vs typical ${typicalHours}h across ${totals.length} comparable jobs.`],
      { systemPrompt: system }
    )).trim();
  } else {
    narrative = `Logged ${loggedHours}h is in line with the typical ${typicalHours}h for ${wo.jobType} jobs.`;
  }

  return { workOrder: wo.workOrderNumber, loggedHours, typicalHours, comparableJobs: totals.length, flagged, narrative };
}

// ── I1: Lost-quote / rejection analysis ──────────────────────────────────

export async function analyzeLostQuotes(): Promise<{
  rejectedCount: number;
  byJobType: Record<string, number>;
  analysis: string;
  lowConfidence: boolean;
}> {
  const rejected = await prisma.quote.findMany({
    where: { status: { in: ["REJECTED", "EXPIRED"] } },
    include: { workOrder: { select: { jobType: true, title: true } }, account: { select: { name: true, type: true } } },
    orderBy: { updatedAt: "desc" },
    take: 60,
  });
  if (rejected.length === 0) {
    return { rejectedCount: 0, byJobType: {}, analysis: "No rejected or expired quotes to analyse.", lowConfidence: true };
  }
  const byJobType: Record<string, number> = {};
  for (const q of rejected) {
    const jt = q.workOrder?.jobType ?? "UNKNOWN";
    byJobType[jt] = (byJobType[jt] ?? 0) + 1;
  }
  const sample = rejected.slice(0, 40).map((q) => ({
    jobType: q.workOrder?.jobType, title: q.workOrder?.title,
    accountType: q.account?.type, total: q.total, marginPercent: q.marginPercent, status: q.status,
  }));
  const system =
    "You are a sales analyst for a property-maintenance company. Given quotes that were " +
    "rejected or expired, identify patterns: which job types / account types / price bands " +
    "lose most, and plausible reasons (pricing, margin, job mix). Be concise — a few bullets " +
    "with the numbers. Use ONLY the data; flag where the data is too thin to conclude.";
  const analysis = await predictChat(
    "Analyse our lost quotes.",
    [system, `REJECTED/EXPIRED QUOTES (count ${rejected.length}):\n${JSON.stringify({ byJobType, sample })}`],
    { systemPrompt: system }
  );
  return { rejectedCount: rejected.length, byJobType, analysis: analysis.trim(), lowConfidence: isLowConfidenceAnswer(analysis) };
}

// ── I2: Account health & churn risk ──────────────────────────────────────

export async function accountHealth(accountId: string): Promise<{
  account: string;
  metrics: Record<string, number>;
  narrative: string;
} | null> {
  const acct = await prisma.account.findUnique({ where: { id: accountId } });
  if (!acct) return null;
  const now = new Date();
  const ninetyAgo = new Date(now.getTime() - 90 * 86400000);

  const [totalJobs, recentJobs, openJobs, quotes, overdue, lastJob] = await Promise.all([
    prisma.workOrder.count({ where: { accountId } }),
    prisma.workOrder.count({ where: { accountId, createdAt: { gte: ninetyAgo } } }),
    prisma.workOrder.count({ where: { accountId, status: { in: OPEN } } }),
    prisma.quote.findMany({ where: { accountId }, select: { status: true } }),
    prisma.invoice.findMany({ where: { accountId, status: { in: ["SENT", "OVERDUE"] }, dueAt: { lt: now } }, select: { total: true } }),
    prisma.workOrder.findFirst({ where: { accountId }, orderBy: { createdAt: "desc" }, select: { createdAt: true } }),
  ]);
  const rejected = quotes.filter((q) => ["REJECTED", "EXPIRED"].includes(q.status)).length;
  const rejectionRate = quotes.length ? Math.round((rejected / quotes.length) * 100) : 0;
  const overdueTotal = Math.round(overdue.reduce((s, i) => s + i.total, 0));
  const daysSinceLastJob = lastJob ? Math.round((now.getTime() - lastJob.createdAt.getTime()) / 86400000) : -1;

  const metrics = { totalJobs, jobsLast90Days: recentJobs, openJobs, quoteRejectionRatePct: rejectionRate, overdueInvoiceTotal: overdueTotal, daysSinceLastJob };
  const system =
    "You are an account manager for a property-maintenance company. Given a customer's " +
    "activity metrics, write a short health summary and flag churn or payment risk. " +
    "2–4 sentences, concrete, citing the numbers. Use ONLY the metrics provided.";
  const narrative = await predictChat(
    "Assess this account's health.",
    [system, `ACCOUNT ${acct.name} (${acct.type}) METRICS:\n${JSON.stringify(metrics)}`],
    { systemPrompt: system }
  );
  return { account: acct.name, metrics, narrative: narrative.trim() };
}

// ── I3: Invoice dunning ladder (draft only — never auto-sends) ────────────

export async function draftDunning(invoiceId: string): Promise<{
  invoice: string;
  account: string;
  daysOverdue: number;
  draft: string;
} | null> {
  const inv = await prisma.invoice.findUnique({ where: { id: invoiceId }, include: { account: true } });
  if (!inv) return null;
  const now = new Date();
  const daysOverdue = inv.dueAt ? Math.max(0, Math.round((now.getTime() - inv.dueAt.getTime()) / 86400000)) : 0;
  const tone = daysOverdue < 14 ? "friendly first reminder" : daysOverdue < 45 ? "firmer follow-up" : "final notice before collections";
  const system =
    "You are drafting an overdue-invoice reminder email for a property-maintenance company. " +
    `Write a ${tone} appropriate to ${daysOverdue} days overdue. Professional, courteous, ` +
    "include the invoice number, amount and days overdue, and a clear call to pay. " +
    "Output the email body only (no headers). This is a DRAFT a human will review and send.";
  const draft = await predictChat(
    "Draft the reminder.",
    [system, `INVOICE ${inv.invoiceNumber} to ${inv.account.name}: $${inv.total}, ${daysOverdue} days overdue.`],
    { systemPrompt: system }
  );
  return { invoice: inv.invoiceNumber, account: inv.account.name, daysOverdue, draft: draft.trim() };
}

// ── I4: Fleet compliance watchdog ────────────────────────────────────────

export async function fleetComplianceDigest(withinDays = 30): Promise<{
  dueVehicles: { name: string; registration: string; serviceDueAt: string | null; registrationDueAt: string | null }[];
  narrative: string;
}> {
  const cutoff = new Date(Date.now() + withinDays * 86400000);
  const vehicles = await prisma.vehicle.findMany({
    where: { active: true, OR: [{ serviceDueAt: { lte: cutoff } }, { registrationDueAt: { lte: cutoff } }] },
    orderBy: [{ registrationDueAt: "asc" }],
  });
  const dueVehicles = vehicles.map((v) => ({
    name: v.name, registration: v.registration,
    serviceDueAt: v.serviceDueAt?.toISOString().slice(0, 10) ?? null,
    registrationDueAt: v.registrationDueAt?.toISOString().slice(0, 10) ?? null,
  }));
  if (dueVehicles.length === 0) {
    return { dueVehicles, narrative: `No vehicles have service or registration due in the next ${withinDays} days.` };
  }
  const system =
    "You are a fleet coordinator. Given vehicles with service or registration due soon, " +
    "write a short prioritised digest: which to book first and why (rego lapses are urgent). " +
    "A few bullets, cite vehicle names and dates. Use only the data.";
  const narrative = await predictChat(
    "Summarise fleet compliance due soon.",
    [system, `TODAY is the reference. VEHICLES DUE within ${withinDays} days:\n${JSON.stringify(dueVehicles)}`],
    { systemPrompt: system }
  );
  return { dueVehicles, narrative: narrative.trim() };
}

// ── I5: Recurring-run preview ────────────────────────────────────────────

export async function recurringRunPreview(): Promise<{
  plansDue: { title: string; account: string; site: string; nextRunAt: string | null }[];
  narrative: string;
}> {
  const now = new Date();
  const plans = await prisma.recurringPlan.findMany({
    where: { active: true, nextRunAt: { lte: now } },
    include: { account: true, site: true },
    orderBy: { nextRunAt: "asc" },
  });
  const plansDue = plans.map((p) => ({
    title: p.title, account: p.account.name, site: `${p.site.name}, ${p.site.suburb}`,
    nextRunAt: p.nextRunAt?.toISOString().slice(0, 10) ?? null,
  }));
  if (plansDue.length === 0) {
    return { plansDue, narrative: "No recurring plans are due to run." };
  }
  // Detect sites with multiple plans stacking (batching opportunity).
  const bySite = new Map<string, number>();
  for (const p of plansDue) bySite.set(p.site, (bySite.get(p.site) ?? 0) + 1);
  const stacking = [...bySite.entries()].filter(([, n]) => n > 1);
  const system =
    "You are a scheduling coordinator. Given recurring maintenance plans due to run " +
    "(each creates a work order), summarise what this run produces and call out sites where " +
    "multiple jobs stack (a batching opportunity). A few bullets. Use only the data.";
  const narrative = await predictChat(
    "Preview this recurring run.",
    [system, `PLANS DUE (${plansDue.length}):\n${JSON.stringify({ plansDue, stackingSites: stacking })}`],
    { systemPrompt: system }
  );
  return { plansDue, narrative: narrative.trim() };
}

// ── I6: Demand-aware reorder ─────────────────────────────────────────────

export async function demandAwareReorder(): Promise<{
  lowStock: { name: string; available: number; reorderPoint: number }[];
  upcomingJobs: number;
  narrative: string;
}> {
  const now = new Date();
  const nextFortnight = new Date(now.getTime() + 14 * 86400000);
  const stock = await computeStockLevels();
  const lowStock = stock.filter((s) => s.lowStock).map((s) => ({ name: s.name, available: s.totalQuantity, reorderPoint: s.reorderPoint }));
  const upcoming = await prisma.workOrder.findMany({
    where: { scheduledStart: { gte: now, lt: nextFortnight }, status: { in: OPEN } },
    select: { jobType: true, title: true },
  });
  if (lowStock.length === 0) {
    return { lowStock, upcomingJobs: upcoming.length, narrative: "No items are below their reorder point." };
  }
  const jobMix: Record<string, number> = {};
  for (const w of upcoming) jobMix[w.jobType] = (jobMix[w.jobType] ?? 0) + 1;
  const system =
    "You are an inventory planner. Given items below reorder point and the mix of jobs " +
    "scheduled in the next two weeks, recommend what to reorder first — prioritise items " +
    "likely needed by upcoming jobs. A few bullets, cite the numbers. Use only the data.";
  const narrative = await predictChat(
    "Recommend reorders given upcoming demand.",
    [system, `LOW STOCK:\n${JSON.stringify(lowStock)}\nUPCOMING JOB MIX (next 14 days):\n${JSON.stringify(jobMix)}`],
    { systemPrompt: system }
  );
  return { lowStock, upcomingJobs: upcoming.length, narrative: narrative.trim() };
}

// ── I7: Skill-coverage gap signal ────────────────────────────────────────

export async function skillGapSignal(): Promise<{
  uncoveredSkills: { skill: string; openJobsNeeding: number; activeHolders: number }[];
  narrative: string;
}> {
  // Skills required by open jobs.
  const openReqs = await prisma.workOrderRequiredSkill.findMany({
    where: { workOrder: { status: { in: OPEN } } },
    include: { skill: true },
  });
  // Active employees' held skills → count per skill.
  const holders = await prisma.employeeSkill.findMany({
    where: { employee: { active: true } },
    include: { skill: true },
  });
  const holderCount = new Map<string, number>();
  for (const h of holders) holderCount.set(h.skill.name, (holderCount.get(h.skill.name) ?? 0) + 1);
  const needCount = new Map<string, number>();
  for (const r of openReqs) needCount.set(r.skill.name, (needCount.get(r.skill.name) ?? 0) + 1);

  const uncoveredSkills = [...needCount.entries()]
    .map(([skill, openJobsNeeding]) => ({ skill, openJobsNeeding, activeHolders: holderCount.get(skill) ?? 0 }))
    .filter((s) => s.activeHolders <= 1) // 0 = nobody; 1 = single point of failure
    .sort((a, b) => b.openJobsNeeding - a.openJobsNeeding);

  if (uncoveredSkills.length === 0) {
    return { uncoveredSkills, narrative: "Every skill required by open jobs has at least two active holders — no coverage gap." };
  }
  const system =
    "You are a workforce planner. Given skills required by open jobs that have zero or only " +
    "one active holder, flag the coverage gaps and the hiring/cross-training signal. A few " +
    "bullets, cite the numbers. Use only the data.";
  const narrative = await predictChat(
    "Assess skill coverage gaps.",
    [system, `UNCOVERED/THIN SKILLS:\n${JSON.stringify(uncoveredSkills)}`],
    { systemPrompt: system }
  );
  return { uncoveredSkills, narrative: narrative.trim() };
}

// ── K1: Proactive maintenance / cross-sell suggester ─────────────────────

export async function proactiveMaintenance(accountId: string): Promise<{
  account: string;
  history: { jobType: string; count: number; lastDone: string | null }[];
  suggestions: string;
  lowConfidence: boolean;
} | null> {
  const acct = await prisma.account.findUnique({ where: { id: accountId } });
  if (!acct) return null;
  const jobs = await prisma.workOrder.findMany({
    where: { accountId },
    orderBy: { createdAt: "desc" },
    select: { jobType: true, title: true, createdAt: true },
    take: 200,
  });
  if (jobs.length === 0) {
    return { account: acct.name, history: [], suggestions: "No job history for this account yet.", lowConfidence: true };
  }
  const map = new Map<string, { count: number; last: Date }>();
  for (const j of jobs) {
    const cur = map.get(j.jobType) ?? { count: 0, last: j.createdAt };
    cur.count += 1;
    if (j.createdAt > cur.last) cur.last = j.createdAt;
    map.set(j.jobType, cur);
  }
  const history = [...map.entries()].map(([jobType, v]) => ({
    jobType, count: v.count, lastDone: v.last.toISOString().slice(0, 10),
  }));
  const system =
    "You are an account manager looking for proactive maintenance to offer a customer. " +
    "Given their job history (types, counts, when last done), suggest 2–3 services worth " +
    "proactively offering now (e.g. recurring work overdue for a refresh, seasonal work). " +
    "Frame as a customer offer. A few bullets. Use only the data; don't over-promise.";
  const suggestions = await predictChat(
    "Suggest proactive maintenance to offer.",
    [system, `ACCOUNT ${acct.name}. JOB HISTORY:\n${JSON.stringify(history)}\nTODAY is the reference date.`],
    { systemPrompt: system }
  );
  return { account: acct.name, history, suggestions: suggestions.trim(), lowConfidence: isLowConfidenceAnswer(suggestions) };
}

// ── K2: Job variation / scope-creep claim ────────────────────────────────

export async function variationClaim(workOrderId: string): Promise<{
  workOrder: string;
  quoted: { hours: number; total: number } | null;
  actual: { hours: number; cost: number; revenue: number };
  variance: { hours: number; marginPercent: number };
  draft: string;
  flagged: boolean;
} | null> {
  const wo = await prisma.workOrder.findUnique({
    where: { id: workOrderId },
    include: { quotes: { orderBy: { createdAt: "desc" }, take: 1 }, account: true },
  });
  if (!wo) return null;
  const costing = await computeJobCosting(wo.id);
  if (!costing) return null;
  const q = wo.quotes[0];
  const quoted = q ? { hours: q.labourHours, total: q.total } : null;
  const actual = { hours: costing.timesheetHours, cost: costing.totalActualCost, revenue: costing.revenue };
  const hoursVar = quoted ? Math.round((actual.hours - quoted.hours) * 10) / 10 : 0;
  const variance = { hours: hoursVar, marginPercent: Math.round(costing.grossMarginPercent) };
  // Flag if actual hours materially exceed quoted, or margin fell below threshold.
  const marginThreshold = await getMarginRiskThreshold();
  const flagged = (quoted !== null && quoted.hours > 0 && actual.hours > quoted.hours * 1.25) || costing.grossMarginPercent < marginThreshold * 100;

  const system =
    "You are drafting a variation / additional-works note for a maintenance job where the " +
    "actual work exceeded the quote. Using ONLY the figures, write a short, factual variation " +
    "note suitable to send the customer: what changed, the extra hours, and that a variation " +
    "applies. Neutral, professional. DRAFT for human review. If nothing materially exceeded " +
    "the quote, say no variation appears warranted.";
  const draft = await predictChat(
    "Draft the variation note.",
    [system, `WORK ORDER ${wo.workOrderNumber} for ${wo.account.name}\nQUOTED: ${JSON.stringify(quoted)}\nACTUAL: ${JSON.stringify(actual)}\nVARIANCE: ${JSON.stringify(variance)}`],
    { systemPrompt: system }
  );
  return { workOrder: wo.workOrderNumber, quoted, actual, variance, draft: draft.trim(), flagged };
}

// ── K3: Customer job-status update (draft) ───────────────────────────────

export async function customerStatusUpdate(workOrderId: string): Promise<{
  workOrder: string;
  status: string;
  draft: string;
} | null> {
  const wo = await prisma.workOrder.findUnique({
    where: { id: workOrderId },
    include: { account: true, site: true, assignedEmployee: true },
  });
  if (!wo) return null;
  const ctx = {
    title: wo.title, status: wo.status, jobType: wo.jobType,
    site: `${wo.site.name}, ${wo.site.suburb}`,
    technician: wo.assignedEmployee ? wo.assignedEmployee.firstName : null,
    scheduledStart: wo.scheduledStart?.toISOString().slice(0, 10) ?? null,
  };
  const system =
    "You are writing a brief, friendly status update to a customer about their maintenance " +
    "job. Using ONLY the data, write 2–3 sentences: current status, who's coming and when " +
    "(if scheduled/assigned), and next step. Warm but professional. DRAFT for human review.";
  const draft = await predictChat(
    "Write the customer status update.",
    [system, `CUSTOMER ${wo.account.name}. JOB:\n${JSON.stringify(ctx)}`],
    { systemPrompt: system }
  );
  return { workOrder: wo.workOrderNumber, status: wo.status, draft: draft.trim() };
}

// ── B3: SLA early-warning ────────────────────────────────────────────────

export async function slaEarlyWarning(withinHours = 48): Promise<{
  atRisk: { workOrder: string; account: string; slaDueAt: string | null; assigned: string | null; priority: string }[];
  narrative: string;
}> {
  const now = new Date();
  const horizon = new Date(now.getTime() + withinHours * 3600_000);
  const wos = await prisma.workOrder.findMany({
    where: { status: { in: OPEN }, slaDueAt: { gte: now, lte: horizon } },
    include: { account: true, assignedEmployee: true },
    orderBy: { slaDueAt: "asc" },
    take: 20,
  });
  const atRisk = wos.map((w) => ({
    workOrder: w.workOrderNumber, account: w.account.name,
    slaDueAt: w.slaDueAt?.toISOString() ?? null,
    assigned: w.assignedEmployee ? `${w.assignedEmployee.firstName} ${w.assignedEmployee.lastName}` : null,
    priority: w.priority,
  }));
  if (atRisk.length === 0) {
    return { atRisk, narrative: `No jobs are within ${withinHours}h of an SLA breach.` };
  }
  const system =
    "You are an operations coordinator. Given jobs approaching their SLA deadline (not yet " +
    "breached), write a short prioritised warning: which to action first and the recommended " +
    "step (assign / escalate / expedite), especially unassigned ones. Bullets, cite WO numbers.";
  const narrative = await predictChat(
    "Warn on jobs about to breach SLA.",
    [system, `JOBS WITHIN ${withinHours}h OF SLA:\n${JSON.stringify(atRisk)}`],
    { systemPrompt: system }
  );
  return { atRisk, narrative: narrative.trim() };
}

// ── C1: Quote risk check ─────────────────────────────────────────────────

export async function quoteRiskCheck(quoteId: string): Promise<{
  quote: string;
  marginPercent: number;
  comparableAvgMargin: number;
  narrative: string;
} | null> {
  const q = await prisma.quote.findUnique({
    where: { id: quoteId },
    include: { workOrder: { select: { jobType: true, title: true } } },
  });
  if (!q) return null;
  const comps = await prisma.quote.findMany({
    where: { workOrder: { jobType: q.workOrder?.jobType }, id: { not: q.id }, status: { in: ["APPROVED", "SENT"] } },
    select: { marginPercent: true, total: true, labourHours: true },
    take: 30,
  });
  const margins = comps.map((c) => c.marginPercent).filter((m) => m > 0);
  const comparableAvgMargin = margins.length ? Math.round(margins.reduce((a, b) => a + b, 0) / margins.length) : 0;
  const marginThreshold = await getMarginRiskThreshold();
  const system =
    "You are a commercial reviewer checking a draft quote against comparable jobs. " +
    "Flag under-pricing (margin well below comparable/threshold) or over-pricing (total far " +
    "above comparable). 1–3 sentences, cite the numbers. Use only the data.";
  const narrative = await predictChat(
    "Check this quote for pricing risk.",
    [system, `QUOTE ${q.quoteNumber} (${q.workOrder?.jobType}): margin ${q.marginPercent}%, total ${q.total}, labourHours ${q.labourHours}. ` +
      `COMPARABLE avg margin ${comparableAvgMargin}% across ${margins.length} quotes. Min acceptable margin ${Math.round(marginThreshold * 100)}%.`],
    { systemPrompt: system }
  );
  return { quote: q.quoteNumber, marginPercent: q.marginPercent, comparableAvgMargin, narrative: narrative.trim() };
}

// ── C2: Brand-voice comms drafting (quote cover note / follow-up) ─────────

export async function draftQuoteComms(quoteId: string, kind: "cover" | "followup" = "cover"): Promise<{
  quote: string;
  kind: string;
  draft: string;
} | null> {
  const q = await prisma.quote.findUnique({
    where: { id: quoteId },
    include: { account: true, workOrder: { select: { title: true } } },
  });
  if (!q) return null;
  const what = kind === "followup"
    ? "a polite follow-up nudging the customer to approve the quote"
    : "a warm cover note to accompany the quote when sending it";
  const system =
    `You are drafting ${what} for a property-maintenance company. Professional and friendly, ` +
    "reference the job and quote total, keep it short. Output the email body only. DRAFT for review.";
  const draft = await predictChat(
    "Draft the message.",
    [system, `CUSTOMER ${q.account.name}. JOB: ${q.workOrder?.title}. QUOTE ${q.quoteNumber}, total $${q.total}, valid until ${q.validUntil?.toISOString().slice(0, 10) ?? "n/a"}.`],
    { systemPrompt: system }
  );
  return { quote: q.quoteNumber, kind, draft: draft.trim() };
}

// ── C3: Win/loss & margin insight ────────────────────────────────────────

export async function marginInsight(): Promise<{
  byJobType: { jobType: string; jobs: number; avgMarginPercent: number }[];
  narrative: string;
}> {
  const completed = await prisma.workOrder.findMany({
    where: { status: { in: ["COMPLETED", "INVOICED", "CLOSED"] } },
    orderBy: { updatedAt: "desc" },
    take: 120,
    select: { id: true, jobType: true },
  });
  const acc = new Map<string, { jobs: number; marginSum: number }>();
  for (const w of completed) {
    const c = await computeJobCosting(w.id);
    if (c && c.revenue > 0) {
      const cur = acc.get(w.jobType) ?? { jobs: 0, marginSum: 0 };
      cur.jobs += 1; cur.marginSum += c.grossMarginPercent;
      acc.set(w.jobType, cur);
    }
  }
  const byJobType = [...acc.entries()]
    .map(([jobType, v]) => ({ jobType, jobs: v.jobs, avgMarginPercent: Math.round(v.marginSum / v.jobs) }))
    .sort((a, b) => a.avgMarginPercent - b.avgMarginPercent);
  if (byJobType.length === 0) {
    return { byJobType, narrative: "Not enough costed completed jobs to analyse margin." };
  }
  const system =
    "You are a margin analyst for a property-maintenance company. Given average gross margin " +
    "by job type, explain where margin is leaking and which job types to review on pricing or " +
    "cost. A few bullets, cite the numbers. Use only the data.";
  const narrative = await predictChat(
    "Where are we losing margin?",
    [system, `AVG MARGIN BY JOB TYPE:\n${JSON.stringify(byJobType)}`],
    { systemPrompt: system }
  );
  return { byJobType, narrative: narrative.trim() };
}

// ── D1: Smart job intake / triage ────────────────────────────────────────

export async function triageRequest(requestText: string): Promise<{
  triage: { jobType: string; priority: string; requiredSkills: string[]; suggestedSlaHours: number; summary: string } | null;
  raw?: string;
}> {
  const skills = await prisma.skill.findMany({ select: { name: true } });
  const system =
    "You are triaging an inbound maintenance request for a property-maintenance company. " +
    "Classify it and return ONLY JSON: " +
    '{"jobType":"REPAIR|MAINTENANCE|INSPECTION|EMERGENCY|RECURRING_SERVICE",' +
    '"priority":"LOW|NORMAL|HIGH|URGENT","requiredSkills":string[],"suggestedSlaHours":number,' +
    '"summary":string}. Pick requiredSkills from this list where applicable: ' +
    JSON.stringify(skills.map((s) => s.name)) + ". Be realistic about priority and SLA.";
  const raw = await predictChat(
    "Triage this request.",
    [system, `REQUEST:\n${requestText}`],
    { systemPrompt: system }
  );
  const triage = extractJson(raw) as {
    jobType: string; priority: string; requiredSkills: string[]; suggestedSlaHours: number; summary: string;
  } | null;
  return { triage, raw: triage ? undefined : raw };
}

// ── D3: Safety pre-flight (safety docs via /ask + skill check) ────────────

export async function safetyPreflight(workOrderId: string): Promise<{
  workOrder: string;
  assignedTechnician: string | null;
  requiredSkills: string[];
  heldSkills: string[];
  missingSkills: string[];
  safetyGuidance: string;
  citations: { title: string }[];
} | null> {
  const wo = await prisma.workOrder.findUnique({
    where: { id: workOrderId },
    include: {
      requiredSkills: { include: { skill: true } },
      assignedEmployee: { include: { skills: { include: { skill: true } } } },
    },
  });
  if (!wo) return null;
  const requiredSkills = wo.requiredSkills.map((s) => s.skill.name);
  const heldSkills = wo.assignedEmployee?.skills.map((s) => s.skill.name) ?? [];
  const missingSkills = requiredSkills.filter((s) => !heldSkills.includes(s));

  // Pull relevant safety controls from the ingested safety/policy docs.
  const res = await ask({ query: `What safety controls and SWMS apply to: ${wo.title} (${wo.jobType})?` });
  const safetyGuidance = isLowConfidenceAnswer(res.answer) ? "No specific safety document matched this job — apply standard controls and review manually." : res.answer;

  return {
    workOrder: wo.workOrderNumber,
    assignedTechnician: wo.assignedEmployee ? `${wo.assignedEmployee.firstName} ${wo.assignedEmployee.lastName}` : null,
    requiredSkills, heldSkills, missingSkills,
    safetyGuidance,
    citations: res.citations?.map((c) => ({ title: c.title })) ?? [],
  };
}

// ── E2: Recurring-plan suggester (from an account's job history) ──────────

export async function recurringSuggester(accountId: string): Promise<{
  account: string;
  cadence: { jobType: string; count: number }[];
  suggestion: string;
  lowConfidence: boolean;
} | null> {
  const acct = await prisma.account.findUnique({ where: { id: accountId } });
  if (!acct) return null;
  const jobs = await prisma.workOrder.findMany({
    where: { accountId, jobType: { in: ["MAINTENANCE", "INSPECTION", "RECURRING_SERVICE"] } },
    select: { jobType: true, title: true, createdAt: true },
    orderBy: { createdAt: "asc" },
  });
  if (jobs.length < 2) {
    return { account: acct.name, cadence: [], suggestion: "Not enough recurring-type history to propose a plan.", lowConfidence: true };
  }
  const counts = new Map<string, number>();
  for (const j of jobs) counts.set(j.jobType, (counts.get(j.jobType) ?? 0) + 1);
  const cadence = [...counts.entries()].map(([jobType, count]) => ({ jobType, count }));
  const system =
    "You are proposing a recurring maintenance plan from an account's repeat job history. " +
    "Suggest a sensible cadence (e.g. quarterly) and scope. 2–3 sentences. Use only the data.";
  const suggestion = await predictChat(
    "Propose a recurring plan.",
    [system, `ACCOUNT ${acct.name}. RECURRING-TYPE JOBS:\n${JSON.stringify({ cadence, sampleTitles: jobs.slice(-6).map((j) => j.title) })}`],
    { systemPrompt: system }
  );
  return { account: acct.name, cadence, suggestion: suggestion.trim(), lowConfidence: isLowConfidenceAnswer(suggestion) };
}

// ── F2: Monthly exec summary ─────────────────────────────────────────────

export async function execSummary(): Promise<{ summary: string; data: Record<string, unknown> }> {
  const snapshot = await gatherOpsSnapshot();
  const system =
    "You are writing a concise board-ready monthly operations summary for a property-" +
    "maintenance company. Using ONLY the snapshot, write 4–6 sentences covering revenue, " +
    "margin risk, SLA/backlog and cash (overdue invoices). Executive tone, cite the figures. " +
    "Never invent numbers.";
  const summary = await predictChat(
    "Write the executive summary.",
    [system, `SNAPSHOT:\n${JSON.stringify(snapshot)}`],
    { systemPrompt: system }
  );
  return { summary: summary.trim(), data: { keys: Object.keys(snapshot) } };
}

// ── F3: Audit/compliance assistant (NL over the audit log) ───────────────

export async function auditAssistant(question: string): Promise<{ answer: string; lowConfidence: boolean; entriesScanned: number }> {
  const entries = await prisma.auditLog.findMany({
    orderBy: { at: "desc" },
    take: 200,
    select: { at: true, userEmail: true, action: true, entity: true, summary: true },
  });
  const system =
    "You are a compliance assistant answering questions about a property-maintenance company's " +
    "audit log. Answer using ONLY the audit entries provided. Cite actions, users and dates. " +
    "If the log doesn't contain the answer, say so — never invent activity.";
  const answer = await predictChat(
    question,
    [system, `AUDIT LOG (most recent ${entries.length} entries):\n${JSON.stringify(entries)}`],
    { systemPrompt: system }
  );
  const lowConfidence = isLowConfidenceAnswer(answer);
  return { answer: lowConfidence ? LOW_CONFIDENCE_MESSAGE : answer, lowConfidence, entriesScanned: entries.length };
}

// ── UC1B / UC7: Finance exception explainer + auto-fix ────────────────────
// Scans supplier bills (AP) and customer invoices (AR) for posting/match
// exceptions, groups them by root cause, explains each in plain language, and
// — where unambiguous — proposes a concrete HITL fix (e.g. link a bill to the
// single matching PO). The governing AP/AR rules are cited from the KB finance
// policy (doctype=policy). Detection is deterministic; only the policy citation
// uses the AI gateway, so the scan still works if the KB is unavailable.

const PO_MATCH_TOL_ABS = 50; // $ tolerance for 3-way match
const PO_MATCH_TOL_PCT = 0.02; // 2% tolerance

export interface FinanceExceptionItem {
  type: "bill" | "invoice";
  id: string;
  ref: string;
  party: string;
  detail: string;
  /** A concrete, unambiguous HITL fix, or null when judgement is needed. */
  fix: { action: "link-po"; purchaseOrderId: string; poNumber: string } | null;
}
export interface FinanceExceptionGroup {
  kind: string;
  title: string;
  severity: "high" | "medium" | "low";
  explanation: string;
  items: FinanceExceptionItem[];
}

export async function financeExceptions(): Promise<{
  groups: FinanceExceptionGroup[];
  scanned: { bills: number; invoices: number };
  policy: { answer: string; citations: string[] } | null;
}> {
  const now = new Date();
  const bills = await prisma.supplierBill.findMany({
    include: {
      supplier: { select: { name: true } },
      purchaseOrder: { select: { id: true, poNumber: true, lines: { select: { total: true } } } },
    },
    orderBy: { createdAt: "desc" },
  });
  const invoices = await prisma.invoice.findMany({
    include: { account: { select: { name: true } } },
    orderBy: { createdAt: "desc" },
  });
  const openPos = await prisma.purchaseOrder.findMany({
    where: { status: { notIn: ["CANCELLED"] } },
    select: { id: true, poNumber: true, supplierId: true, lines: { select: { total: true } } },
  });
  const sumTotal = (lines: { total: number }[]) =>
    Math.round(lines.reduce((s, l) => s + l.total, 0) * 100) / 100;
  const tol = (base: number) => Math.max(PO_MATCH_TOL_ABS, base * PO_MATCH_TOL_PCT);

  const byKind = new Map<string, FinanceExceptionItem[]>();
  const push = (kind: string, item: FinanceExceptionItem) => {
    const arr = byKind.get(kind) ?? [];
    arr.push(item);
    byKind.set(kind, arr);
  };

  for (const b of bills) {
    if (b.status === "VOID") continue;
    const party = b.supplier?.name ?? "—";
    // Compare ex-tax amounts: a bill's subtotal vs the PO's (ex-tax) line total.
    if (b.purchaseOrder) {
      const pot = sumTotal(b.purchaseOrder.lines);
      const diff = Math.round((b.subtotal - pot) * 100) / 100;
      if (Math.abs(diff) > tol(pot)) {
        push("po-total-mismatch", {
          type: "bill", id: b.id, ref: b.billNumber, party,
          detail: `Bill ex-tax $${b.subtotal.toFixed(2)} vs PO ${b.purchaseOrder.poNumber} $${pot.toFixed(2)} (${diff >= 0 ? "+" : ""}${diff.toFixed(2)})`,
          fix: null,
        });
      }
    } else {
      const matches = openPos
        .filter((p) => p.supplierId === b.supplierId)
        .map((p) => ({ p, pot: sumTotal(p.lines) }))
        .filter(({ pot }) => Math.abs(b.subtotal - pot) <= tol(pot));
      const fix = matches.length === 1
        ? { action: "link-po" as const, purchaseOrderId: matches[0].p.id, poNumber: matches[0].p.poNumber }
        : null;
      push("no-po-link", {
        type: "bill", id: b.id, ref: b.billNumber, party,
        detail: fix ? `No PO linked — matches ${fix.poNumber}` : "No PO linked (no single matching PO)",
        fix,
      });
    }
    if (b.status === "DISPUTED") {
      push("disputed-bill", { type: "bill", id: b.id, ref: b.billNumber, party, detail: "Bill is DISPUTED", fix: null });
    }
    if (b.dueDate && b.dueDate < now && b.status !== "PAID") {
      const days = Math.floor((now.getTime() - b.dueDate.getTime()) / 86400000);
      push("overdue-bill", { type: "bill", id: b.id, ref: b.billNumber, party, detail: `${days}d overdue ($${b.total.toFixed(2)})`, fix: null });
    }
    if (!b.issueDate || !b.dueDate) {
      push("missing-dates", { type: "bill", id: b.id, ref: b.billNumber, party, detail: `Missing ${!b.issueDate ? "issue" : "due"} date`, fix: null });
    }
  }

  for (const inv of invoices) {
    if (inv.status === "VOID" || inv.status === "PAID") continue;
    const party = inv.account?.name ?? "—";
    if (inv.dueAt && inv.dueAt < now && ["SENT", "OVERDUE"].includes(inv.status)) {
      const days = Math.floor((now.getTime() - inv.dueAt.getTime()) / 86400000);
      push("overdue-invoice", { type: "invoice", id: inv.id, ref: inv.invoiceNumber, party, detail: `${days}d overdue ($${inv.total.toFixed(2)})`, fix: null });
    }
    if (!inv.dueAt) {
      push("missing-dates", { type: "invoice", id: inv.id, ref: inv.invoiceNumber, party, detail: "Missing due date", fix: null });
    }
  }

  const META: Record<string, Omit<FinanceExceptionGroup, "kind" | "items">> = {
    "po-total-mismatch": { title: "Bill ≠ PO total (3-way match)", severity: "high", explanation: "These supplier bills don't match their linked purchase-order total beyond tolerance. Per AP policy a 3-way-match variance over tolerance must be reviewed (and a supplier query raised) before the bill is approved for payment." },
    "disputed-bill": { title: "Disputed supplier bills", severity: "high", explanation: "These bills are marked DISPUTED. AP policy requires the dispute to be resolved (or a credit received) before approval — do not pay a disputed bill." },
    "overdue-invoice": { title: "Overdue customer invoices", severity: "high", explanation: "These customer invoices are past due. AR policy: send an escalating reminder and follow up; consider holding further work for chronic non-payers." },
    "overdue-bill": { title: "Overdue supplier bills", severity: "high", explanation: "These bills are past their due date — pay or query to avoid supplier holds and late fees." },
    "no-po-link": { title: "Bill not linked to a PO", severity: "medium", explanation: "These bills aren't linked to a purchase order, so they can't be 3-way matched. Where a single matching open PO exists, link it; otherwise confirm it's an approved non-PO charge." },
    "missing-dates": { title: "Missing issue/due dates", severity: "low", explanation: "These records are missing an issue or due date, which breaks ageing and payment scheduling. Add the dates from the source document." },
  };
  const order = ["po-total-mismatch", "disputed-bill", "overdue-invoice", "overdue-bill", "no-po-link", "missing-dates"];
  const groups: FinanceExceptionGroup[] = order
    .filter((k) => byKind.has(k))
    .map((k) => ({ kind: k, ...META[k], items: byKind.get(k)! }));

  let policy: { answer: string; citations: string[] } | null = null;
  if (groups.length > 0) {
    try {
      const r = await ask({
        query:
          "Accounts payable and receivable exception handling: 3-way match tolerance, disputed supplier bills, overdue invoices, and approval thresholds.",
        filters: [{ labelset: "doctype", label: "policy" }],
      });
      if (r.answer && !isLowConfidenceAnswer(r.answer)) {
        policy = { answer: r.answer.trim(), citations: (r.citations ?? []).map((c) => c.title) };
      }
    } catch {
      /* KB optional — scan still returns */
    }
  }

  return { groups, scanned: { bills: bills.length, invoices: invoices.length }, policy };
}

// ── UC1A: Recurring-fault / callback root-cause explainer ─────────────────
// The OpenEdge "FPY drop explainer" pattern in maintenance clothing: correlate
// a site's job history (recurring issues, callbacks, labour overruns, parts
// usage) into ranked root causes with cited evidence, plus a HITL follow-up.
const FAULT_STOPWORDS = new Set([
  "the", "a", "an", "and", "or", "for", "to", "of", "at", "on", "in", "repair",
  "replace", "service", "fix", "check", "inspect", "install", "clean", "make",
  "safe", "after",
]);
function titleKeyword(title: string): string {
  const w = title.toLowerCase().replace(/[^a-z0-9 ]/g, " ").split(/\s+/).filter((x) => x && !FAULT_STOPWORDS.has(x));
  return w.slice(0, 2).join(" ") || title.toLowerCase().slice(0, 20);
}

export async function faultRootCause(workOrderId: string): Promise<{
  site: { id: string; name: string; account: string };
  windowDays: number;
  signals: {
    totalJobs: number;
    recurring: { label: string; count: number; jobs: string[] }[];
    callbacks: { earlier: string; later: string; daysApart: number; about: string }[];
    overruns: { workOrder: string; estimatedHours: number; actualHours: number }[];
    topParts: { item: string; qty: number }[];
  };
  narrative: string;
  citations: string[];
  proposedActions: { type: "raise-followup"; title: string; jobType: string; accountId: string; siteId: string }[];
} | null> {
  const wo = await prisma.workOrder.findUnique({
    where: { id: workOrderId },
    include: { site: { include: { account: { select: { name: true } } } } },
  });
  if (!wo) return null;
  const windowDays = 365;
  const since = new Date(Date.now() - windowDays * 86400000);
  const jobs = await prisma.workOrder.findMany({
    where: { siteId: wo.siteId, createdAt: { gte: since } },
    include: {
      stockMovements: { where: { movementType: "CONSUMED_ON_JOB" }, include: { inventoryItem: { select: { name: true } } } },
    },
    orderBy: { createdAt: "asc" },
  });

  // Group by the issue keyword alone (the same recurring issue can carry
  // different job types), so e.g. three "fence panel" visits cluster together.
  const groups = new Map<string, { label: string; jobs: string[] }>();
  for (const j of jobs) {
    const key = titleKeyword(j.title);
    const g = groups.get(key) ?? { label: key, jobs: [] };
    g.jobs.push(j.workOrderNumber);
    groups.set(key, g);
  }
  const recurring = [...groups.values()]
    .filter((g) => g.jobs.length >= 2)
    .sort((a, b) => b.jobs.length - a.jobs.length)
    .map((g) => ({ label: g.label, count: g.jobs.length, jobs: g.jobs.slice(0, 6) }));

  const callbacks: { earlier: string; later: string; daysApart: number; about: string }[] = [];
  for (let a = 0; a < jobs.length; a++) {
    for (let b = a + 1; b < jobs.length; b++) {
      if (titleKeyword(jobs[a].title) === titleKeyword(jobs[b].title)) {
        const days = Math.round((jobs[b].createdAt.getTime() - jobs[a].createdAt.getTime()) / 86400000);
        if (days >= 0 && days <= 30) callbacks.push({ earlier: jobs[a].workOrderNumber, later: jobs[b].workOrderNumber, daysApart: days, about: titleKeyword(jobs[a].title) });
      }
    }
  }
  const overruns = jobs
    .filter((j) => j.actualHours && j.estimatedHours && j.actualHours > j.estimatedHours * 1.5)
    .map((j) => ({ workOrder: j.workOrderNumber, estimatedHours: j.estimatedHours!, actualHours: j.actualHours! }))
    .slice(0, 6);
  const partMap = new Map<string, number>();
  for (const j of jobs) for (const m of j.stockMovements) {
    const n = m.inventoryItem?.name ?? "part";
    partMap.set(n, (partMap.get(n) ?? 0) + m.quantity);
  }
  const topParts = [...partMap.entries()].sort((a, b) => b[1] - a[1]).slice(0, 5).map(([item, qty]) => ({ item, qty: Math.round(qty) }));

  const signals = { totalJobs: jobs.length, recurring, callbacks: callbacks.slice(0, 6), overruns, topParts };
  const site = { id: wo.siteId, name: wo.site.name, account: wo.site.account.name };

  if (recurring.length === 0 && callbacks.length === 0 && overruns.length === 0) {
    return {
      site, windowDays, signals,
      narrative: `No recurring fault pattern stands out at ${site.name} in the last ${windowDays} days (${jobs.length} jobs). Nothing to action.`,
      citations: [], proposedActions: [],
    };
  }

  const dominant = recurring[0]?.label ?? callbacks[0]?.about ?? "";
  let citations: string[] = [];
  let kbContext = "";
  try {
    const r = await ask({
      query: `Common root causes and recommended procedure for recurring ${dominant} issues in property maintenance.`,
      filters: [{ labelset: "doctype", label: "policy" }],
    });
    if (r.answer && !isLowConfidenceAnswer(r.answer)) {
      kbContext = r.answer.trim();
      citations = (r.citations ?? []).map((c) => c.title);
    }
  } catch {
    /* best-effort */
  }

  const system =
    "You are a reliability engineer doing root-cause analysis at one site for a property-maintenance company. " +
    "Given recurring jobs, callbacks (repeat visits for the same issue), labour overruns and parts usage, rank the " +
    "2-3 most likely root causes (e.g. material/product defect, workmanship/skill, access/scheduling, asset end-of-life), " +
    "each with the evidence (cite WO numbers and counts) and a confidence (high/medium/low). End with ONE recommended " +
    "containment action. Use ONLY the data provided. Markdown bullets, concise.";
  const narrative = await predictChat(
    "Explain the recurring fault pattern and rank root causes.",
    [system, `SITE: ${site.name} (${site.account}). SIGNALS:\n${JSON.stringify(signals)}` + (kbContext ? `\n\nRELEVANT SOP/POLICY:\n${kbContext}` : "")],
    { systemPrompt: system }
  );

  return {
    site, windowDays, signals,
    narrative: narrative.trim(),
    citations,
    proposedActions: [{ type: "raise-followup", title: `Investigate recurring ${dominant} at ${site.name}`, jobType: "INSPECTION", accountId: wo.accountId, siteId: wo.siteId }],
  };
}

// ── UC6 (repackage): Risk watchlist — composite multi-factor account risk ──
export async function riskWatchlist(): Promise<{
  accounts: { accountId: string; account: string; score: number; openJobs: number; slaRisk: number; overdueTotal: number; factors: string[] }[];
  narrative: string;
}> {
  const now = new Date();
  const soon = new Date(now.getTime() + 48 * 3600_000);
  const accounts = await prisma.account.findMany({
    include: {
      workOrders: { select: { status: true, slaDueAt: true } },
      invoices: { select: { status: true, total: true, dueAt: true } },
    },
  });
  const scored = accounts
    .map((a) => {
      const openJobs = a.workOrders.filter((w) => OPEN.includes(w.status)).length;
      const slaRisk = a.workOrders.filter((w) => OPEN.includes(w.status) && w.slaDueAt && w.slaDueAt <= soon).length;
      const overdueTotal = Math.round(
        a.invoices.filter((i) => ["SENT", "OVERDUE"].includes(i.status) && i.dueAt && i.dueAt < now).reduce((s, i) => s + i.total, 0)
      );
      const score = Math.round(slaRisk * 5 + openJobs + overdueTotal / 1000);
      const factors: string[] = [];
      if (slaRisk) factors.push(`${slaRisk} SLA-risk job${slaRisk > 1 ? "s" : ""}`);
      if (overdueTotal) factors.push(`$${overdueTotal.toLocaleString()} overdue`);
      if (openJobs) factors.push(`${openJobs} open job${openJobs > 1 ? "s" : ""}`);
      return { accountId: a.id, account: a.name, score, openJobs, slaRisk, overdueTotal, factors };
    })
    .filter((x) => x.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, 10);

  if (scored.length === 0) return { accounts: [], narrative: "No accounts are showing elevated risk right now." };
  const system =
    "You are an operations lead. Given accounts ranked by a composite risk score (SLA-risk jobs, overdue $, open jobs), " +
    "write a 2-3 sentence brief: who needs attention first and why. Cite account names. Use only the data.";
  const narrative = await predictChat("Summarise the risk watchlist.", [system, `RANKED ACCOUNTS:\n${JSON.stringify(scored)}`], { systemPrompt: system });
  return { accounts: scored, narrative: narrative.trim() };
}

// ── UC8 (repackage): Cost-variance exception list (pre-labelled) ───────────
export async function costExceptions(): Promise<{
  items: { workOrder: string; account: string; status: string; label: "partial" | "unresolved"; marginPercent: number; varianceFromQuote: number; detail: string }[];
  scanned: number;
  narrative: string;
}> {
  const wos = await prisma.workOrder.findMany({
    where: { status: { in: ["COMPLETED", "INVOICED"] } },
    select: { id: true, workOrderNumber: true, status: true, account: { select: { name: true } } },
    orderBy: { updatedAt: "desc" },
    take: 60,
  });
  const items: { workOrder: string; account: string; status: string; label: "partial" | "unresolved"; marginPercent: number; varianceFromQuote: number; detail: string }[] = [];
  for (const w of wos) {
    const c = await computeJobCosting(w.id);
    if (!c || c.revenue <= 0) continue;
    let label: "partial" | "unresolved" | null = null;
    if (c.marginRisk) label = "unresolved";
    else if (Math.abs(c.varianceFromQuote) > c.revenue * 0.1) label = "partial";
    if (!label) continue;
    items.push({
      workOrder: w.workOrderNumber, account: w.account.name, status: w.status, label,
      marginPercent: c.grossMarginPercent, varianceFromQuote: Math.round(c.varianceFromQuote),
      detail: `margin ${c.grossMarginPercent}% · variance $${Math.round(c.varianceFromQuote)} on $${Math.round(c.revenue)} revenue`,
    });
  }
  items.sort((a, b) => (a.label === b.label ? a.marginPercent - b.marginPercent : a.label === "unresolved" ? -1 : 1));

  let narrative = "No material cost variances on recent completed jobs. 🎉";
  if (items.length) {
    const system =
      "You are a finance controller reviewing completed-job cost variances, pre-labelled unresolved/partial. In 2-3 " +
      "sentences call out the worst margin leakers and the likely theme (labour overrun, under-quote, materials). " +
      "Cite WO numbers. Use only the data.";
    narrative = (await predictChat("Summarise cost exceptions.", [system, `COST EXCEPTIONS:\n${JSON.stringify(items.slice(0, 15))}`], { systemPrompt: system })).trim();
  }
  return { items, scanned: wos.length, narrative };
}

// ── UC2: Service commit-date co-pilot ─────────────────────────────────────
export async function commitDate(workOrderId: string, targetDateISO?: string): Promise<{
  workOrder: string; site: string; account: string;
  parts: { item: string; needed: number; onHand: number; shortfall: number; poEta: string | null }[];
  bindingConstraint: string;
  recommendedDate: string | null;
  targetDate: string | null;
  narrative: string;
} | null> {
  const wo = await prisma.workOrder.findUnique({ where: { id: workOrderId }, include: { site: true, account: true } });
  if (!wo) return null;
  const kit = await suggestPartsKit(workOrderId);
  const stock = await computeStockLevels();
  const onHandBySku = new Map(stock.map((s) => [s.sku, s.totalQuantity]));
  const itemIdBySku = new Map(stock.map((s) => [s.sku, s.itemId]));
  // Earliest open-PO ETA per inventory item.
  const openPos = await prisma.purchaseOrder.findMany({
    where: { status: { notIn: ["RECEIVED", "CANCELLED"] } },
    select: { expectedDate: true, lines: { select: { inventoryItemId: true } } },
  });
  const etaByItem = new Map<string, Date>();
  for (const p of openPos) {
    if (!p.expectedDate) continue;
    for (const l of p.lines) {
      const cur = etaByItem.get(l.inventoryItemId);
      if (!cur || p.expectedDate < cur) etaByItem.set(l.inventoryItemId, p.expectedDate);
    }
  }
  const parts = (kit?.kit ?? []).map((k) => {
    const onHand = onHandBySku.get(k.sku) ?? 0;
    const shortfall = Math.max(0, k.quantity - onHand);
    const itemId = itemIdBySku.get(k.sku);
    const eta = shortfall > 0 && itemId ? etaByItem.get(itemId) ?? null : null;
    return { item: k.name, needed: k.quantity, onHand, shortfall, poEta: eta ? eta.toISOString().slice(0, 10) : null };
  });

  const short = parts.filter((p) => p.shortfall > 0);
  const etas = short.map((p) => p.poEta).filter((d): d is string => !!d).sort();
  const latestEta = etas.length ? etas[etas.length - 1] : null;
  const leadDays = Math.max(1, Math.ceil((wo.estimatedHours ?? 4) / 8));
  let recommendedDate: string | null = null;
  let bindingConstraint: string;
  if (short.length === 0) {
    bindingConstraint = "Parts on hand — capacity only.";
    recommendedDate = new Date(Date.now() + leadDays * 86400000).toISOString().slice(0, 10);
  } else if (latestEta) {
    bindingConstraint = `Parts: ${short.map((s) => s.item).join(", ")} — earliest on a PO is ${latestEta}.`;
    recommendedDate = new Date(new Date(latestEta).getTime() + leadDays * 86400000).toISOString().slice(0, 10);
  } else {
    bindingConstraint = `Parts short with no PO on order: ${short.map((s) => s.item).join(", ")} — raise a PO first.`;
    recommendedDate = null;
  }

  const system =
    "You are an inside-sales / planning co-pilot for a property-maintenance company. Given the parts position " +
    "(on-hand vs needed, PO ETAs) and the binding constraint, state whether the target date is achievable, give the " +
    "earliest realistic commit date, name the constraint, and offer one alternative (e.g. expedite a PO). 2-4 " +
    "sentences, concrete. Use only the data.";
  const narrative = await predictChat(
    "Can we commit this job by the target date?",
    [system, `JOB ${wo.workOrderNumber} (${wo.title}) at ${wo.site.name}. TARGET: ${targetDateISO ?? "none given"}. ` +
      `PARTS:\n${JSON.stringify(parts)}\nBINDING CONSTRAINT: ${bindingConstraint} RECOMMENDED: ${recommendedDate ?? "blocked"}.`],
    { systemPrompt: system }
  );
  return {
    workOrder: wo.workOrderNumber, site: wo.site.name, account: wo.account.name,
    parts, bindingConstraint, recommendedDate, targetDate: targetDateISO ?? null, narrative: narrative.trim(),
  };
}

// ── UC3: Fleet / asset service co-pilot ───────────────────────────────────
export async function assetServiceCoPilot(kind: "vehicle" | "asset", id: string, symptom: string): Promise<{
  subject: { kind: string; name: string; detail: string };
  dueInfo: string | null;
  narrative: string;
  citations: string[];
} | null> {
  let name = "";
  let detail = "";
  let dueInfo: string | null = null;
  if (kind === "vehicle") {
    const v = await prisma.vehicle.findUnique({ where: { id } });
    if (!v) return null;
    name = v.name;
    detail = [v.make, v.model, v.year, `${v.odometer.toLocaleString()} km`].filter(Boolean).join(" · ");
    const due: string[] = [];
    if (v.serviceDueAt) due.push(`service due ${v.serviceDueAt.toISOString().slice(0, 10)}`);
    if (v.registrationDueAt) due.push(`rego due ${v.registrationDueAt.toISOString().slice(0, 10)}`);
    dueInfo = due.join(" · ") || null;
  } else {
    const a = await prisma.asset.findUnique({ where: { id } });
    if (!a) return null;
    name = a.name;
    detail = [a.assetType, a.serialNumber, a.status].filter(Boolean).join(" · ");
    dueInfo = a.serviceDueAt ? `service due ${a.serviceDueAt.toISOString().slice(0, 10)}` : null;
  }

  let citations: string[] = [];
  let kbContext = "";
  try {
    const r = await ask({
      query: `Maintenance and safety guidance for: ${name} ${detail}. Reported symptom: ${symptom}.`,
      filters: [{ labelset: "doctype", label: "manual" }],
    });
    if (r.answer && !isLowConfidenceAnswer(r.answer)) {
      kbContext = r.answer.trim();
      citations = (r.citations ?? []).map((c) => c.title);
    }
  } catch {
    /* best-effort */
  }

  const system =
    "You are a fleet/equipment service co-pilot for a property-maintenance company. Given an asset/vehicle, its " +
    "service status, a reported symptom and any relevant manual guidance, give a likely cause, the recommended next " +
    "step, and whether a service is due. 3-5 sentences, practical. Use only the data; if the manual context is thin, " +
    "say what to check.";
  const narrative = await predictChat(
    "Advise on this asset's symptom and service.",
    [system, `SUBJECT: ${name} (${detail}). DUE: ${dueInfo ?? "n/a"}. SYMPTOM: ${symptom}.` + (kbContext ? `\n\nMANUAL GUIDANCE:\n${kbContext}` : "")],
    { systemPrompt: system }
  );
  return { subject: { kind, name, detail }, dueInfo, narrative: narrative.trim(), citations };
}

// ── UC10: Compliance readiness + policy-vs-practice gap ────────────────────
export async function complianceReadiness(): Promise<{
  metrics: { invoicesMissingDueDate: number; disputedBillsOpen: number; overdueInvoices: number; auditEntriesRecent: number; gstRatePct: number; marginRiskThresholdPct: number; defaultPaymentTerms: string };
  narrative: string;
  citations: string[];
}> {
  const now = new Date();
  const [cfg, invoicesMissingDueDate, disputedBillsOpen, overdueInvoices, auditEntriesRecent] = await Promise.all([
    getCompanyConfig(),
    prisma.invoice.count({ where: { dueAt: null, status: { notIn: ["VOID"] } } }),
    prisma.supplierBill.count({ where: { status: "DISPUTED" } }),
    prisma.invoice.count({ where: { status: { in: ["SENT", "OVERDUE"] }, dueAt: { lt: now } } }),
    prisma.auditLog.count({ where: { at: { gte: new Date(now.getTime() - 30 * 86400000) } } }),
  ]);
  const metrics = {
    invoicesMissingDueDate, disputedBillsOpen, overdueInvoices, auditEntriesRecent,
    gstRatePct: Math.round(cfg.gstRate * 100),
    marginRiskThresholdPct: Math.round(cfg.marginRiskThreshold * 100),
    defaultPaymentTerms: cfg.defaultPaymentTerms,
  };

  let citations: string[] = [];
  let kbContext = "";
  try {
    const r = await ask({
      query: "Finance policy: payment terms, overdue invoice handling, disputed bills, approval thresholds and required dates.",
      filters: [{ labelset: "doctype", label: "policy" }],
    });
    if (r.answer && !isLowConfidenceAnswer(r.answer)) {
      kbContext = r.answer.trim();
      citations = (r.citations ?? []).map((c) => c.title);
    }
  } catch {
    /* best-effort */
  }

  const system =
    "You are a compliance officer producing a readiness assessment for a property-maintenance company. Compare the " +
    "WRITTEN policy (provided) against the LIVE configuration and metrics. Output: a short readiness summary, then " +
    "bullet the areas that look OK (✅) and any policy-vs-practice GAPS (⚠) — e.g. invoices missing due dates, " +
    "unresolved disputed bills, overdue backlog. Cite the policy where relevant. Use only the data.";
  const narrative = await predictChat(
    "Assess compliance readiness and flag policy-vs-practice gaps.",
    [system, `LIVE CONFIG + METRICS:\n${JSON.stringify(metrics)}` + (kbContext ? `\n\nWRITTEN POLICY:\n${kbContext}` : "")],
    { systemPrompt: system }
  );
  return { metrics, narrative: narrative.trim(), citations };
}

// ── UC9: Part / lot trace (forward + backward) ────────────────────────────
export async function availableLots(limit = 60): Promise<{ lot: string; item: string; consumedOnJobs: number }[]> {
  const moves = await prisma.stockMovement.findMany({
    where: { lot: { not: null }, movementType: "CONSUMED_ON_JOB" },
    include: { inventoryItem: { select: { name: true } } },
  });
  const map = new Map<string, { item: string; count: number }>();
  for (const m of moves) {
    if (!m.lot) continue;
    const e = map.get(m.lot) ?? { item: m.inventoryItem?.name ?? "", count: 0 };
    e.count++;
    map.set(m.lot, e);
  }
  return [...map.entries()]
    .sort((a, b) => b[1].count - a[1].count)
    .slice(0, limit)
    .map(([lot, v]) => ({ lot, item: v.item, consumedOnJobs: v.count }));
}

export async function lotTrace(lot: string): Promise<{
  lot: string;
  item: { sku: string; name: string } | null;
  received: { date: string; quantity: number; location: string | null; ref: string }[];
  consumed: { workOrder: string; site: string; account: string; quantity: number; date: string }[];
  accountsAffected: string[];
  summary: string;
} | null> {
  const moves = await prisma.stockMovement.findMany({
    where: { lot },
    include: {
      inventoryItem: { select: { sku: true, name: true } },
      toLocation: { select: { name: true } },
      workOrder: { include: { site: { select: { name: true } }, account: { select: { name: true } } } },
    },
    orderBy: { createdAt: "asc" },
  });
  if (moves.length === 0) return null;
  const item = moves[0].inventoryItem ? { sku: moves[0].inventoryItem.sku, name: moves[0].inventoryItem.name } : null;
  const received = moves
    .filter((m) => m.movementType === "PURCHASE_RECEIPT")
    .map((m) => ({ date: m.createdAt.toISOString().slice(0, 10), quantity: m.quantity, location: m.toLocation?.name ?? null, ref: m.notes ?? "" }));
  const consumed = moves
    .filter((m) => m.movementType === "CONSUMED_ON_JOB" && m.workOrder)
    .map((m) => ({ workOrder: m.workOrder!.workOrderNumber, site: m.workOrder!.site.name, account: m.workOrder!.account.name, quantity: m.quantity, date: m.createdAt.toISOString().slice(0, 10) }));
  const accountsAffected = [...new Set(consumed.map((c) => c.account))];
  const summary = consumed.length
    ? `Lot ${lot}${item ? ` (${item.name})` : ""} was received ${received.length} time(s) and consumed on ${consumed.length} job(s) across ${accountsAffected.length} account(s): ${accountsAffected.join(", ")}.`
    : `Lot ${lot}${item ? ` (${item.name})` : ""} was received but has no recorded consumption.`;
  return { lot, item, received, consumed, accountsAffected, summary };
}
