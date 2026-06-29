# MaintenanceOS — World-Class End-to-End Demo Script

**Every AI feature, in narrative order, with the exact record to click and the
real result you'll see.** No smoke and mirrors — every figure is computed live
from the database and grounded/cited by Progress Agentic RAG. The whole script
is backed by an automated end-to-end test (`npm run demo:e2e`) that exercises
all 45 features and was green when this was written.

- **Live demo:** https://maintenanceos.fly.dev  ·  sign in as **admin@maintenanceos.com.au** / `demo1234`
- **The through-line:** one hero account — **Bendigo Regional Real Estate** — and
  its recurring *leaking-tap* problem ties the whole story together (root cause →
  commit date → parts → lot trace → account risk).
- **The architecture (say it once, up front):** three reusable layers on top of
  the existing ERP — **Agentic RAG** (knowledge), the **MCP Server** (live data),
  and the **Retrieval Agent / RAO** (orchestration) — with **human-in-the-loop**
  approval + an immutable **audit log** on every write. *The app isn't replaced;
  it gets a co-pilot.*

> Figures below are real and were verified live. Exact dollar values / counts
> shift a little as "today" moves, but the structural facts (which account tops
> the watchlist, which lot traces, the recommended commit date logic) are
> deterministic from the seed.

### Cross-cutting UI you can lean on anywhere
- **"What is this?" popups** — every AI feature has a small **✦ sparkle button**
  beside its title. Click it for a full-screen explainer: what it does, how it
  works behind the scenes, why it's valuable, the problem it solves, and the
  architecture layers it uses. Use it to answer any "what's that?" on the spot —
  there's one on all 45 features.
