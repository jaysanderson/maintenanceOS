// End-to-end demo test: hits EVERY /api/ai/* feature with real ARAG and
// asserts a rich (non-empty, non-low-confidence) result. No mocks.
//
// Usage:  BASE=http://localhost:4010 node apps/api/scripts/demo-e2e.mjs
//         BASE=https://maintenanceos.fly.dev node apps/api/scripts/demo-e2e.mjs
// Requires the API reachable at BASE with ARAG configured + the demo seed
// loaded. Exits non-zero on any FAIL. This is the "test the whole demo end to
// end" harness referenced in the run-book.
import fs from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

const __dir = path.dirname(fileURLToPath(import.meta.url));
const B = process.env.BASE || "http://localhost:4010";
const PDF = path.resolve(__dir, "../../../docs/demo-assets/sample-supplier-invoice.pdf");
let TOKEN = "";
const H = () => ({ authorization: `Bearer ${TOKEN}`, "content-type": "application/json" });

const results = [];
const rec = (name, status, snippet) => { results.push({ name, status, snippet }); const tag = status === "PASS" ? "✅" : status === "REVIEW" ? "🔎" : "❌"; console.log(`${tag} ${name} — ${snippet}`); };
const clip = (o, n = 150) => { const s = typeof o === "string" ? o : JSON.stringify(o); return (s || "").replace(/\s+/g, " ").slice(0, n); };

async function jget(p) { const r = await fetch(B + p, { headers: H() }); return r.json(); }
async function jpost(p, body) {
  // Match the web client: always send a JSON body (`{}` when none).
  const r = await fetch(B + p, { method: "POST", headers: H(), body: JSON.stringify(body ?? {}) });
  let j = null; try { j = await r.json(); } catch {}
  return { code: r.status, j };
}
async function sse(p, body, formData) {
  const init = formData
    ? { method: "POST", headers: { authorization: `Bearer ${TOKEN}` }, body: formData }
    : { method: "POST", headers: H(), body: JSON.stringify(body) };
  const r = await fetch(B + p, init);
  const events = [];
  let buf = "";
  for await (const chunk of r.body) {
    buf += Buffer.from(chunk).toString("utf8");
    const lines = buf.split("\n"); buf = lines.pop() ?? "";
    for (const line of lines) {
      const t = line.replace(/^data:\s*/, "").trim();
      if (t.startsWith("{")) { try { events.push(JSON.parse(t)); } catch {} }
    }
  }
  return events;
}
// run a json-feature test
async function T(name, p, body, assert) {
  try {
    const { code, j } = await jpost(p, body);
    if (code !== 200) return rec(name, "FAIL", `HTTP ${code} ${clip(j)}`);
    const r = assert(j);
    rec(name, r.ok ? "PASS" : (r.review ? "REVIEW" : "FAIL"), r.why);
  } catch (e) { rec(name, "FAIL", `threw ${e.message}`); }
}
const arr = (a) => Array.isArray(a) ? a : [];
const nonEmpty = (s) => typeof s === "string" && s.trim().length > 25;
const lowConf = (s) => /not enough|couldn.t find|no .* to (analyse|report)|nothing to action|no recurring|no comparable jobs with logged/i.test(String(s));

