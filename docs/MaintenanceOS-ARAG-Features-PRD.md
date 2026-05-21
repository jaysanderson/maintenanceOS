# MaintenanceOS × Progress Agentic RAG — Feature PRD

**Status:** Draft v1 · **Date:** 2026-05-21 · **Owner:** Jay Sanders
**Audience:** Product / engineering / Progress ISV demo stakeholders

---

## 1. Context & purpose

MaintenanceOS is an API-first ERP/CMMS for a mid-sized (50+ staff)
property-maintenance / handyman business. It already has:

- A complete REST API with JWT auth + RBAC on every route.
- An auto-generated OpenAPI 3 document (`/docs/json`).
- **A hosted MCP server** at `https://maintenanceos.fly.dev/mcp`
  (Streamable HTTP, stateless) exposing **81 tools** — read + write,
  no-destructive — auto-generated from the OpenAPI spec.
- Rich operational data: work orders, quotes, invoices, accounts, sites,
  employees + skills, inventory, suppliers, POs, vehicles, assets,
  recurring contracts, audit log, and **photo/document attachments** on
  work orders.

This PRD specifies **five AI features** to build into MaintenanceOS using
**Progress Agentic RAG (ARAG)**. Each feature instantiates one of the
generic capability patterns supplied by the stakeholder, and each is
mapped to **named, documented ARAG API surfaces** so feasibility is not
in question — see the per-feature *"Why we're certain"* sections.

### Patterns selected (5 of 12)

| # | Pattern (generic)                     | MaintenanceOS feature                  |
|---|----------------------------------------|----------------------------------------|
| 7 | Internal knowledge navigation          | **F1 — Field Knowledge Copilot**       |
| 4 | Reusable solution playbooks            | **F2 — Job Playbooks**                 |
| 5 | Customer-specific solution shaping     | **F3 — Site-Adaptive Quote Drafting**  |
| 11| Executive summary generation           | **F4 — Daily Operations Briefing**     |
| 12| Prioritization & next-best-action      | **F5 — Dispatcher Next-Best-Action**   |

> The other seven patterns (cross-portfolio discovery, use-case mapping,
> guided solution exploration, product-to-outcome alignment, demo/asset
> recommendation, partner enablement, capability-gap, executive narrative
> for *leaders*) are GTM/enablement-shaped and map poorly to an
> operational field-service ERP. They are listed in §8 as deferred /
> out-of-scope so the choice is explicit.

---

## 2. The architectural enabler (why all 5 are cheap to build)

Two ARAG capabilities make this integration low-risk:

1. **Retrieval Agents support MCP drivers.** The Retrieval Agent
   `drivers` API accepts providers `mcp_http`, `mcp_sse`, `mcp_stdio`
   (*Retrieval Agent API — Developer Reference*, "Supported providers").
   MaintenanceOS already publishes a hosted `mcp_http` endpoint. So an
   ARAG agent can **read and write live MaintenanceOS data with zero new
   integration code** — we register one driver pointing at `/mcp`.

2. **Knowledge Boxes ingest any file type** (PDF, DOCX, images, audio,
   video, HTML) with automatic OCR, NER, summarization and embeddings
   (*AgenticRAG-API-Doc*, §1, §11). Unstructured content the ERP doesn't
   model — equipment manuals, SDS sheets, install guides, signed
   contracts, before/after photos — goes into a KB.

**Integration model**

```
                          ┌─────────────────────────────────────────┐
                          │      Progress Agentic RAG (ARAG)         │
   MaintenanceOS web UI   │                                          │
   (chat panel / cards) ──┼─▶ Retrieval Agent  ──driver: mcp_http──▶ │──▶ MaintenanceOS /mcp (live ERP data, RBAC)
                          │      │                                   │
                          │      ├─ driver: nucliadb (KB) ──────────▶│──▶ Knowledge Box (manuals, SDS, photos, contracts)
                          │      ├─ preprocess: rephrase             │
                          │      ├─ generation: prompt + model       │
                          │      └─ postprocess: REMi quality        │
                          └─────────────────────────────────────────┘
```

- **Auth bridging:** the interaction endpoint accepts a `headers` object
  "forwarded to drivers (e.g., auth headers for MCP servers)"
  (*Retrieval Agent API*, Interact body). MaintenanceOS mints a scoped
  JWT for the logged-in user and passes it as the MCP driver's
  `Authorization` header → **the agent inherits the user's exact RBAC.**