- **Live agent timeline** (Ops Assistant) — you watch the agent's *real* plan and
  each *live ERP query* stream in ("Reading invoices · status = overdue · LIVE
  MCP"), with a live query-count + timer. Not a fake spinner — narrate it.
- **Charts** — AI Insights renders bar charts (account risk scores colour-coded
  red/amber/blue; margin % by job type), so the numbers are visual, not just text.
- **Self-driving stations** — the Technician day-plan **pre-fills the busiest
  tech + date and auto-runs**, so it always shows a live result with no setup.

> **If a card spins and errors with a gateway timeout (408):** that's a transient
> ARAG hiccup on the narration call, not your data — just click the button again.
> The figures are computed locally; only the write-up timed out. Warming up in
> §A makes this rare.

---

## Feature coverage map (all 45)

| # | Feature | Act | Where |
|---|---------|-----|-------|
| 1 | AI status | 0 | (warm-up) |
| 2 | Daily briefing | 1 | Dashboard |
| 3 | Ops Assistant (RAO, streamed) | 1 | Ops Assistant |
| 4 | Knowledge Copilot (cited) | 1 | Copilot |
| 5 | Help assistant (user guide) | 1 | bottom-right bubble |
| 6 | Semantic search (`find`) | 1 | Copilot / related panels |
| 7 | Retrieval Agent (`agent`) | 1 | (under Ops Assistant) |
| 8 | Risk watchlist (UC6) | 2 | AI Insights |
| 9 | Cost exceptions (UC8) | 2 | AI Insights |
| 10 | Compliance readiness (UC10) | 2 | AI Insights |
| 11 | Executive summary | 2 | AI Insights |
| 12 | SLA early-warning | 2 | AI Insights |
| 13 | Margin insight | 2 | AI Insights |
| 14 | Lost-quote analysis | 2 | AI Insights |
| 15 | Demand-aware reorder | 2 | AI Insights |
| 16 | Skill-coverage gaps | 2 | AI Insights |
| 17 | Fleet compliance | 2 | AI Insights |
| 18 | Recurring-run preview | 2 | AI Insights |
| 19 | Smart intake triage | 2/3 | AI Insights / intake |
| 20 | Audit assistant | 2 | AI Insights |
| 21 | Dispatch next-best-actions | 3 | Dispatch Board |
| 22 | Technician day-plan | 3 | Dispatch / Employee |
| 23 | Recurring-fault root cause (UC1A) | 4 | Work Order detail |
| 24 | Service commit-date (UC2) | 4 | Work Order detail |
| 25 | Parts-kit prediction | 4 | Work Order detail |
| 26 | Safety pre-flight | 4 | Work Order detail |
| 27 | Site-access briefing | 4 | Work Order detail |
| 28 | Similar / callback detection | 4 | Work Order detail |
| 29 | Draft quote | 4 | Work Order detail |
| 30 | Job playbook (+ save template) | 4 | Playbooks |
| 31 | Completion note | 4 | Work Order detail (done job) |
| 32 | Work-order timeline | 4 | Work Order detail |
| 33 | Time anomaly | 4 | Work Order detail |
| 34 | Variation claim | 4 | Work Order detail |
| 35 | Customer status update | 4 | Work Order detail |
| 36 | Finance exceptions (UC1B/7) | 5 | Invoices |
| 37 | Dunning draft | 5 | Invoices |
| 38 | Quote risk check | 5 | Quotes |
| 39 | Quote comms draft | 5 | Quotes |
| 40 | Document import / Visual LLM | 5 | Supplier bills (AP) |
| 41 | Account health | 6 | Accounts |
| 42 | Proactive maintenance | 6 | Accounts |
| 43 | Recurring-plan suggest | 6 | Accounts |
| 44 | Part / lot trace + lots (UC9) | 7 | Inventory |
| 45 | Fleet / asset service co-pilot (UC3) | 7 | Fleet |

---

## ACT 0 — Pre-flight (before the audience, ~3 min)

1. **Reset to the guaranteed state (optional but recommended):** Admin →
   **System → Reset demo data** (re-seeds the hero scenarios in ~5s). Skip if
   you just deployed.
2. **Self-test the whole demo:** from `apps/api`, `BASE=https://maintenanceos.fly.dev npm run demo:e2e`.
   It hits all 45 features and prints ✅/❌. Green = you're safe to present.
3. **Warm the slow calls** (first call pays a cold start): Dashboard → *Generate
   briefing*; Ops Assistant → *"How many work orders are open?"*; Invoices → AI
   Finance Exceptions → *Scan*; upload the sample invoice once (see Act 5) then
   Cancel.

If `demo:e2e` is green and the warm-ups returned, present with confidence.

---

## ACT 1 — The morning read (≈4 min)

### Daily briefing — *Dashboard → Generate briefing*
**You'll see:** a manager's brief that opens on the real pressure — *"Focus on
the eight SLA breaches, particularly the urgent leaking tap at Eaglehawk Aged
Care (WO-…0047) and the emergency …"* plus overdue cash and low stock.
**Say:** "This is computed from live KPIs, then ARAG writes the narrative. Not a
static dashboard — it tells me what to do first."

### Ops Assistant — the hero moment — *Ops Assistant → ask*
Ask: **"Which account has the most overdue invoices, and how much is
outstanding?"**
**You'll see:** it streams its plan ("Planning… Querying the live ERP… Writing
the answer"), then a real table — e.g. *Eaglehawk Aged Care — $7,112.71 across
INV-…0035, …* across ~10 accounts.
**Say:** "That's the Retrieval Agent orchestrating across the **live** ERP
through the MCP Server — not a pre-built report. Ask it anything about the
business." (Follow-up: *"And which technician is free tomorrow morning?"*)

### Knowledge Copilot — cited answers — *Knowledge Copilot*
Ask: **"What controls are required when working at heights?"**
**You'll see:** a grounded answer ("Use a harness above 2 m; inspect before use;
don't work in winds above 35 km/h…") with **citations** to the safety policy.
**Say:** "Every claim cites its source. Below a confidence floor it says *not
enough data* rather than guessing." (This is the `ask` layer; the same engine
powers the **Help assistant** bubble bottom-right, scoped to the user guide, and
the semantic `find` behind related-records panels.)

---

## ACT 2 — The operations board: AI Insights (≈5 min)

Open **AI Insights** — a wall of on-demand analyses over the whole operation.
Click through; each is grounded and degrades gracefully if there's nothing to
report.

- **Risk watchlist (UC6):** ranks accounts by composite risk. **Top:** *Eaglehawk
  Aged Care, score 56* (9 open jobs, 8 SLA-risk, ~$7.1k overdue). One screen for
  "who's about to be a problem."
- **Cost exceptions (UC8):** completed jobs pre-labelled **Explained / Partial /
  Unresolved** — e.g. *WO-…0086 (Sunraysia), margin 11.35%, Unresolved.*
