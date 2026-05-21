/**
 * ERP → Progress Agentic RAG ingestion.
 *
 * Serializes MaintenanceOS data into human-readable Markdown documents and
 * upserts them (idempotently, by slug) into the ARAG Knowledge Box, alongside
 * the static policy/safety docs in apps/api/arag-docs/. This seeds the KB that
 * powers F1 (Knowledge Copilot) and F2 (Job Playbooks), and is the corpus the
 * Retrieval Agent (F3/F4/F5) draws on for unstructured context.
 *
 * Each document carries:
 *   - classifications (labels: doctype/status/priority/account/flag) for
 *     filtered retrieval, and
 *   - graph relations (account / site / technician entities) so the KB's
 *     knowledge graph links records together.
 *
 * No ARAG creds? Runs in DRY-RUN: writes the generated docs to
 * apps/api/.arag-out/ and prints a summary, so the pipeline is verifiable
 * without credentials.
 *
 *   npm run arag:sync            (from apps/api, or `npm run arag:sync` at root)
 */
import { PrismaClient } from "@prisma/client";
import { readdir, readFile, mkdir, writeFile } from "node:fs/promises";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { isConfigured, upsertErpDoc, getAragConfig, type ErpDoc } from "../src/lib/arag.js";
import { computeJobCosting } from "../src/lib/costing.js";

const prisma = new PrismaClient();
const here = dirname(fileURLToPath(import.meta.url));
const DOCS_DIR = join(here, "..", "arag-docs");
const OUT_DIR = join(here, "..", ".arag-out");

let dry = true; // resolved in main()
let created = 0;
let updated = 0;
let dryCount = 0;

async function emit(d: ErpDoc): Promise<void> {
  if (dry) {
    await mkdir(OUT_DIR, { recursive: true });
    await writeFile(
      join(OUT_DIR, `${d.slug}.md`),
      `<!-- title: ${d.title} | path: ${d.path} | labels: ${JSON.stringify(
        d.labels
      )} | relations: ${JSON.stringify(d.relations ?? [])} -->\n\n${d.body}\n`
    );
    dryCount++;
    return;
  }
  const r = await upsertErpDoc(d);
  if (r.action === "created") created++;
  else updated++;
}

const money = (n: number): string =>
  new Intl.NumberFormat("en-AU", { style: "currency", currency: "AUD" }).format(n);

const TERMINAL = ["COMPLETED", "INVOICED", "CLOSED", "CANCELLED"];