- **Per-session browser tokens:** `POST /service_account_agent_key`
  issues a 1–10 min token scoped to one session, safe to hand to the SPA.
- **Streaming UX:** the Interact endpoint streams SSE
  (preprocess → retrieval → generation tokens → postprocess), so every
  feature gets a live "thinking / searching / answering" UX for free.

**One-time setup (shared by all five features)**

1. Create an ARAG account + one Knowledge Box (`maintenanceos-kb`).
2. Create one Retrieval Agent (`maintenanceos-agent`).
3. Add drivers: `mcp_http` → `https://maintenanceos.fly.dev/mcp`;
   `nucliadb` → `maintenanceos-kb`.
4. Seed the KB (manuals, SDS, contracts, historical job exports, photos).
5. Add a chat/answer panel to the MaintenanceOS SPA that opens an agent
   session and streams interactions. (MaintenanceOS-web is now its own
   repo — this is a self-contained front-end addition.)

Everything after that is **per-feature workflow configuration** (prompts,
rules, generation modules) — no bespoke backend.

---

## 3. Feature specs

### F1 — Field Knowledge Copilot  *(Pattern 7: internal knowledge navigation)*

**Persona / JTBD.** A technician on-site, or a supervisor at the desk,
needs the right manual page / SDS / past-job note for *this* asset or job
without digging through folders.

**What it does.** A search-and-ask panel scoped to a work order or asset.
The tech types ("how do I bleed a Rinnai Infinity 26?") *or snaps a photo
of a faceplate*, and gets a cited answer drawn from manuals, SDS sheets,
prior completed jobs on that asset, and supplier docs — every claim
linked back to its source page.

**Example.**
```
POST /kb/{kbid}/ask
{
  "query": "How do I bleed a Rinnai Infinity 26 after a filter clean?",
  "filters": ["/classification.labels/doctype/manual"],
  "rag_strategies": [{ "name": "page_image" }],
  "citations": "default"
}
→ streamed answer + citations[] mapping each span to a manual page
```
Photo variant uses `query_image` (base64) on `/find` or `/ask`.

**ARAG capabilities used.**
- KB ingestion of manuals/SDS/photos with OCR + embeddings (§11).
- `/find` (recommended retrieval) and `/ask` (cited generative answer,
  NDJSON stream) (§8.1, §9.1).
- **Multimodal** `query_image` for photo-based lookup (§8.4).
- `rag_strategies: page_image / paragraph_image` to return the relevant
  manual figure (§9.3).
- `filters` / `filter_expression` to scope by doctype, asset, site (§14).

**MaintenanceOS-side work.** KB seeding pipeline (export attachments +
link asset/manual metadata as `usermetadata.classifications`); a search
panel in the work-order/asset detail view.

**Acceptance criteria.**
- Answer cites ≥1 source with a clickable reference.
- Photo query returns a relevant result for a seeded faceplate image.
- Results are filterable to the current asset/site.

**Why we're certain.** Every primitive (file+image ingestion, `/ask`
with citations, `query_image`, image RAG strategies, label filters) is a
documented, GA endpoint in the API reference. Nothing here is beta.

---

### F2 — Job Playbooks  *(Pattern 4: reusable solution playbooks)*

**Persona / JTBD.** Operations lead wants every recurring job *type*
("kitchen mixer tap replacement", "gutter clean — 2-storey") to carry a
standard, reusable playbook: required skills/licences, typical materials,
labour hours, step sequence, and safety controls — so quality doesn't
depend on which senior tech is free.

**What it does.** For a given job type, ARAG synthesizes a structured
playbook from (a) historical completed work orders of that type pulled
live via MCP, and (b) manufacturer/safety docs in the KB. Output is a
structured JSON playbook the ERP stores and reuses.

**Example (pre-query weighting toward manuals + past jobs).**
```
POST /kb/{kbid}/ask
{
  "query": "Standard playbook for replacing a kitchen mixer tap",
  "rag_strategies": [{
    "name": "prequeries",
    "queries": [
      { "request": { "query": "kitchen mixer tap replacement steps",
                     "filters": ["/classification.labels/doctype/manual"] }, "weight": 3 },
      { "request": { "query": "completed mixer tap jobs labour + materials",
                     "filters": ["/classification.labels/doctype/job-history"] }, "weight": 5 }
    ]
  }],
  "generative_model": "chatgpt-4o"
}
```
The generation prompt instructs a fixed JSON schema: `skills[]`,
`materials[]`, `labourHours`, `steps[]`, `safety[]`.