- **Compliance readiness (UC10):** compares the written **finance policy** vs the
  live configuration and flags **policy-vs-practice gaps** (disputed bill, overdue
  AR).
- **Executive summary:** a board-ready paragraph with real figures (month
  revenue, outstanding AR, margin).
- **SLA early-warning:** *~11 jobs* inside the 48-hour window + the recommended
  action.
- **Margin insight:** leakage ranked by job type (6 job types).
- **Lost-quote analysis:** *6 lost quotes; **REPAIR** is 4 of 6* — "we're losing
  high-margin repair quotes."
- **Demand-aware reorder:** *4 items below reorder point*, weighted by upcoming
  jobs.
- **Skill-coverage gaps:** *Asbestos awareness — 1 active holder for 5 open
  jobs.* A single point of failure, surfaced.
- **Fleet compliance:** *8 vehicles* with service/rego due soon.
- **Recurring-run preview:** *3 plans due*, two at the same site (a batching tip).
- **Smart intake (triage):** paste *"Burst pipe flooding a kitchen, water
  everywhere, urgent"* → **EMERGENCY / URGENT**, skills *[Basic plumbing, …]*,
  SLA ~2h.
- **Audit assistant:** ask *"Summarise the most recent changes in the audit log —
  who did what, and when?"* → a cited, plain-language summary of recent actions.

**Say:** "Every one of these is the same pattern: compute exact facts from the
database, then ARAG narrates and cites. The human reads the judgment, not five
reports."

---

## ACT 3 — Intake to dispatch (≈2 min)

- **Dispatch Board → next-best-actions:** *7 ranked actions* — ASSIGN / ESCALATE
  / RESCHEDULE — each with a recommended technician. **Approve one** to assign in
  a click (writes to the ERP, logged in the audit trail).
- **Technician day-plan:** open a scheduled tech/day → a narrated run-order with
  start/finish times and **clash detection**.

**Say:** "It proposes; the dispatcher approves. The agent never moves your data
on its own."

---

## ACT 4 — One job, end to end: the leaking tap (≈6 min, the centrepiece)

Go to **Work Orders**, open the **open "Repair leaking tap"** job at the hero
site (status *Waiting on parts* — this is the commit-date target). This one job
shows off the whole field-intelligence suite:

- **Recurring-fault root cause (UC1A):** ranks causes with **evidence and
  citations** — *"Multiple callbacks for the leaking tap (WO-…0121, …0122,
  …0123); workmanship + a labour overrun."* This is the QAD "FPY explainer"
  pattern in maintenance clothing.
- **Service commit-date (UC2):** **"Earliest realistic commit date is
  2026-07-07. Binding constraint: the Tap washer kit — earliest on a PO is
  2026-07-06. Alternative: expedite the PO."** It computed parts shortfall (need
  2, on hand 1) and the open-PO ETA, then narrated it.
- **Parts-kit prediction:** the kit it would pack — **Tap washer kit** — learned
  from what comparable tap jobs actually consumed.
- **Safety pre-flight:** the SWMS/controls for the job + a clearance check on the
  assigned tech.
- **Site-access briefing:** "before you arrive" — contact, after-hours rear-gate
  access, preferred window, pets.
- **Similar / callback detection:** flags this as a **callback** of the 3 prior
  tap repairs at the site.
- **Draft quote:** a grounded quote from ~5 comparable jobs (labour, materials,
  sensible margin) — a *draft* a human approves.

Then open a **completed** tap job to show the close-out assists:
- **Completion note:** a clean write-up of the work + materials.
- **Work-order timeline:** the job's narrated history (4 events: created →
  scheduled → quoted → invoiced).
- **Time anomaly:** find a job that logged far more than its peers — *e.g. 18h vs
  5.4h typical* — flagged for review.
- **Variation claim:** a scope-creep / additional-works note when actuals exceed
  the quote.
- **Customer status update:** a customer-facing progress note, ready to send.

**Job playbook (Playbooks):** generate one for *"replace a leaking kitchen mixer
tap"* → a structured, **5-step** playbook (materials: tap washer, mixer
cartridge, …) grounded in history + safety docs. **Save as template** to write it
back to the knowledge base. (Try a nonsense job to show it *refuses* rather than
fabricate.)

---

## ACT 5 — The money story (≈4 min)

