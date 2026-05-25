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
import { predictChat, upsertErpDoc, isLowConfidenceAnswer, LOW_CONFIDENCE_MESSAGE } from "./arag.js";

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