**ARAG capabilities used.**
- `prequeries` RAG strategy with per-source weighting + prefiltering
  (§9.3) — anchors the playbook in real history, not the model's priors.
- `hierarchy` / `neighbouring_paragraphs` strategies for coherent context
  (§9.3).
- Prompt engineering for **structured (JSON) output** (§19, generation
  prompt control).
- Optional: **Ingestion Agent (Data Augmentation)** to auto-summarize new
  completed jobs into the KB so playbooks improve over time (§13.1).

**MaintenanceOS-side work.** Periodic export of completed work orders
into the KB labelled `doctype/job-history`; a Playbooks admin screen;
storage of generated playbooks (a new `JobPlaybook` model, or as an
attachment/text resource).

**Acceptance criteria.**
- Generates a valid structured playbook for ≥5 common job types.
- Each playbook field is grounded in retrieved sources (cited).
- Re-running after new jobs are ingested reflects updated material/labour.

**Why we're certain.** Pre-queries with weighting/prefiltering and custom
generation prompts are documented core features; the worked C-3PO
pre-query example in the API doc is structurally identical to this.

---

### F3 — Site-Adaptive Quote Drafting  *(Pattern 5: customer-specific solution shaping)*

**Persona / JTBD.** An estimator must turn a generic playbook (F2) into a
quote tailored to *this* site and account — its access constraints, past
job outcomes, contract pricing, and margin rules.

**What it does.** A Retrieval Agent takes the job type + site/account ID,
**pulls structured context live via the MCP driver** (the site's prior
work orders, the account's contract terms, current inventory/labour
rates, historical costing on comparable jobs), blends in unstructured
site notes/photos from the KB, and drafts a quote body ready for the
existing `quotes_create_quotes` MCP tool — leaving the human to confirm.

**Example (agent interaction).**
```
POST /agent/{agent_id}/session/{session}
Headers (forwarded to MCP driver): { "Authorization": "Bearer <user-jwt>" }
{
  "question": "Draft a quote for a 2-storey gutter clean at site SITE-1042.",
  "arguments": { "siteId": "SITE-1042", "jobType": "MAINTENANCE" }
}
```
The agent's workflow: rephrase → retrieval (MCP: `sites_get_sites`,
`work_orders_list_work_orders?siteId`, `work_orders_costing_*`,
`settings` for GST/margin; KB: site access notes) → generation
(structured quote JSON) → REMi quality check.

**ARAG capabilities used.**
- **Retrieval Agent** with `mcp_http` driver to MaintenanceOS — live,
  RBAC-scoped reads (and, on confirm, a write) (*Retrieval Agent API*,
  drivers; providers list).
- `headers` pass-through on Interact → per-user JWT → inherited RBAC.
- Multi-source retrieval (MCP **and** `nucliadb` KB) fused in one answer.
- Generation step with custom prompt for the quote schema; the REST API
  computes subtotal/GST/total server-side (no AI math errors).
- `postprocess: remi` to flag low-confidence drafts (§24; postprocess
  module `remi`).

**MaintenanceOS-side work.** A "Draft with AI" action on the quote
screen that opens an agent session, forwards the user's JWT, and
pre-fills the quote form from the returned JSON (human confirms before
`quotes_create_quotes` fires).

**Acceptance criteria.**
- Draft reflects the specific site's history (e.g. cites a prior job).
- Honours account contract terms / margin threshold from Settings.
- Never auto-creates the quote — always returns a draft for confirmation.
- A technician-role user cannot draft a quote that writes data they lack
  permission for (RBAC inherited; verified by a 403 surfaced in the
  stream).

**Why we're certain.** The MCP driver provider is explicitly supported;
MaintenanceOS already exposes the exact tools needed
(`work_orders_costing_*`, `quotes_create_quotes`, `settings_*` — all in
the live 81-tool catalogue); header forwarding for driver auth is
documented on the Interact endpoint. We already ship a
`draft-quote-from-history` MCP prompt that encodes this workflow.

---

### F4 — Daily Operations Briefing  *(Pattern 11: executive summary generation)*

**Persona / JTBD.** The operations manager wants a 60-second morning
read: SLA breaches, unassigned/at-risk jobs, revenue vs target, margin
leakage, low stock, and overdue invoices — with the work-order/invoice
numbers to click into.

