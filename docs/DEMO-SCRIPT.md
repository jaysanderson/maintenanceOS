# MaintenanceOS — ARAG Demo Script

A presenter run-sheet that walks through **every Progress Agentic RAG (ARAG)
feature** in MaintenanceOS. Each station gives: what to click, what to say, and
the ARAG mechanism under the hood. Live app: `https://maintenanceos.fly.dev`
(dev login — Alex Admin / ADMIN). Do a dry run first; agentic/streaming steps
take a few seconds.

## The one-sentence framing (open with this)

> "MaintenanceOS is an ordinary ERP — jobs, quotes, invoices, stock. What makes
> it intelligent is a layer on top: **Progress Agentic RAG** answers from our
> documents, the **MCP Server** reads and writes our live data, and a
> **Retrieval Agent** orchestrates across both. Everything it proposes, a human
> approves — and it's all grounded and cited, never invented."

The four ARAG building blocks, in plain terms (name them as they appear):
- **Ask / Generated Answer** — cited Q&A over unstructured docs (`/ask`).
- **Visual LLM Ingestion** — read a document, extract structured data.
- **Retrieval-Agent Orchestration (RAO)** — an agent that queries live data via
  the MCP Server and correlates across sources.
- **Structured generation** — grounded drafts, classifications, ranked actions.

---

## Station 1 — Dashboard: the day at a glance

1. Land on **Dashboard**. Click **Generate briefing**.
2. **Say:** "This is the whole business triaged in one line, written from today's
   live numbers — SLA breaches, overdue invoices, thin-margin jobs, low stock."
3. **Under the hood:** the app computes exact KPIs from the database, ARAG's
   `/predict/chat` narrates them. *Numbers are computed, never hallucinated.*

## Station 2 — Knowledge Copilot: cited answers from your documents

1. Open **Knowledge Copilot**. Click the suggestion **"What does our Working at
   Heights policy require?"**
2. **Say:** "Grounded, cited search over our safety and policy documents — it
   answers from the source and shows you where it came from."
3. **Under the hood:** ARAG **`/ask`** over the knowledge base, filtered to
   `doctype=policy`. Note the **Sources** chips — every claim is verifiable.

## Station 3 — Help assistant: the in-app user guide (bottom-right)

1. Click the **?** bubble in the bottom-right corner (available on every screen).
   Ask **"How do I import a supplier bill?"**
2. **Say:** "Same Ask capability, pointed at the product's own user guide — new
   staff get answered instantly instead of calling support."
3. **Under the hood:** `/ask` filtered to `doctype=userguide`. *Same primitive,
   different corpus — that's the reusability story.*

## Station 4 — Ops Assistant: an agent over your live data (the hero moment)

1. Open **Ops Assistant**. Ask **"Which technician has the most open jobs right
   now?"** then follow up **"How many SLA breaches do we have and which accounts
   are affected?"**
2. **Say:** "This isn't searching documents — it's querying our *live* ERP in
   real time and reasoning over the result. Watch it plan, query, and write the
   answer." Point at the streaming activity log.
3. **Under the hood:** the **Retrieval Agent (RAO)** orchestrating over the
   hosted **MCP Server** (81 tools auto-generated from our API). This is the
   multi-source orchestration layer — the part a plain chatbot can't do.

## Station 5 — AI Insights: on-demand analyses of the whole operation

1. Open **AI Insights**. Run a few cards: **Write summary** (exec summary),
   **Check SLA risk**, **Analyse margin**, **Analyse losses**, **Suggest
   reorders**, **Check coverage**, **Check fleet**, **Preview run**.
2. Use the two tools: **Smart job intake** — paste *"tenant reports a burst pipe
   flooding the kitchen, urgent"* → **Triage**; and the **Audit assistant** —
   ask *"who changed settings recently?"*
3. **Say:** "Each of these is a question someone used to answer by hand across
   several screens. Now it's one click, grounded in our data."
4. **Under the hood:** hybrid — exact figures from the DB, ARAG `/predict/chat`
   narrates/ranks; triage is structured classification; the audit assistant is
   NL over the audit log.

## Station 6 — Job intake → playbook → scheduled job

1. Open **Job Playbooks**. Enter **"Replace a leaking kitchen mixer tap"** →
   **Generate**. Show steps, skills, materials, safety. Click **Create job from
   playbook**.
2. **Say:** "A reusable, structured plan grounded in comparable past jobs and our
   safety docs — and it spins up a ready work order."
3. **Under the hood:** `/find` + `/ask` over history and safety docs, structured
   generation; **Save as template** writes it back to the KB (`doctype=playbook`).

## Station 7 — Dispatch Board: next-best-actions, applied in a click

