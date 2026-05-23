# MaintenanceOS × ARAG — AI Features Backlog

> Source: full read of the Progress Agentic RAG (ARAG / Nuclia) docs +
> first-hand knowledge of what works on our `aws-eu-central-1-1`
> deployment. Curated candidate features beyond the 5 already shipped.

## Already shipped

- **F1 Knowledge Copilot** — grounded Q&A with citations.
- **F2 Job Playbooks** — structured playbook per job type (Save as template / Create job).
- **F3 AI Quote Draft** — anchored on comparable jobs (Create quote / Regenerate).
- **F4 Daily Operations Briefing** — narrated KPIs with WO/INV numbers.
- **F5 Dispatcher Next-Best-Action** — ranked ASSIGN / ESCALATE / RESCHEDULE.

Cross-cutting: confidence gating (ARAG "not enough data" sentinel + configurable score threshold), grounding system prompt on every `/ask`, MCP-server endpoint exposed in Settings for self-serve connectors.

## ARAG capabilities not yet exploited

- **Multimodal** — `query_image` (photo → search) + `page_image`/`paragraph_image` RAG strategies.
- **Document ingestion at scale** — file upload + OCR + audio/video transcription; link/cloud sync (S3, GDrive, SharePoint); conversation fields (email/chat threads).
- **Discovery surfaces** — `/suggest` (typeahead), `/catalog` + `faceted` search.
- **Knowledge graph** — `graph/nodes`, `graph/relations`, `graph_beta` RAG strategy (already auto-populated).
- **Retrieval Agent drivers** — `sql`, web search (`perplexity`/`google`/`tavily`/`brave`), `data_viz` generation module, conditional routing.
- **Quality & governance** — REMi dashboards, audit/interaction export, `security.access_groups` (row-level), `search_configurations` (per-tenant).
- **Embeddable widget** — `<nuclia-search-bar>` for a customer-facing portal.
- **`/predict/summarize`** — dedicated summarisation.

## Deployment caveats (known)

- DA ingestion agents (LABELER / LLM_GRAPH / SYNTHETIC_QUESTIONS) **not exposed via API** on this deployment → do classification / Q&A-generation via `/ask` or `/predict/chat`.
- Agent `generate` module and `mcphttp`-as-retrieval-source error server-side (reported to Progress) → prefer `ask` + `summarize`, the `sql` driver, or app-orchestrated `/predict/chat`.
- `nucliadb` driver auth is provisioned in the ARAG dashboard (no auth field via API).

## Legend

- **Effort:** S ≤ ½ day · M = 1–2 days · L = 3+ days.
- **Feasibility (this deployment):** ✅ proven-pattern · 🟡 needs a quick spike · 🔴 blocked / needs workaround.

---

## Catalogue

### A. Field & knowledge

| # | Feature | What it does | ARAG capability | Feasibility | Effort |
|---|---|---|---|---|---|
| A1 | **Photo Fault Triage** | Tech snaps a photo of a fault/asset; ARAG matches similar past jobs + manual pages, suggests likely cause, parts, safety doc. | `query_image` + `paragraph_image` | 🟡 | M |
| A2 | **Equipment Manual & SDS Copilot** | Ingest real manuals/SDS/compliance PDFs (OCR); Copilot answers with **page-image citations**. | File ingestion + `page_image` RAG strategy | ✅ | M |
| A3 | **Global Smart Search** | One "search anything" bar with typeahead + faceted filters (account / status / trade). | `/suggest` + `/find` + `faceted` | ✅ | M |
| A4 | **Voice Site Notes** | Technician records an audio note; ARAG transcribes + summarises into the work order, fully searchable. | Audio transcription + `/predict/summarize` | 🟡 | M |

### B. Operations intelligence

| # | Feature | What it does | ARAG capability | Feasibility | Effort |
|---|---|---|---|---|---|
| B1 | **"Ask your business" Ops Assistant** | NL questions over live ERP ("which techs are overbooked next week?"). | Retrieval Agent + `sql` driver OR app-orchestrated `/predict/chat` | 🟡 | L |
| B2 | **Scheduled Briefing + trend charts** | Push the F4 briefing as a 6am Notification with a revenue/margin **chart**. | `data_viz` generation module + cron | 🟡 | M |
| B3 | **SLA Early-Warning** | Proactively flag jobs about to breach + recommended action. | App data + `/predict/chat` | ✅ | S |

### C. Sales & customer comms

