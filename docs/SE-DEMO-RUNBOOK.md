# Sales-Engineer Run-Book — MaintenanceOS ARAG Demo (end to end)

Operational instructions for running the demo live. The *narrative* (what to say
per feature) is in `DEMO-SCRIPT.md`; **this** doc is the checklist — setup,
exact actions, timing, recovery, and reset. Read both once before your first run.

- **App:** https://maintenanceos.fly.dev
- **Login:** if a sign-in screen appears, use **admin@maintenanceos.com.au /
  demo1234** (Alex Admin · ADMIN — the role that can see everything).
- **What it is in one line:** an ordinary ERP made intelligent by Progress
  Agentic RAG (documents) + the MCP Server (live data) + a Retrieval Agent
  (orchestration), with a human approving every write.

---

## A. T-minus 10 — pre-flight checklist (do this BEFORE the audience is watching)

The AI features are fast once warm, but the first call of the session pays a
cold-start (agent session spin-up, KB warm-up). **Warm every agentic feature
once** so the audience never waits on a cold call:

1. ☐ Open the app and confirm you're signed in (top-right shows **Alex Admin**).
2. ☐ **Dashboard → Generate briefing** — wait for the headline. (warms KB + narration)
3. ☐ **Ops Assistant** — ask *"How many work orders are open?"* and let it finish.
   *(This is the biggest cold-start — the Retrieval Agent session. Always warm it.)*
4. ☐ **Invoices → AI Finance Exceptions → Scan for exceptions** — let it return.
5. ☐ **Invoices → Supplier bills (AP) → ✶ Import bill from document** — upload the
   sample invoice once (see §B), watch it complete, then **Cancel**. (warms OCR)
6. ☐ **Knowledge Copilot** — click any suggestion, confirm a cited answer.
7. ☐ Have the **sample invoice file** on your desktop, ready to drag (see §B).
8. ☐ Close extra tabs; set browser zoom so the left nav + content both fit.

If all seven return clean answers, you're ready.

## B. The sample supplier invoice (for the document-import station)

- File: **`docs/demo-assets/sample-supplier-invoice.pdf`** in the repo —
  download it to your desktop before the demo.
- Or regenerate it: from `apps/api`, `npm run gen:sample-invoice` → writes
  `/tmp/sample-supplier-invoice.pdf`.
- It is a **Reece Plumbing** tax invoice referencing **Customer PO PO-2026-0004**
  with catalogue line items — so on import it auto-matches the supplier, the
  line items, and the PO (3-way match). **Use the PDF, not a photo** (a digital
  PDF extracts reliably; photos can lose the line-item table).

## C. Golden rules while presenting

- **Narrate the streaming bits.** Ops Assistant and document-import stream their
  progress (5–40s). Talk over the activity log — "watch it plan, query the live
  data, then write the answer." Never present in silence while it spins.
- **Navigate by clicking — don't memorise IDs.** The demo data is reseeded on
  every deploy, so WO/INV/BILL numbers change. Click rows; don't type a specific
  number you saw yesterday.
- **Call out HITL every time you write.** Assign a tech, link a PO, raise an
  invoice, create a follow-up job — each is a *draft the human approves*, logged
  in the Audit Log. That's the trust story; say it out loud.
- **Everything is grounded.** Point at the **Sources** chips / citations.
  Mention that below a confidence threshold it says "not enough data" instead of
  guessing.
- **Writes are harmless.** The actions you take are additive demo data — no need
  to undo anything between back-to-back demos (see §F).

## D. The end-to-end run (full path, ~20 min)

Follow these in order; each maps to a station in `DEMO-SCRIPT.md`.

1. **Dashboard** → *Generate briefing*. "The whole business triaged in one line,
   from today's live numbers."
2. **Knowledge Copilot** → suggestion *"What does our Working at Heights policy
   require?"* → show the answer + **Sources**. "Cited Q&A over our safety docs."
3. **Help bubble (?, bottom-right)** → ask *"How do I import a supplier bill?"*
   "Same capability, pointed at the product's user guide."