**What it does.** A scheduled (or on-open) Retrieval Agent interaction
pulls the dashboard KPIs and report endpoints live via MCP, plus any
flagged customer notes from the KB, and produces a prioritized,
plain-English briefing with deep links.

**Example.**
```
POST /agent/{agent_id}/session/{session}
{ "question": "Produce today's operations briefing." }
```
Agent retrieval via MCP: `dashboard_list_summary`,
`reports_list_sla-breaches`, `reports_list_margin-leakage`,
`reports_list_low-stock`, `work_orders_list_work_orders?unassigned=true`,
`invoices_list_invoices?overdue=true`. Generation module = `summarize`
with a "6–10 bullets, ordered by priority, include WO/INV numbers" prompt.

**ARAG capabilities used.**
- Retrieval Agent multi-tool fan-out via the MCP driver.
- Generation `module: "summarize"` (Retrieval Agent generation modules).
- Optional `module: "data_viz"` for a chart of revenue/margin trend
  (generation modules list includes `data_viz`).
- Audit trail export for the briefing history (audit endpoints).

**MaintenanceOS-side work.** A dashboard "Briefing" card that renders the
streamed answer; optional cron to pre-generate at 6am and store as a
Notification.

**Acceptance criteria.**
- Briefing lists real, current numbers matching the underlying endpoints.
- Each bullet references a clickable WO/INV/account.
- Generates in <15s to first token via streaming.

**Why we're certain.** Every data source is an existing MCP tool returning
the exact figures (we smoke-tested `dashboard_list_summary` live);
`summarize` is a named generation module; we already ship a
`daily-operations-briefing` MCP prompt. This is the platform's canonical
use case.

---

### F5 — Dispatcher Next-Best-Action  *(Pattern 12: prioritization & next-best-action)*

**Persona / JTBD.** A dispatcher facing a queue of open/at-risk jobs
wants a ranked list of the *next best actions*: which job to assign and to
whom (by skill + territory + availability), which to escalate, which to
reschedule — with the reasoning.

**What it does.** A Retrieval Agent reads the open work orders, SLA
clocks, technician skills/availability and territories live via MCP,
applies prioritization rules, and returns a ranked action list. Each
action proposes the concrete MCP call to execute (e.g. assign tech X to
WO-1023) for one-click human approval.