| # | Feature | What it does | ARAG capability | Feasibility | Effort |
|---|---|---|---|---|---|
| C1 | **Quote Risk Check** | Compare a draft quote against comparable history; flag under/over-pricing + margin risk with reasoning. | `prequeries` + REMi | ✅ | M |
| C2 | **Brand-Voice Comms Drafting** | Auto-draft quote cover notes, follow-ups, overdue-invoice reminders. | `/predict/chat` | ✅ | S |
| C3 | **Win/Loss & Margin Insight** | "Why are kitchen jobs losing margin?" — analysis over quote + costing history. | `/ask` + `prequeries` | ✅ | M |

### D. Compliance, safety & graph

| # | Feature | What it does | ARAG capability | Feasibility | Effort |
|---|---|---|---|---|---|
| D1 | **Smart Job Intake / Triage** | Paste a customer request → classified jobType, priority, required skills, suggested SLA. | `/predict/chat` | ✅ | S |
| D2 | **Skill & Licence Coverage** | Graph of skills↔employees↔jobs; flag jobs needing a licence nobody active holds. | Knowledge graph (`graph/nodes`) + app data | 🟡 | M |
| D3 | **Safety Pre-Flight** | On dispatch, surface the relevant SWMS/safety controls + confirm worker holds required clearances. | `/ask` (safety docs) + graph | ✅ | M |
| D4 | **Knowledge Graph Explorer** | "Show everything connected to this account/site/asset." | `graph/nodes` + `graph/relations` | 🟡 | M |

### E. Assets & inventory

| # | Feature | What it does | ARAG capability | Feasibility | Effort |
|---|---|---|---|---|---|
| E1 | **Asset History Q&A + service hints** | Per-asset copilot ("what's been done to chiller #3, what's due?"). | `/ask` filtered by asset | ✅ | S |
| E2 | **Recurring-Plan Suggester** | Propose a recurring maintenance plan from an asset's job history. | `/ask` + `/predict/chat` | ✅ | M |
| E3 | **Reorder & Supplier Narrative** | Low-stock summary with suggested PO + best supplier from history. | App data + `/predict/chat` | ✅ | S |

### F. Reporting & exec

| # | Feature | What it does | ARAG capability | Feasibility | Effort |
|---|---|---|---|---|---|
| F1 | **NL Report Builder** | "Revenue by account type last quarter as a bar chart." | `sql` driver + `data_viz` | 🟡 | L |
| F2 | **Monthly Exec Summary** | Board-ready narrative from KPIs. | `/predict/summarize` | ✅ | S |
| F3 | **Audit/Compliance Assistant** | Query the audit log in NL ("who changed settings last month?"). | `/ask` over ingested audit + app data | ✅ | S |

### G. Platform / multi-tenant

| # | Feature | What it does | ARAG capability | Feasibility | Effort |
|---|---|---|---|---|---|
| G1 | **Customer Portal Widget** | Embeddable ARAG search bar so customers ask about *their own* jobs/invoices. | Widget + `security.access_groups` | 🟡 | L |
| G2 | **External Doc Sync** | Sync a customer's compliance docs from SharePoint/GDrive/S3 into the KB. | External connections + sync configs | 🟡 | M |

---

## Recommended next 6 (value-to-effort, demo-strong, mostly proven)

1. **A2 Equipment Manual & SDS Copilot** — real document grounding with page-image citations. (M, ✅)
2. **D1 Smart Job Intake / Triage** — high-frequency daily action, tiny effort. (S, ✅)
3. **C2 Brand-Voice Comms Drafting** — instant polish on quotes/invoices. (S, ✅)
4. **B1 "Ask your business" Ops Assistant** — flagship; routes around the current agent blockers via the `sql` driver or app-orchestrated hybrid. (L, 🟡)
5. **A1 Photo Fault Triage** — the multimodal "wow" for demos. (M, 🟡)
6. **D3 Safety Pre-Flight** — safety docs + skills graph → strong compliance story. (M, ✅)

## Verification approach (per feature)

- Spike the ARAG capability in isolation first to confirm it works on this deployment.
- Backend route under `/api/ai/*` behind the existing JWT hook; gate generative answers with the existing confidence/sentinel logic in `lib/arag.ts`.
- Verify end-to-end via `app.inject`, then in the browser (preview), then smoke-test on Fly.
- Keep "ARAG is the only AI gateway" — all generation via `/ask` or `/predict/chat`.

---

*Source: this catalogue was derived from the full ARAG documentation set
(`AgenticRAG-API-Doc.MD`, `Retrieval Agent API — Developer Reference.md`,
plus the online docs at `docs.rag.progress.cloud`) and verified against the
working configuration of MaintenanceOS's KB + Retrieval Agent.*