4. **Ops Assistant** *(hero)* → *"Which technician has the most open jobs right
   now?"*, then *"How many SLA breaches and which accounts?"* → narrate the
   streaming agent. "This is querying our live ERP in real time — the RAO over
   the MCP server."
5. **AI Insights** → run **Write summary**, **Check SLA risk**, **Analyse
   margin**; then **Smart job intake** — paste *"tenant reports a burst pipe
   flooding the kitchen, urgent"* → **Triage**; then **Audit assistant** →
   *"who changed settings recently?"*
6. **Job Playbooks** → *"Replace a leaking kitchen mixer tap"* → **Generate** →
   **Create job from playbook**.
7. **Dispatch Board** → **Suggest actions** → **Assign {tech}** on one row (HITL).
   Then **Plan day** for a technician.
8. **Work Orders** → open one with history. Show **✶ Draft with AI** → **Create
   quote**; then a few assists (**Safety pre-flight**, **Parts kit**, **Completion
   note**); the **Copilot** tab → *"What similar jobs have we done here before?"*;
   then **Recurring-fault analysis → Analyse this site** → ranked root causes →
   **Create follow-up job** (HITL).
9. **Quotes** → open one → **Check** (pricing risk) + **Draft** (cover note).
10. **Invoices** → **AI Finance Exceptions → Scan** → walk the grouped list (3-way
    mismatch, disputed, overdue, no-PO-link) → if a **Link {PO}** button shows,
    click it (HITL fix). Then **+ Raise invoice → from a completed job**. Then
    **✶ Remind** on an overdue invoice (dunning draft).
11. **Invoices → Supplier bills (AP) → ✶ Import bill from document** → drag the
    sample PDF → narrate the read → show the review form pre-filled (supplier,
    PO 3-way match, green-matched lines) → **Create bill**.
12. **Account** (open one) → **Assess** + **Suggest** + **Propose**. Close on the
    platform line (DEMO-SCRIPT §12).

## E. Short path (6 min, if time is tight)

1. **Ops Assistant** (step 4) — live, streaming. *(wow)*
2. **Import a supplier invoice** (step 11) — Visual LLM reads + 3-way matches.
3. **AI Finance Exceptions** (step 10) — explain + auto-fix.
4. **Draft Quote with AI** (step 8) — margin-grounded in one click.
5. **Knowledge Copilot** (step 2) — cited answer. *(trust)*

## F. If something goes wrong (recovery)

- **An AI button errors or says "not available":** click it again (transient
  ARAG hiccup). The features fail gracefully to a message — they don't crash the
  app. If it persists, move on and come back.
- **Ops Assistant is slow / spins:** it's querying live data — narrate the
  activity log. If it stalls past ~40s, click into a new question and ask a
  simpler one ("How many open jobs?").
- **Document import says "couldn't read":** make sure you used the **PDF** (not a
  screenshot). Re-drag the file.
- **Supplier didn't match on import:** it still resolves "Reece Pty Ltd" →
  "Reece Plumbing"; if the dropdown shows "Select supplier…", just pick Reece
  Plumbing manually — that's a normal review step.
- **A page looks empty:** refresh once (the data is seeded; a transient query
  failure clears on reload).
- **Whole app won't load:** the Fly machine may have auto-stopped; the first
  request wakes it (a few seconds). Refresh.

## G. After the demo / running it again

- **No reset needed between demos.** The writes you made (assignments, linked
  POs, raised invoices, follow-up jobs) are additive demo data and don't break
  anything. Just re-run §A's warm-up isn't even necessary if you're still warm.