1. Open **Dispatch Board**. Click **Suggest actions** → ranked ASSIGN / ESCALATE
   / RESCHEDULE. Click **Assign {tech}** on one (HITL apply).
2. Use the **Technician day-plan** — pick a tech + date → **Plan day**.
3. **Say:** "It ranks the unassigned queue and assigns a skill- and territory-
   matched tech in one click — the agent proposes, you approve."
4. **Under the hood:** hybrid ranking; the apply is a real MCP/REST write,
   audited. *HITL — human in the loop.*

## Station 8 — On the job: the Work Order assists

Open a Work Order with history. Show 4–5 of the assists, calling each out:
1. **Draft with AI** (header) — a margin-grounded quote from comparable jobs →
   **Create quote**.
2. **Duplicate / callback check** — avoids billing a warranty twice.
3. **Safety pre-flight** — required SWMS + confirms the tech holds the licences,
   cited.
4. **Parts kit** — predicted from actual comparable-job usage.
5. **Completion note**, **Time check**, **Variation claim**, **Customer update**
   — drafts at each stage.
6. **Copilot tab** — ask *"What similar jobs have we done here before?"*
   (account-scoped cited answer).
7. **Say:** "Every assist is grounded in this account's real history, and every
   customer-facing output is a draft for the tech to review."

## Station 9 — Quote → invoice → exceptions (the money story)

1. **Quote detail:** **Check** (pricing risk vs comparable margins) + **Draft**
   (brand-voice cover note).
2. **Invoices → + Raise invoice:** from a completed job (costed from the quote,
   or from actuals if there's no quote) or manual.
3. **Invoices → ✶ Remind** on an overdue invoice — an escalating dunning draft.
4. **Invoices → AI Finance Exceptions → Scan for exceptions** *(newest feature)*:
   show the grouped list — a **3-way-match mismatch** (bill ≠ PO total), a
   **disputed** bill, **overdue** items, **no-PO-link** bills — each explained
   against the finance policy, with one-click **link-PO** fixes.
5. **Say:** "This is the OpenEdge 'invoice posting failure auto-fix' pattern: the
   system explains the exception in plain language, cites the policy, groups by
   root cause, and proposes the fix — you approve."
6. **Under the hood:** deterministic exception scan + `/ask` over
   `doctype=policy` for the cited rule; the fix is an audited HITL write.

## Station 10 — Document intelligence: read a supplier invoice (Visual LLM)

1. **Invoices → Supplier bills (AP) → ✶ Import bill from document.** Upload a
   supplier invoice (PDF). Show the streaming preview as it reads.
2. **Say:** "Drop in a supplier's invoice and the AI reads it — supplier, dates,
   line items — matches each line to our catalogue and the referenced PO (3-way
   match), and gives us a draft to approve."
3. **Under the hood:** ARAG **ingest → OCR/text-extract → structured extraction**
   (Visual LLM Ingestion), then supplier/SKU/PO matching against our data. A
   digital PDF reads most reliably.

## Station 11 — Account & growth

1. **Account detail:** **Assess** (health / churn risk), **Suggest** (proactive
   maintenance to offer), **Propose** (recurring plan).
2. **Say:** "The agent reads this customer's whole history — jobs, margins,
   overdue invoices — and tells us where the risk and the upsell are."

## Station 12 — Close on the platform angle

1. **Say:** "Everything you saw runs on three reusable layers: **Agentic RAG**
   for documents, the **MCP Server** for live data, a **Retrieval Agent** to
   orchestrate — with human approval on every write. The ERP didn't get
   replaced; it got an intelligent, conversational co-pilot on top. The same
   bricks rebuild for any vertical."
2. *(Optional)* mention the public **MCP endpoint** — the same live data any AI
   agent can query, which is what powers the Ops Assistant.

---

## 6-minute highlight reel (if time is short)

1. **Ops Assistant** (Station 4) — live, streaming, NL over real data. *(wow)*
2. **Import a supplier invoice** (Station 10) — Visual LLM reads + matches.
3. **AI Finance Exceptions** (Station 9.4) — explain + auto-fix.
4. **Draft Quote with AI** (Station 8.1) — margin-grounded in one click.
5. **Knowledge Copilot** (Station 2) — cited answer. *(trust / grounding)*

## Talking points for Q&A

- **Grounding:** answers cite their source; below a confidence threshold the
  assistant says "not enough data" instead of guessing.
- **HITL:** every write (assign, link PO, raise invoice, create bill) is a draft
  a human approves; every approval is in the Audit Log.
- **Reuse:** Ask, Visual Ingestion, RAO and structured generation are the same
  primitives behind every feature — different data, same bricks.
- **Not yet live here:** photo/vision triage (vision API limited on this
  deployment), and external live portals (which we simulate as ingested KB docs).
