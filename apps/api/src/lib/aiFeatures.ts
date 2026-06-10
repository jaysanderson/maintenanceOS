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
import { getMarginRiskThreshold } from "./config.js";
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
  matchBy: "sku" | "name" | null;
}

export interface PurchaseOrderDraft {
  supplierName: string | null;
  supplierRef: string | null;
  orderDate: string | null;
  expectedDate: string | null;
  currency: string | null;
  /** Matched supplier in our DB (null → user picks one). */
  matchedSupplierId: string | null;
  matchedSupplierName: string | null;
  lines: DraftPoLine[];
}

const PO_EXTRACT_SYSTEM =
  "You are a precise document data-extraction engine for a property " +
  "maintenance company's purchasing system. You are given the extracted text " +
  "of a supplier purchase order or order confirmation. Extract its contents as " +
  "STRICT JSON only — no prose, no markdown fences. Use this exact shape: " +
  '{"supplierName": string, "supplierRef": string|null, "orderDate": ' +
  'string|null, "expectedDate": string|null, "currency": string|null, ' +
  '"lines": [{"description": string, "sku": string|null, "quantity": ' +
  'number, "unitCost": number}]}. ' +
  "Dates as ISO yyyy-mm-dd where possible. unitCost is the ex-tax unit " +
  "price as a number (no currency symbol). If a field is absent use null " +
  "(or [] for lines). If this document is NOT a purchase order or order " +
  'confirmation, return {"notAPurchaseOrder": true}.';

function num(v: unknown, d = 0): number {
  const n = typeof v === "string" ? Number(v.replace(/[^0-9.-]/g, "")) : Number(v);
  return Number.isFinite(n) ? n : d;
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
  mimeType: string
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
  // Two-pass: fast OCR first (great on text-layer PDFs / clean images, ~6s);
  // if that yields no usable PO, retry once with the rules-based VLLM extract
  // strategy (slower but better on hard scans).
  const ext = MIME_EXT[mimeType] ?? "bin";
  const filename = `purchase-order.${ext}`;

  async function attempt(useVllm: boolean): Promise<Record<string, unknown> | null> {
    const text = await ingestAndExtractText(fileBuffer, filename, mimeType, { useVllmStrategy: useVllm });
    if (!text.trim()) return null;
    const answer = await predictChat(
      "Extract the purchase order as JSON.",
      [PO_EXTRACT_SYSTEM, `DOCUMENT TEXT (extracted by ARAG):\n${text}`],
      { systemPrompt: PO_EXTRACT_SYSTEM }
    );
    const p = extractJson(answer) as Record<string, unknown> | null;
    if (!p || p.notAPurchaseOrder === true || !Array.isArray(p.lines) || p.lines.length === 0) {
      return null;
    }
    return p;
  }

  let parsed = await attempt(false);
  // Fallback to the deeper visual extraction only if a strategy is configured.
  if (!parsed && DOC_EXTRACT_STRATEGY_ID) parsed = await attempt(true);

  if (!parsed) {
    return {
      draft: null,
      lowConfidence: true,
      message:
        "Couldn't read a purchase order from this document. Make sure it's a clear " +
        "supplier PO or order confirmation (a digital PDF works best) and try again.",
      model: "ingest+extract",
    };
  }

  // Match supplier by name (exact, then contains either direction).
  const supplierName =
    typeof parsed.supplierName === "string" ? parsed.supplierName.trim() : null;
  let matchedSupplierId: string | null = null;
  let matchedSupplierName: string | null = null;
  if (supplierName) {
    const suppliers = await prisma.supplier.findMany({
      select: { id: true, name: true },
    });
    const needle = supplierName.toLowerCase();
    const hit =
      suppliers.find((s) => s.name.toLowerCase() === needle) ??
      suppliers.find(
        (s) =>
          s.name.toLowerCase().includes(needle) ||
          needle.includes(s.name.toLowerCase())
      );
    if (hit) {
      matchedSupplierId = hit.id;
      matchedSupplierName = hit.name;
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

    let match = extracted.sku ? bySku.get(extracted.sku.toLowerCase()) : undefined;
    let matchBy: DraftPoLine["matchBy"] = match ? "sku" : null;
    if (!match && extracted.description) {
      const desc = extracted.description.toLowerCase();
      match = items.find(
        (i) =>
          desc.includes(i.name.toLowerCase()) ||
          i.name.toLowerCase().includes(desc.split(/[(,\-]/)[0].trim())
      );
      if (match) matchBy = "name";
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
      orderDate: typeof parsed.orderDate === "string" ? parsed.orderDate : null,
      expectedDate:
        typeof parsed.expectedDate === "string" ? parsed.expectedDate : null,
      currency: typeof parsed.currency === "string" ? parsed.currency : null,
      matchedSupplierId,
      matchedSupplierName,
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