- **Want a pristine slate?** Ask engineering to redeploy
  (`fly deploy … --build-arg WEB_CACHE_BUST=$(date +%s)`) — that fully reseeds
  the demo DB. (The KB — policy/safety, user guide, finance policy, ERP records —
  persists across deploys; it's already loaded.)

## H. Q&A cheat-sheet

- **"Is it making things up?"** No — answers cite their source; below a
  confidence threshold it says "not enough data." Customer-facing outputs are
  drafts a human approves.
- **"Does it change our data on its own?"** No — every write is a HITL approval,
  recorded in the Audit Log. The agent proposes; the human decides.
- **"How does it see live data?"** The hosted **MCP Server** exposes the ERP as
  tools; the **Retrieval Agent** orchestrates across that live data and the
  document knowledge base.
- **"What's not shown here?"** Photo/vision triage (vision API limited on this
  deployment) and external live portals (we simulate those as ingested KB docs).
- **"Could this run on our ERP?"** Yes — it's three reusable layers (Agentic RAG,
  MCP Server, Retrieval Agent) on top of the existing app; the app isn't
  replaced, it gets a co-pilot.

## I. Guaranteed demo data — what to click for each AI feature

The seed plants **deterministic hero scenarios** so every feature returns a rich
result every time (no empty cards). The through-line is one hero account:
**Bendigo Regional Real Estate** (the first account in the list) and its first
site. If a card ever looks thin, you're on the wrong record — come back here.

| AI feature | Where | Click this (guaranteed) |
|---|---|---|
| **Risk watchlist** | AI Insights (top) | **Bendigo Regional Real Estate** tops the list — overdue invoice + open jobs + SLA risk stacked on one account |
| **Recurring-fault root-cause** | Work Order detail | Open the **"Repair leaking tap"** job at the hero site → 3 prior tap repairs, callbacks within ~10 days, one big labour overrun |
| **Service commit-date** | Work Order detail | Same open **"Repair leaking tap"** (status *Waiting on parts*) → tap-washer (SKU-0001) is short on hand, **PO-2026-0011** supplies it with an ETA → binding constraint + recommended date |
| **Part / lot trace** | Inventory (top) | Lot **`LOT-SKU-0001-001`** → received once, consumed on 3 jobs (forward + backward) |
| **Finance exceptions** | Invoices | **BILL-2026-0002** is over-billed +$280 vs its PO; plus a disputed bill and overdue invoices, grouped by root cause |
| **Lost-quote analysis** | AI Insights | 6 rejected/expired quotes, REPAIR-heavy with higher margins → "we lose high-margin repair quotes" |
| **Demand-aware reorder** | AI Insights | 4 low-stock SKUs (0001, 0005, 0015, 0021) below reorder point, weighted by upcoming jobs |
| **Skill-coverage gaps** | AI Insights | **Asbestos awareness** — 1 active holder, required by open jobs (single point of failure) |
| **SLA early-warning** | AI Insights | ≥2 open jobs inside the 48h window (one is URGENT) |
| **Fleet compliance / asset-service co-pilot** | Fleet (top) | **Fleet 1** is overdue for service; add a symptom for the co-pilot (cites the van care notes) |
| **Recurring-run preview** | AI Insights | 3 plans due now, two at the **same site** → batching tip |
| **Recurring-plan suggest / account health** | Accounts → Bendigo Regional Real Estate | Quarterly maintenance cadence + overdue cash → proposes a plan, flags churn risk |
| **Time anomaly / completion note / timeline** | Work Order detail (completed jobs) | Completed jobs now carry real time entries; one REPAIR job logs ~3× its peers (anomaly) |
| **Cost exceptions / margin insight / exec summary** | AI Insights | Completed jobs are costed from real timesheets; variances pre-labelled Explained / Partial / Unresolved |

### Resetting to this exact state
- **Fastest (live):** Admin/Manager → **System → Reset demo data** (re-runs the
  seed against the running DB — same guaranteed scenarios, ~5s).
- **Full rebuild:** redeploy (`fly deploy … --build-arg WEB_CACHE_BUST=$(date +%s)`)
  — the DB is seeded into the image, so a deploy reseeds these hero scenarios.
- **KB refresh (optional):** the policy/safety/manual/user-guide docs persist in
  the KB across deploys, so KB-grounded citations keep working. To also refresh
  the ERP-record mirror (for Knowledge Copilot / search over the latest records),
  run `npm run arag:sync` from `apps/api`.