- **Finance exceptions (UC1B/7)** — *Invoices → AI Finance Exceptions → Scan:*
  **5 exception groups**, grouped by root cause — e.g. a supplier bill
  **over-billed by $280** vs its PO (3-way-match break), a disputed bill, overdue
  AR — each with a plain-language explanation, the **policy citation**, and a
  one-click **HITL fix**.
- **Dunning draft** — open an overdue invoice (e.g. INV-…0090, 32 days over) →
  a tone-appropriate reminder, ready to send (draft only).
- **Quote risk check** — open a quote → "margin 32% vs comparable 18%; above the
  25% floor — safe."
- **Quote comms** — generate the **cover note** for a quote.
- **Document import / Visual LLM** — *Supplier bills (AP) → Import bill from
  document* → drag **`docs/demo-assets/sample-supplier-invoice.pdf`**. It streams
  OCR → structuring, then returns a **draft bill**: supplier **Reece Plumbing**
  auto-matched, line items matched to SKUs, and **PO PO-2026-0004 linked**
  (3-way match). Review → create. *Use the PDF, not a photo.*

**Say:** "Read an invoice, explain a posting failure, propose the fix with the
policy that authorises it — and a human approves every write."

---

## ACT 6 — Accounts & growth (≈2 min)

Open **Bendigo Regional Real Estate**:
- **Account health:** "actively engaged — 10 jobs in 90 days; watch the overdue
  invoice."
- **Proactive maintenance:** services to *offer* this customer, from their
  history.
- **Recurring-plan suggest:** "propose a **quarterly** maintenance plan" — learned
  from their repeat cadence.

**Say:** "The same live data that flags risk also finds the next dollar."

---

## ACT 7 — Inventory, fleet & traceability (≈2 min)

- **Part / lot trace (UC9)** — *Inventory → Part/lot trace.* **38 traceable
  lots.** Pick **`LOT-SKU-0001-001`** → forward (consumed on **3 jobs** /
  accounts) + backward (received) — the FSMA-style recall trace, in maintenance
  form.
- **Fleet / asset service co-pilot (UC3)** — *Fleet.* **Fleet 1 (Ford Ranger)**
  is service-overdue; enter a symptom — *"pulls left under braking, brakes
  squeal"* → grounded guidance citing the van care notes, with a proposed
  service job.

---

## ACT 8 — Close on the platform (≈1 min)

"Everything you saw is **three reusable layers** on top of the ERP you already
run: **Agentic RAG** for knowledge, the **MCP Server** exposing your live data as
tools (the same 80+ tools are available to external agents at
`/mcp`), and the **Retrieval Agent** orchestrating across both — with a human
approving every write and an **audit log** recording it. We don't replace your
OpenEdge investment; we turn it into an intelligent co-pilot."

---

## 6-minute highlight reel (if time is tight)
1. **Ops Assistant** — "most overdue account?" (the live-agent wow)
2. **Risk watchlist** — Eaglehawk tops it (multi-factor risk in one screen)
3. **Leaking-tap Work Order** — root cause → **commit date 2026-07-07** (the UC story)
4. **Finance exceptions** — the $280 over-bill + one-click fix (the money + HITL)
5. **Document import** — read the Reece invoice (Visual LLM)
6. **Lot trace** — `LOT-SKU-0001-001` (recall-ready) → close on the 3-layer platform

## Golden rules
- **Narrate the streaming** (Ops Assistant, document import take 5–40s) — talk
  over the activity log.
- **Every customer-facing output is a draft a human approves** — say it once,
  early; it defuses "is the AI loose on our data?".
- If a card looks thin, you're on the wrong record — the guaranteed hero records
  are in **SE-DEMO-RUNBOOK.md §I**.
- If anything is off before you start, run `npm run demo:e2e` — it tells you
  exactly which feature to check.

## Q&A one-liners
- **"Is it making things up?"** No — answers cite sources; below a confidence
  floor it refuses. Customer outputs are drafts.
- **"Does it change our data?"** Only via a human-approved action, recorded in
  the audit log.
- **"How does it see live data?"** The MCP Server exposes the ERP as tools; the
  Retrieval Agent orchestrates across that and the document knowledge base.
- **"Could this run on our ERP?"** Yes — it's an additive layer, not a
  replacement.