async function syncStaticDocs(): Promise<void> {
  let files: string[] = [];
  try {
    files = (await readdir(DOCS_DIR)).filter((f) => f.endsWith(".md"));
  } catch {
    files = [];
  }
  for (const f of files) {
    const body = await readFile(join(DOCS_DIR, f), "utf8");
    const slug = `doc-${f.replace(/\.md$/, "")}`;
    await emit({
      slug,
      title: body.split("\n")[0].replace(/^#\s*/, "").trim() || slug,
      body,
      path: "/policy",
      labels: [["doctype", "policy"]],
      relations: [],
    });
  }
  console.log(`  policy docs: ${files.length}`);
}

async function syncAccounts(): Promise<void> {
  const accounts = await prisma.account.findMany({
    include: { sites: true, workOrders: true, invoices: true },
  });
  for (const a of accounts) {
    const openWO = a.workOrders.filter((w) => !TERMINAL.includes(w.status)).length;
    const outstanding = a.invoices
      .filter((i) => ["SENT", "OVERDUE"].includes(i.status))
      .reduce((s, i) => s + i.total, 0);
    const body = `# Account: ${a.name}

- Type: ${a.type}
- Account manager: ${a.accountManager ?? "—"}
- Payment terms: ${a.paymentTerms ?? "—"}
- Primary contact: ${a.primaryContactName ?? "—"} (${a.email ?? "—"}, ${a.phone ?? "—"})
- Sites: ${a.sites.length} — ${a.sites.map((s) => `${s.name} (${s.suburb} ${s.state})`).join("; ")}
- Open work orders: ${openWO}
- Total work orders: ${a.workOrders.length}
- Outstanding invoiced amount: ${money(outstanding)}
${a.notes ? `- Notes: ${a.notes}` : ""}
`;
    await emit({
      slug: `account-${a.id}`,
      title: `Account ${a.name}`,
      body,
      path: "/erp/accounts",
      labels: [
        ["doctype", "account"],
        ["account", a.name],
      ],
      relations: [{ entity: a.name, entityGroup: "account" }],
    });
  }
  console.log(`  accounts: ${accounts.length}`);
}

async function syncWorkOrders(limit: number): Promise<void> {
  const wos = await prisma.workOrder.findMany({
    include: {
      account: true,
      site: true,
      assignedEmployee: true,
      requiredSkills: { include: { skill: true } },
    },
    orderBy: { createdAt: "desc" },
    take: limit,
  });
  for (const w of wos) {
    const c = await computeJobCosting(w.id);
    const skills = w.requiredSkills.map((s) => s.skill.name).join(", ") || "none";
    const tech = w.assignedEmployee
      ? `${w.assignedEmployee.firstName} ${w.assignedEmployee.lastName}`
      : null;
    const breached =
      w.slaDueAt && !TERMINAL.includes(w.status) && new Date(w.slaDueAt) < new Date();
    const body = `# Work Order ${w.workOrderNumber}: ${w.title}

- Account: ${w.account.name} (${w.account.type})
- Site: ${w.site.name}, ${w.site.address}, ${w.site.suburb} ${w.site.state} ${w.site.postcode}
- Job type: ${w.jobType} · Priority: ${w.priority} · Status: ${w.status}
- Assigned technician: ${tech ?? "UNASSIGNED"}
- SLA due: ${w.slaDueAt ? new Date(w.slaDueAt).toISOString() : "—"} ${breached ? "(**SLA BREACHED**)" : ""}
- Estimated hours: ${w.estimatedHours ?? "—"} · Actual hours: ${w.actualHours ?? "—"}
- Required skills: ${skills}
- Description: ${w.description ?? "—"}
${w.completionNotes ? `- Completion notes: ${w.completionNotes}` : ""}

## Profitability
${
  c
    ? `- Revenue: ${money(c.revenue)}
- Total actual cost: ${money(c.totalActualCost)} (labour ${money(c.actualLabourCost)}, materials ${money(c.materialCost)})
- Gross profit: ${money(c.grossProfit)} · Gross margin: ${c.grossMarginPercent}%
- Margin risk: ${c.marginRisk ? "YES" : "no"}
- Variance from quote: ${money(c.varianceFromQuote)}`
    : "- Not costed."
}
`;
    const relations: ErpDoc["relations"] = [
      { entity: w.account.name, entityGroup: "account" },
      { entity: w.site.name, entityGroup: "site" },
      { entity: w.jobType, entityGroup: "jobType" },
    ];
    if (tech) relations.push({ entity: tech, entityGroup: "technician" });
    await emit({
      slug: `wo-${w.workOrderNumber}`,
      title: `${w.workOrderNumber} ${w.title}`,
      body,
      path: "/erp/work-orders",
      labels: [
        ["doctype", "work-order"],
        ["status", w.status],
        ["priority", w.priority],
        ["jobType", w.jobType],
        ["account", w.account.name],
        ...((c?.marginRisk ? [["flag", "margin-risk"]] : []) as [string, string][]),
        ...((breached ? [["flag", "sla-breach"]] : []) as [string, string][]),
      ],
      relations,
    });
  }
  console.log(`  work orders: ${wos.length}`);
}

async function syncQuotes(): Promise<void> {
  const quotes = await prisma.quote.findMany({
    include: { account: true, workOrder: true },
  });
  for (const q of quotes) {
    const body = `# Quote ${q.quoteNumber}

- Account: ${q.account.name}
- Work order: ${q.workOrder.workOrderNumber} — ${q.workOrder.title}
- Status: ${q.status}
- Labour: ${q.labourHours}h @ ${money(q.labourRate)} = ${money(q.labourHours * q.labourRate)}
- Materials: ${money(q.materialCost)} · Subcontractor: ${money(q.subcontractorCost)} · Equipment: ${money(q.equipmentCost)}
- Travel: ${money(q.travelCost)} · Disposal: ${money(q.disposalCost)}
- Margin applied: ${q.marginPercent}%
- Subtotal: ${money(q.subtotal)} · GST: ${money(q.gst)} · Total: ${money(q.total)}
- Valid until: ${q.validUntil ? new Date(q.validUntil).toISOString() : "—"}
${q.notes ? `- Notes: ${q.notes}` : ""}
`;
    await emit({
      slug: `quote-${q.quoteNumber}`,
      title: `Quote ${q.quoteNumber} (${q.account.name})`,
      body,
      path: "/erp/quotes",
      labels: [
        ["doctype", "quote"],
        ["status", q.status],
        ["account", q.account.name],
      ],
      relations: [
        { entity: q.account.name, entityGroup: "account" },
        { entity: q.workOrder.jobType, entityGroup: "jobType" },
      ],
    });
  }
  console.log(`  quotes: ${quotes.length}`);
}

async function syncInvoices(): Promise<void> {
  const invoices = await prisma.invoice.findMany({
    include: { account: true, workOrder: true },
  });
  for (const i of invoices) {
    const overdue =
      ["SENT", "OVERDUE"].includes(i.status) && i.dueAt && new Date(i.dueAt) < new Date();
    const body = `# Invoice ${i.invoiceNumber}

- Account: ${i.account.name}
- Work order: ${i.workOrder?.workOrderNumber ?? "—"}
- Status: ${i.status}${overdue ? " (**OVERDUE**)" : ""}
- Subtotal: ${money(i.subtotal)} · GST: ${money(i.gst)} · Total: ${money(i.total)}
- Issued: ${i.issuedAt ? new Date(i.issuedAt).toISOString() : "—"}
- Due: ${i.dueAt ? new Date(i.dueAt).toISOString() : "—"}
- Paid: ${i.paidAt ? new Date(i.paidAt).toISOString() : "—"}
`;
    await emit({
      slug: `invoice-${i.invoiceNumber}`,
      title: `Invoice ${i.invoiceNumber} (${i.account.name})`,
      body,
      path: "/erp/invoices",
      labels: [
        ["doctype", "invoice"],
        ["status", i.status],
        ["account", i.account.name],
        ...((overdue ? [["flag", "overdue"]] : []) as [string, string][]),
      ],
      relations: [{ entity: i.account.name, entityGroup: "account" }],
    });
  }
  console.log(`  invoices: ${invoices.length}`);
}

async function main(): Promise<void> {
  const woLimit = Number(process.env.ARAG_SYNC_WO_LIMIT ?? 120);
  dry = !isConfigured();
  const cfg = getAragConfig();
  console.log(
    dry
      ? "ARAG not configured → DRY RUN (writing to apps/api/.arag-out/)"
      : `Ingesting into ARAG KB ${cfg.kbId} @ ${cfg.baseUrl}`
  );
  await syncStaticDocs();
  await syncAccounts();
  await syncWorkOrders(woLimit);
  await syncQuotes();
  await syncInvoices();
  if (dry) {
    console.log(`\nDRY RUN complete — ${dryCount} documents written to .arag-out/`);
    console.log("Set ARAG_* in apps/api/.env, then re-run to ingest.");
  } else {
    console.log(`\nIngestion complete — ${created} created, ${updated} updated.`);
  }
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