**Example (conditional workflow).**
```
POST /agent/{agent_id}/session/{session}
{ "question": "What are my next best actions for today's unassigned queue in Bendigo?",
  "arguments": { "territory": "Bendigo" } }
```
Workflow: preprocess `pre_conditional` (branch on whether queue is empty)
→ retrieval (MCP: `work_orders_list_*?unassigned=true`,
`employees_list_employees` filtered to skills/active, `reports_list_sla-breaches`)
→ generation `generation_conditional` (rank + justify) → postprocess
`post_conditional` (suppress actions the user can't perform).

**ARAG capabilities used.**
- Retrieval Agent **conditional modules**: `pre_conditional`,
  `generation_conditional`, `post_conditional` (Retrieval Agent workflow
  step modules) — for branch/route logic.
- MCP driver for live reads; `headers` JWT pass-through for RBAC.
- Global `rules` to encode prioritization policy ("URGENT before HIGH;
  never propose assigning a tech who lacks the required skill") (rules API).
- `arguments` on Interact to pass structured filters (territory, date).

**MaintenanceOS-side work.** A dispatch-board panel that renders ranked
actions as cards, each with an "Apply" button that executes the proposed
MCP tool call (with confirmation).

**Acceptance criteria.**
- Ranking respects priority + SLA urgency and explains each choice.
- Proposed assignments only suggest technicians with the required skill
  and active status (the data already supports this filter).
- Actions are proposals; nothing mutates without explicit user click.

**Why we're certain.** Conditional pre/generation/post modules and global
rules are documented workflow primitives; the required reads
(`work_orders_list_*`, `employees_list_employees` with skill/active
filters) are all in the live tool catalogue and already used by the web
UI's dispatch board.

---

## 4. Cross-cutting requirements

- **RBAC parity.** Every agent feature forwards the signed-in user's JWT
  to the MCP driver; the agent can never exceed the user's REST
  permissions. This is the single most important safety property and is
  testable (technician token → 403 surfaced in stream).
- **Human-in-the-loop on writes.** F3 and F5 *propose* mutations; the
  ERP executes them only on explicit confirmation. Read features (F1, F4)
  never write.
- **Grounding & citations.** F1/F2 must cite KB sources; F3/F4/F5 must
  reference the live records they used (WO/INV/site IDs).
- **Quality monitoring.** Enable REMi postprocess on generative features
  to track answer/context relevance and groundedness over time (§24).
- **Latency/UX.** Use the SSE stream for progressive disclosure
  ("searching… / drafting…") on all five.

---

## 5. Suggested build sequence

| Phase | Ships | Why first |
|-------|-------|-----------|
| 0 | One-time ARAG setup (§2): account, KB, agent, MCP+KB drivers, SPA chat panel | Unlocks all five |
| 1 | **F4 Daily Briefing** | Read-only, no KB seeding, reuses an existing MCP prompt — fastest proof |
| 2 | **F1 Field Knowledge Copilot** | High daily value; needs KB seeding pipeline (reusable later) |
| 3 | **F5 Dispatcher Next-Best-Action** | Read-heavy with propose-only writes; high ops value |
| 4 | **F2 Job Playbooks** | Builds the structured-output + job-history ingestion muscle |
| 5 | **F3 Site-Adaptive Quote Drafting** | Highest value, depends on F2 playbooks + write-confirm UX |

---

## 6. Dependencies

- An ARAG account, zone (`europe-1` or `us-east-1`), KB, and a Retrieval
  Agent with `mcp_http` + `nucliadb` drivers.
- MaintenanceOS API reachable from ARAG's zone (it is —
  `https://maintenanceos.fly.dev`).
- A KB seeding job for unstructured content (F1/F2).
- Front-end work in the **maintenanceOS-web** repo (chat/answer panel,
  feature cards). No new monorepo backend beyond optional cron + a
  `JobPlaybook` store for F2.

---

## 7. Risks & mitigations

| Risk | Mitigation |
|------|-----------|
| Agent proposes an action the user can't perform | RBAC inherited via forwarded JWT; `post_conditional` suppresses; ERP re-checks on apply |
| Hallucinated quote numbers / costs | REST computes all money server-side; AI only proposes inputs; REMi flags low confidence |
| Stale KB (old manuals, old job history) | Sync configs / scheduled re-ingest; Ingestion Agent auto-summarizes new jobs |
| Token cost on heavy briefings | Cache F4 once per morning; cap `top_k`; use a smaller model for summarize |
| MCP write tool misuse | Writes are propose-only + human-confirm; destructive tools already excluded from the catalogue |

---

## 8. Out of scope / deferred (the other 7 patterns)

Listed so the selection is explicit. These are GTM/enablement-shaped and
fit Progress's *own* sales motion better than a field-service ERP:

- **(1) Cross-portfolio opportunity discovery** — possible later as
  "service upsell discovery" (accounts similar to X also buy Y) but not a
  v1 operational need.
- **(2) Use-case mapping** — overlaps F2; could become "describe the
  problem → suggested job template".
- **(3) Guided solution exploration**, **(6) product-to-outcome
  alignment**, **(8) demo/asset recommendation**, **(9) partner
  enablement**, **(10) capability-gap identification** — primarily
  enablement/marketing motions, not in-product ERP features. (10) has a
  thin operational analogue — "skill-coverage gap" alerts — noted as a
  future enhancement.

---

## 9. Feasibility summary (the "absolutely certain" check)

Every feature relies **only on documented, named ARAG surfaces**, and the
MaintenanceOS side relies only on capabilities already shipped and
smoke-tested this cycle:

| Feature | Key ARAG surface(s) | Status |
|---------|---------------------|--------|
| F1 | `/find`, `/ask` + citations, `query_image`, image RAG strategies, label filters | GA, documented |
| F2 | `prequeries` (weighted/prefiltered), generation prompt → JSON, Ingestion Agent (data augmentation) | GA (ingestion agents beta) |
| F3 | Retrieval Agent + `mcp_http` driver, header-forwarded JWT, multi-source fusion, REMi | GA |
| F4 | Retrieval Agent + MCP driver, `summarize`/`data_viz` generation modules, audit | GA |
| F5 | Retrieval Agent conditional modules (`*_conditional`), global `rules`, MCP reads | GA |

The decisive enabler — **ARAG Retrieval Agents can call MCP servers, and
MaintenanceOS already exposes a hosted MCP endpoint with 81 RBAC-scoped
tools** — means no feature requires net-new backend integration. The
work is configuration (agent workflow, prompts, rules, KB seeding) plus
front-end panels.