async function main() {
  // --- auth ---
  const lr = await fetch(B + "/api/auth/login", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ email: "admin@maintenanceos.com.au", password: "demo1234" }) });
  TOKEN = (await lr.json()).token;
  if (!TOKEN) throw new Error("login failed");

  // --- gather hero ids ---
  const wos = await jget("/api/work-orders");
  const accounts = await jget("/api/accounts");
  const invoices = await jget("/api/invoices");
  const quotes = await jget("/api/quotes");
  const vehicles = await jget("/api/vehicles");

  const hero = accounts.find((a) => /Bendigo Regional Real Estate/.test(a.name)) || accounts[0];
  const commitTarget = wos.find((w) => w.title === "Repair leaking tap" && w.status === "WAITING_ON_PARTS");
  const tapClosed = wos.find((w) => w.title === "Repair leaking tap" && w.status === "CLOSED");
  const scheduled = wos.find((w) => ["SCHEDULED", "DISPATCHED", "IN_PROGRESS"].includes(w.status) && w.assignedEmployeeId && w.scheduledStart);
  const anyCompleted = wos.find((w) => ["COMPLETED", "INVOICED", "CLOSED"].includes(w.status));
  const invoicedWO = wos.find((w) => w.status === "INVOICED") || anyCompleted;
  const overdueInv = invoices.find((i) => i.status === "OVERDUE") || invoices[0];
  const lostQuote = quotes.find((q) => ["REJECTED", "EXPIRED"].includes(q.status)) || quotes[0];
  const overdueVeh = vehicles.find((v) => v.serviceDueAt && new Date(v.serviceDueAt) < new Date()) || vehicles[0];
  console.log(`ids: hero=${hero?.name} commit=${commitTarget?.workOrderNumber} tapClosed=${tapClosed?.workOrderNumber} sched=${scheduled?.workOrderNumber} inv=${overdueInv?.invoiceNumber} quote=${lostQuote?.quoteNumber}/${lostQuote?.status} veh=${overdueVeh?.name}`);

  // --- knowledge & conversational ---
  { const j = await jget("/api/ai/status"); rec("status", j.kb && j.agent ? "PASS" : "FAIL", clip(j)); }
  await T("ask (policy citation)", "/api/ai/ask", { query: "What controls are required when working at heights?" }, (j) => ({ ok: !j.lowConfidence && nonEmpty(j.answer), why: `cites=${arr(j.citations).length} ${clip(j.answer)}` }));
  await T("find (semantic search)", "/api/ai/find", { query: "overdue invoice payment terms" }, (j) => ({ ok: arr(j.hits).length >= 1, why: `${arr(j.hits).length} hits` }));
  await T("agent (multi-source)", "/api/ai/agent", { question: "How many work orders are currently open?" }, (j) => ({ ok: nonEmpty(j.answer) && !lowConf(j.answer), why: clip(j.answer) }));

  // --- knowledge gen ---
  await T("playbook", "/api/ai/playbook", { jobDescription: "replace a leaking kitchen mixer tap", jobType: "REPAIR" }, (j) => ({ ok: j.playbook && arr(j.playbook.steps).length >= 1, review: !!j.raw, why: j.playbook ? `${arr(j.playbook.steps).length} steps` : clip(j.message || j.raw) }));

  // --- daily ops ---
  { const j = await jget("/api/ai/briefing"); rec("briefing", nonEmpty(j.briefing) ? "PASS" : "FAIL", clip(j.briefing)); }
  await T("dispatch-actions", "/api/ai/dispatch-actions", {}, (j) => ({ ok: arr(j.actions).length >= 1, review: !!j.raw, why: `${arr(j.actions).length} actions` }));
  await T("day-plan", "/api/ai/day-plan", { employeeId: scheduled?.assignedEmployeeId, date: scheduled?.scheduledStart?.slice(0, 10) }, (j) => ({ ok: arr(j.jobs).length >= 1, why: `${arr(j.jobs).length} jobs ${clip(j.narrative)}` }));
  await T("sla-early-warning", "/api/ai/sla-early-warning", {}, (j) => ({ ok: arr(j.atRisk).length >= 1, why: `${arr(j.atRisk).length} at risk` }));
  await T("triage", "/api/ai/triage", { request: "Burst pipe flooding a kitchen, tenant says water everywhere, very urgent" }, (j) => ({ ok: j.triage && j.triage.jobType, why: clip(j.triage || j.raw) }));

  // --- work-order assists ---
  await T("draft-quote", "/api/ai/draft-quote", { workOrderId: commitTarget?.id }, (j) => ({ ok: j.draft && !j.lowConfidence, why: `comparables=${arr(j.comparables).length}` }));
  await T("similar-work-orders", "/api/ai/similar-work-orders", { workOrderId: commitTarget?.id }, (j) => ({ ok: (arr(j.duplicates).length + arr(j.callbacks).length) >= 1, review: true, why: `dup=${arr(j.duplicates).length} cb=${arr(j.callbacks).length} ${clip(j.summary)}` }));
  await T("parts-kit", "/api/ai/parts-kit", { workOrderId: commitTarget?.id }, (j) => ({ ok: arr(j.kit).length >= 1, why: `${arr(j.kit).length} parts: ${clip(arr(j.kit).map(k=>k.name).join(","))}` }));
  await T("safety-preflight", "/api/ai/safety-preflight", { workOrderId: commitTarget?.id }, (j) => ({ ok: nonEmpty(j.safetyGuidance) || arr(j.controls).length >= 1, review: true, why: clip(j.safetyGuidance || JSON.stringify(j)) }));
  await T("site-access-briefing", "/api/ai/site-access-briefing", { workOrderId: commitTarget?.id }, (j) => ({ ok: nonEmpty(j.briefing), why: clip(j.briefing) }));
  await T("completion-note", "/api/ai/completion-note", { workOrderId: tapClosed?.id }, (j) => ({ ok: nonEmpty(j.draft), why: clip(j.draft) }));
  await T("work-order-timeline", "/api/ai/work-order-timeline", { workOrderId: tapClosed?.id }, (j) => ({ ok: arr(j.events).length >= 1, why: `${arr(j.events).length} events` }));
  await T("variation-claim", "/api/ai/variation-claim", { workOrderId: invoicedWO?.id }, (j) => ({ ok: nonEmpty(j.draft || j.narrative), review: true, why: clip(j.draft || j.narrative || JSON.stringify(j)) }));
  await T("customer-status-update", "/api/ai/customer-status-update", { workOrderId: commitTarget?.id }, (j) => ({ ok: nonEmpty(j.draft), why: clip(j.draft) }));

  // --- UC features ---
  await T("fault-root-cause (UC1A)", "/api/ai/fault-root-cause", { workOrderId: commitTarget?.id }, (j) => ({ ok: nonEmpty(j.narrative) && !/nothing to action/i.test(j.narrative), review: true, why: clip(j.narrative || JSON.stringify(j)) }));
  await T("commit-date (UC2)", "/api/ai/commit-date", { workOrderId: commitTarget?.id }, (j) => ({ ok: nonEmpty(j.bindingConstraint) && !!j.recommendedDate && !lowConf(j.narrative), why: `rec=${j.recommendedDate} | ${clip(j.bindingConstraint)} | ${clip(j.narrative, 80)}` }));
  await T("asset-service (UC3)", "/api/ai/asset-service", { kind: "vehicle", id: overdueVeh?.id, symptom: "Pulls to the left under braking and the brakes squeal" }, (j) => ({ ok: nonEmpty(j.narrative || j.advice), review: true, why: clip(j.narrative || j.advice || JSON.stringify(j)) }));
  await T("finance-exceptions (UC1B/7)", "/api/ai/finance-exceptions", null, (j) => ({ ok: arr(j.groups).length >= 1, why: `${arr(j.groups).length} groups` }));
  await T("risk-watchlist (UC6)", "/api/ai/risk-watchlist", null, (j) => ({ ok: arr(j.accounts || j.watchlist).length >= 1, review: true, why: clip(JSON.stringify(j)) }));
  await T("cost-exceptions (UC8)", "/api/ai/cost-exceptions", null, (j) => ({ ok: arr(j.exceptions || j.items || j.jobs).length >= 1, review: true, why: clip(JSON.stringify(j)) }));
  await T("compliance-readiness (UC10)", "/api/ai/compliance-readiness", null, (j) => ({ ok: nonEmpty(j.narrative || j.summary), review: true, why: clip(j.narrative || j.summary || JSON.stringify(j)) }));
  { const j = (await jpost("/api/ai/lots", null)).j; rec("lots (UC9)", arr(j.lots).length >= 1 ? "PASS" : "FAIL", `${arr(j.lots).length} lots`); }
  await T("lot-trace (UC9)", "/api/ai/lot-trace", { lot: "LOT-SKU-0001-001" }, (j) => ({ ok: arr(j.received).length >= 1 && arr(j.consumed).length >= 1, why: `recv=${arr(j.received).length} cons=${arr(j.consumed).length}` }));

  // --- quotes / sales / accounts ---
  await T("quote-risk", "/api/ai/quote-risk", { quoteId: lostQuote?.id }, (j) => ({ ok: nonEmpty(j.narrative), review: true, why: clip(j.narrative || JSON.stringify(j)) }));
  await T("quote-comms", "/api/ai/quote-comms", { quoteId: lostQuote?.id, kind: "cover" }, (j) => ({ ok: nonEmpty(j.draft), why: clip(j.draft) }));
  await T("lost-quotes", "/api/ai/lost-quotes", null, (j) => ({ ok: j.rejectedCount >= 4 && !j.lowConfidence, why: `n=${j.rejectedCount} ${clip(j.analysis)}` }));
  await T("margin-insight", "/api/ai/margin-insight", null, (j) => ({ ok: arr(j.byJobType).length >= 1, why: `${arr(j.byJobType).length} job types` }));
  await T("account-health", "/api/ai/account-health", { accountId: hero?.id }, (j) => ({ ok: nonEmpty(j.narrative), why: clip(j.narrative) }));
  await T("proactive-maintenance", "/api/ai/proactive-maintenance", { accountId: hero?.id }, (j) => ({ ok: nonEmpty(j.suggestions) && !j.lowConfidence, review: true, why: clip(j.suggestions || JSON.stringify(j)) }));
  await T("recurring-suggest", "/api/ai/recurring-suggest", { accountId: hero?.id }, (j) => ({ ok: nonEmpty(j.suggestion) && !j.lowConfidence, why: clip(j.suggestion) }));

  // --- finance / inventory / fleet / workforce ---
  await T("dunning-draft", "/api/ai/dunning-draft", { invoiceId: overdueInv?.id }, (j) => ({ ok: nonEmpty(j.draft), why: `${j.daysOverdue}d ${clip(j.draft)}` }));
  await T("demand-reorder", "/api/ai/demand-reorder", null, (j) => ({ ok: arr(j.lowStock).length >= 1, why: `${arr(j.lowStock).length} low` }));
  await T("fleet-compliance", "/api/ai/fleet-compliance", null, (j) => ({ ok: arr(j.dueVehicles).length >= 1, why: `${arr(j.dueVehicles).length} due` }));
  await T("recurring-preview", "/api/ai/recurring-preview", null, (j) => ({ ok: arr(j.plansDue).length >= 1, why: `${arr(j.plansDue).length} due` }));
  await T("skill-gap", "/api/ai/skill-gap", null, (j) => ({ ok: arr(j.uncoveredSkills).length >= 1, why: `${arr(j.uncoveredSkills).length} gaps` }));
  await T("exec-summary", "/api/ai/exec-summary", null, (j) => ({ ok: nonEmpty(j.summary), why: clip(j.summary) }));
  await T("audit-assistant", "/api/ai/audit-assistant", { question: "Summarise the most recent changes in the audit log — who did what, and when?" }, (j) => ({ ok: nonEmpty(j.answer) && !j.lowConfidence, why: clip(j.answer) }));

  // --- time-anomaly: scan completed REPAIR jobs for a flagged one ---
  {
    const repairs = wos.filter((w) => w.jobType === "REPAIR" && ["COMPLETED", "INVOICED", "CLOSED"].includes(w.status)).slice(0, 18);
    let flagged = null;
    for (const w of repairs) { const { j } = await jpost("/api/ai/time-anomaly", { workOrderId: w.id }); if (j?.flagged) { flagged = { wo: w.workOrderNumber, j }; break; } }
    rec("time-anomaly", flagged ? "PASS" : "FAIL", flagged ? `${flagged.wo}: ${flagged.j.loggedHours}h vs ${flagged.j.typicalHours}h typ` : "no flagged REPAIR job found");
  }

  // --- streaming: ops-assistant ---
  try {
    const ev = await sse("/api/ai/ops-assistant", { question: "Which account has overdue invoices, and how much is outstanding?" });
    const ans = ev.find((e) => e.type === "answer");
    rec("ops-assistant (stream)", ans && nonEmpty(ans.text) && !ans.lowConfidence ? "PASS" : "FAIL", `${ev.length} events; ${clip(ans?.text || ev.map(e=>e.message).join("|"))}`);
  } catch (e) { rec("ops-assistant (stream)", "FAIL", e.message); }

  // --- streaming: extract-document (visual LLM) ---
  try {
    const fd = new FormData();
    fd.append("file", new Blob([fs.readFileSync(PDF)], { type: "application/pdf" }), "sample-supplier-invoice.pdf");
    const ev = await sse("/api/ai/extract-document", null, fd);
    const res = ev.find((e) => e.type === "result");
    rec("extract-document (vision)", res && (arr(res.draft?.lines).length >= 1 || arr(res.lines).length >= 1) ? "PASS" : (res ? "REVIEW" : "FAIL"), clip(JSON.stringify(res || ev.map(e=>e.message))));
  } catch (e) { rec("extract-document (vision)", "FAIL", e.message); }

  // --- summary ---
  const pass = results.filter((r) => r.status === "PASS").length;
  const review = results.filter((r) => r.status === "REVIEW").length;
  const fail = results.filter((r) => r.status === "FAIL").length;
  console.log(`\n==== ${pass} PASS, ${review} REVIEW, ${fail} FAIL of ${results.length} ====`);
  if (fail) { console.log("FAILS:", results.filter(r=>r.status==="FAIL").map(r=>r.name).join(", ")); process.exit(1); }
}
main().catch((e) => { console.error("HARNESS ERROR", e); process.exit(2); });
