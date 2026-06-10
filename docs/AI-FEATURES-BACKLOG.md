# MaintenanceOS × ARAG — AI Features Backlog

> Source: full read of the Progress Agentic RAG (ARAG / Nuclia) docs +
> first-hand knowledge of what works on our `aws-eu-central-1-1`
> deployment. Curated candidate features beyond the 5 already shipped.

## Already shipped

- **F1 Knowledge Copilot** — grounded Q&A with citations.
- **F2 Job Playbooks** — structured playbook per job type (Save as template / Create job).
- **F3 AI Quote Draft** — anchored on comparable jobs (Create quote / Regenerate).
- **F4 Daily Operations Briefing** — narrated KPIs with WO/INV numbers; now an **interactive dashboard** (executive headline + click-through detail modals on every WO/INV).
- **F5 Dispatcher Next-Best-Action** — ranked ASSIGN / ESCALATE / RESCHEDULE.
- **F6 Ops Assistant** (was *B1*) — NL Q&A over the live ERP state (technician workload, SLA breaches, margin risk, overdue invoices, low stock); app-orchestrated `/predict/chat` over a Prisma snapshot, with the same confidence-refusal UX.

Cross-cutting: confidence gating (ARAG "not enough data" sentinel + configurable score threshold), grounding system prompt on every `/ask`, MCP-server endpoint exposed in Settings for self-serve connectors (+ optional public no-auth mode for demos).

## Build progress (2026-05) — autonomous Tier 1 backend complete

**Backends built + spot-verified live against ARAG (routes under `/api/ai/*`, 36 endpoints total):**
B3, C1, C2, C3, D1, D3, E2, F2, F3, H1, H3, H4, H5, I1–I7, K1, K2, K3, L1, L2, L3.
J1 (supplier-PO import) built, awaiting `ARAG_NUA_KEY` to verify. All reuse the
hybrid pattern in `apps/api/src/lib/aiFeatures.ts` + confidence gating in `lib/arag.ts`.
Regression: 10/10 tests pass.

**Schema findings (reframed, not built as written):**
- **E1 / L4 (asset history/predictive)** — *schema-limited.* `Asset` rows are the
  company's own gear (tools/trailers/machines), **not serviced customer equipment**, and
  there's no `WorkOrder`↔`Asset` link. Asset job-history features don't fit the model;
  fleet/tool service-due is covered by **I4**.
- **E3 (reorder narrative)** — subsumed by **I6** (demand-aware reorder), which is the
  richer version. E3 not built separately.
- **H6 (onboarding copilot)** — pending: ingest the user guide into the KB; then the
  existing F1 Copilot answers from it (no new endpoint).

**Web UI built + verified (browser):** new **AI Insights** page (F2, B3, C3, I1,
I4, I5, I6, I7, F3, D1), a 9-tool **AI cockpit** on each work order (L1, L2, H1,
H3, H4, H5, D3, K2, K3), AccountDetail (I2, K1, E2), QuoteDetail (C1, C2),
Invoices dunning modal (I3), Dispatch day-plan (L3), plus the J1 PO importer.
Reusable `AiAssist` component drives them all. Exec-summary + safety-preflight
confirmed live; no console errors; web build clean.

**Remaining:** Tier 3 app-side equivalents (F1 NL reports + charts, B2 scheduled
briefing/cron, D2/D4 graph) — optional, reduced versions of platform-blocked
features; J2–J8 (same ingest→extract pattern as J1); then one batched Fly deploy.

## ARAG capabilities not yet exploited

- **Multimodal** — `query_image` (photo → search) + `page_image`/`paragraph_image` RAG strategies.
- **Document ingestion at scale** — file upload + OCR + audio/video transcription; link/cloud sync (S3, GDrive, SharePoint); conversation fields (email/chat threads).
- **Discovery surfaces** — `/suggest` (typeahead), `/catalog` + `faceted` search.
- **Knowledge graph** — `graph/nodes`, `graph/relations`, `graph_beta` RAG strategy (already auto-populated).
- **Retrieval Agent drivers** — `sql`, web search (`perplexity`/`google`/`tavily`/`brave`), `data_viz` generation module, conditional routing.
- **Quality & governance** — REMi dashboards, audit/interaction export, `security.access_groups` (row-level), `search_configurations` (per-tenant).
- **Embeddable widget** — `<nuclia-search-bar>` for a customer-facing portal.
- **`/predict/summarize`** — dedicated summarisation.
- **Custom extraction (write-path)** — per-KB **Extract Strategies** (`POST /extract_strategies/{kbid}`) carrying a **`vllm_config`** (visual-LLM extraction with a `rules` list) + **`ai_tables`** (line-item/table extraction), and **`split_strategies`** for cutting batch files. Paired with a **generator agent** (or `/ask` with a JSON-schema instruction) to standardise messy per-supplier docs into one canonical JSON shape. This is the **document-in → structured-record-out** pipeline (see Theme J) — the first *write* path; everything shipped so far is read-only.

## Deployment caveats (known)

- DA ingestion agents (LABELER / LLM_GRAPH / SYNTHETIC_QUESTIONS) **not exposed via API** on this deployment → do classification / Q&A-generation via `/ask` or `/predict/chat`.
- Agent `generate` module and `mcphttp`-as-retrieval-source error server-side (reported to Progress) → prefer `ask` + `summarize`, the `sql` driver, or app-orchestrated `/predict/chat`.
- `nucliadb` driver auth is provisioned in the ARAG dashboard (no auth field via API).
- **Extract Strategies DO work — via the KB-scoped path** — the account-level `GET /api/v1/extract_strategies/{kbid}` is **403**, but the **KB-scoped** `GET/POST /api/v1/kb/{kbid}/extract_strategies` works with the **KB key** (200). A rules-based VLLM `ExtractConfig` (`vllm_config.rules`) is provisioned by `npm run arag:provision-extract` (→ `ARAG_EXTRACT_STRATEGY_ID`) and applied on upload via the `x-extract-strategy` header. Used as a **fallback** for hard scans (it's ~30–60s vs ~6s OCR; image resolution matters more than the strategy on clean docs).
- **NO vision API on this deployment (Theme J / A1 / H2 are platform-blocked)** — *verified 2026-05 with a real NUA key.* The OpenAI-compatible `POST /predict/compat/chat/completions` authenticates with a **NUA key** and works as a **text-only** model gateway ("2+2"→"4", pure model, not RAG) — but it **silently drops `image_url` content**: `aws-claude-4-5-sonnet` replied *"I don't see any document attached"*; the chatgpt models returned "Not enough data." `gemini-2.5-flash-image` → **403**. Combined with Route 1 (extract-strategies) → **403**, there is **no usable image path** via the API. The only theoretical route left is **ingest file → ARAG OCR on processing → `/ask`** (async; TUS upload not yet built; OCR quality unverified) — needs a product call. `ARAG_NUA_KEY` is still useful as a text generation gateway.

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
| B1 | **"Ask your business" Ops Assistant** ✅ **SHIPPED as F6** | NL questions over live ERP ("which techs are overbooked next week?"). | App-orchestrated `/predict/chat` over a Prisma snapshot (sidestepped the `sql`-driver DSN blocker) | ✅ | — |
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

> Themes H–J below were added from an **experience-led walk of every route + screen** (not just a capability scan). H/I are app-orchestrated `/predict/chat` over existing Prisma data — all ✅ proven-pattern, mostly small. J is the new **write-path** document-intake theme.

### H. Daily experience & work-order lifecycle

*The 14-status WO workflow is the app's spine, yet AI only touches two points of it. These fire on **every job**, so they make the daily experience feel AI-native rather than adding another "ask" box.*

| # | Feature | What it does | ARAG capability | Feasibility | Effort |
|---|---|---|---|---|---|
| H1 | **Completion-note writer** | On `POST /:id/complete`, draft the completion notes techs hate writing — from time entries + status history + description; tech edits & submits. | `/predict/chat` | ✅ | S |
| H2 | **Photo auto-caption** | Caption each uploaded work-order PHOTO into the timeline so the record is searchable ("show jobs with water-damage photos"). Today `Attachment.kind=PHOTO` rows are dead pixels. | `query_image` / visual `/predict` | 🟡 | M |
| H3 | **WO timeline narrative** | 3-sentence "what happened on this job" from status history + time entries + costing — for invoice disputes / handover. | `/predict/chat` or `/predict/summarize` | ✅ | S |
| H4 | **Site access briefing** | On dispatch, assemble a "before you arrive" card from `Site.accessNotes` / `petsOnSite` / `preferredVisitWindow` / contact — cuts first-visit failures. | `/predict/chat` | ✅ | S |
| H5 | **Time-entry anomaly flag** | Flag `TimeEntry.hours` far outside comparable-job norms before invoicing ("14h on a usually-3h job — check first"). | App data + `/predict/chat` | ✅ | S |
| H6 | **In-app onboarding copilot** | Knowledge Copilot grounded on the **MaintenanceOS user guide** — "how do I raise a PO?" answered in-app for new staff. | `/ask` over ingested user guide | ✅ | S |

### I. Account, fleet & workforce intelligence

*Several screens (AccountDetail, Fleet) have **zero AI today** despite rich data sitting right there. These turn static record pages into intelligence.*

| # | Feature | What it does | ARAG capability | Feasibility | Effort |
|---|---|---|---|---|---|
| I1 | **Lost-quote / rejection analysis** | Cluster `Quote.status=REJECTED` → "why are we losing roof jobs?" The **demand side** that complements C3's won-work margin view. | `/ask` + `prequeries` | ✅ | M |
| I2 | **Account health & churn risk** | Synthesise a health narrative from job frequency, margin trend, overdue invoices, rejection rate. AccountDetail has **no AI** today. | App data + `/predict/chat` | ✅ | M |
| I3 | **Invoice dunning ladder** | Politeness-escalating reminder **sequence** keyed to days-overdue + account history (extends C2 from one note to a ladder). | `/predict/chat` + `EmailOutbox` | ✅ | S |
| I4 | **Fleet compliance watchdog** | Weekly digest of vehicles with `serviceDueAt` / `registrationDueAt` inside N days + a booking order. Fleet page is **static** today. | App data + `/predict/chat` | ✅ | S |
| I5 | **Recurring-run preview** | Before `POST /run`, narrate "this run creates 12 jobs across 5 sites; site X stacks 3 — batch them" instead of materialising blind. | App data + `/predict/chat` | ✅ | S |
| I6 | **Demand-aware reorder** | Correlate `StockMovement` consumption vs scheduled WOs' likely materials → "you'll run out of X before next month's gutter jobs." Sharper than E3's static low-stock view. | App data + `/predict/chat` | ✅ | M |
| I7 | **Skill-gap hiring signal** | Trend which required-skills repeatedly trigger **ESCALATE** in dispatch → "9 asbestos escalations this quarter — certify someone." | App data + `/predict/chat` | ✅ | S |

### J. Document Intelligence — write-path / intake automation

*The first **write** path: an inbound supplier/customer/field document → visual extraction → LLM analysis → canonical JSON → an ERP record (human reviews before commit). Every entry below is a document that staff **re-key by hand today**.*

| # | Feature | What it does | ARAG capability | Feasibility | Effort |
|---|---|---|---|---|---|
| J1 | **Supplier order-confirmation → PO** | Ingest a supplier doc → draft `PurchaseOrder` + `PurchaseOrderLine[]` (SKU-matched); human reviews before create. *Simplest first cut.* | Extract strategy (`vllm_config` + `ai_tables`) → generator JSON | 🟡 | M |
| J2 | **AP invoice + 3-way match** | Supplier invoice auto-matched against its PO + goods receipt; discrepancies flagged. **The flagship** — classic AP time-saver, strong exec story. | `ai_tables` extraction + match logic | 🟡 | L |
| J3 | **Goods-received docket → receive** | Delivery docket → `POST /:id/receive` with `receivedQty` per line; closes the receiving loop. | vllm line extraction | 🟡 | M |
| J4 | **Document job intake** | Inbound customer job request (PDF/email) → triaged `WorkOrder`. D1, but the **document** is the input, not pasted text. | vllm + JSON → D1 pipeline | 🟡 | M |
| J5 | **Compliance cert capture** | Subbie cert / SWMS / insurance → expiry-tracked record; feeds the skills/licence graph (D2/D3) and flags lapses. | vllm extract type + expiry | 🟡 | M |
| J6 | **Asset nameplate → Asset** | Photograph a chiller/switchboard **data plate** → populated `Asset` (make/model/serial). Highest live-demo "wow." | `query_image` / `page_image` vision → JSON | 🟡 | M |
| J7 | **Field docket / timesheet capture** | Handwritten field docket → `TimeEntry[]`. Removes the worst data-entry chore techs have. | vllm handwriting → JSON | 🟡 | M |
| J8 | **Supplier quote capture** | Supplier materials quote → costing comparable / draft PO; feeds **F3** quote-draft with real current pricing. | vllm + `ai_tables` | 🟡 | M |

**Implementation routes for Theme J** (pick per the spike result):

1. **Persistent Extract Strategy** — register a `vllm_config` + `ai_tables` strategy on the KB via `POST /extract_strategies/{kbid}`; every ingested file gets visual extraction under our rules, then we read the structured output + a generator agent normalises it. The documented path, but **needs a 30-min spike** to confirm the strategy API is enabled on our managed host (same risk class as the DA agents).
2. **App-orchestrated visual call** *(default — de-risked)* — upload doc via the existing `attachments` multipart route → send the page image to a visual model through the generation gateway with a **JSON-schema prompt** → map the JSON to a Prisma `create`. Sidesteps the "is the strategy API on?" question entirely and **reuses infra we already own** (`apps/api/src/routes/attachments.ts` already does multipart + `kind=PHOTO`). Same playbook we used to route around the `sql`-driver blocker for F6.

**Cross-cutting for J:** never auto-commit — extracted records land as a **draft for human review** (low extraction confidence → flag fields, don't fabricate). Audit every create with the source document attached.

> Themes K–L below came from a **second, exhaustive sweep** of every route module and all 26 data models (2026-05). They are the gaps A–J missed — mostly *relationship-* and *time-aware* features (comparing a record against history, or projecting forward) rather than single-record assists.

### K. Revenue, retention & variations

*Forward-looking money. The ERP captures quotes, actuals, job history and asset lists but never turns them into the next dollar — these do.*

| # | Feature | What it does | ARAG capability | Feasibility | Effort |
|---|---|---|---|---|---|
| K1 | **Proactive maintenance / cross-sell suggester** | From a site's job + asset history, surface work the customer should buy now ("this site's gutters haven't been done in 14 months — offer a pre-winter clean"). Revenue *generation*, vs E2's internal recurring plan. | `/ask` over site history + `/predict/chat` | ✅ | M |
| K2 | **Job variation / scope-creep claims** | When a completed job's actual hours/costs diverge from the **quoted** figures, flag the variation and draft the variation note / claim so margin isn't silently eaten. Completion-time (vs C1's draft-time risk check). | App data (Quote vs costing) + `/predict/chat` | ✅ | M |
| K3 | **Customer job-status updates** | Auto-draft a plain-English status update for the customer at each WO milestone ("scheduled Thursday, tech is John, here's the plan"). Distinct trigger from C2's quote/invoice comms. | `/predict/chat` | ✅ | S |

### L. Field intelligence & quality control

*Relationship-aware reasoning over the work-order corpus — the biggest untapped signal in the app.*

| # | Feature | What it does | ARAG capability | Feasibility | Effort |
|---|---|---|---|---|---|
| L1 | **Duplicate / callback / warranty detection** | On a new WO, semantically match it against open WOs at the same site (duplicate) and recently-completed jobs (callback/rework → warranty risk) — flag before dispatching a paid truck. **Strongest find of the sweep.** | `/find` semantic similarity filtered by site/asset | ✅ | M |
| L2 | **Parts prediction / job kitting** | Given a WO description, predict the parts + quantities to load, grounded in *actual* `StockMovement` consumption on comparable completed jobs (quantitative, vs F2 playbooks' generic "typical materials"). Cuts second trips. | `/ask` over job+stock history + `/predict/chat` | ✅ | M |
| L3 | **Technician day-plan narrative + clash detection** | Per-tech day view: narrate the schedule, flag time clashes and wasteful territory hops ("the Bendigo→Ballarat jump wastes 90 min — reorder suggested"). Sequencing, vs F5's assignment ranking. | App data (schedule + territory/suburb) + `/predict/chat` | ✅ | M |
| L4 | **Predictive asset-failure trend** | Flag assets trending toward failure from rising callout frequency in their job history, ahead of `serviceDueAt`. Predictive, vs E1's reactive Q&A. | `/ask` over asset history + `/predict/chat` | 🟡 | M |

**Governance (minor — fold into existing surfaces, not standalone screens):**
- *Notification digest* — cluster/prioritise the raw `Notification` feed into "3 things that need you today" (extend F4 briefing).
- *Inventory catalogue hygiene* — semantic dedup of near-identical `InventoryItem` rows + category normalisation (`/find` similarity).
- *Audit anomaly watch* — flag unusual `AuditLog` patterns (out-of-hours settings changes, bulk deletes) — extends F3.

---

## Recommended next 6 (value-to-effort, demo-strong, mostly proven)

*B1 is now shipped (F6). Re-ordered to balance high-frequency daily wins, a flagship, and the new write-path.*

1. **H1 Completion-note writer** + **H4 Site access briefing** — tiny effort, fire on every job, make the *daily* experience feel AI-native. (S, ✅)
2. **D1 Smart Job Intake / Triage** — high-frequency daily action, tiny effort. (S, ✅)
3. **C2 Brand-Voice Comms Drafting** / **I3 Dunning ladder** — instant polish on quotes/invoices. (S, ✅)
4. **J1 Supplier order-confirmation → PO** — proves the **write-path** end-to-end via the de-risked Route 2; your anchor example. (M, 🟡 — do the J spike first)
5. **A1 Photo Fault Triage** / **J6 Asset nameplate → Asset** — the multimodal "wow" for demos. (M, 🟡)
6. **I2 Account health & churn risk** — turns the static AccountDetail page into the strongest exec story. (M, ✅)

**Before any Theme J build:** run the 30-min Extract-Strategies spike (Route 1 vs Route 2) and record the result as a new deployment caveat.

## Verification approach (per feature)

- Spike the ARAG capability in isolation first to confirm it works on this deployment.
- Backend route under `/api/ai/*` behind the existing JWT hook; gate generative answers with the existing confidence/sentinel logic in `lib/arag.ts`.
- Verify end-to-end via `app.inject`, then in the browser (preview), then smoke-test on Fly.
- Keep "ARAG is the only AI gateway" — all generation via `/ask` or `/predict/chat`.

---

*Source: this catalogue was derived from the full ARAG documentation set
(`AgenticRAG-API-Doc.MD`, `Retrieval Agent API — Developer Reference.md`,
the full API reference at `agentic-rag-api-documentation.md`, plus the
online docs at `docs.rag.progress.cloud`) and verified against the working
configuration of MaintenanceOS's KB + Retrieval Agent. Themes A–G are
capability-led; **H–J were added from an experience-led walk of every API
route and web screen**, and **K–L from a second exhaustive sweep of all
26 data models + every route module** (May 2026). Theme J is grounded in
the `/predict/compat` vision surface (needs `ARAG_NUA_KEY`). Coverage is
now considered complete against the current ERP surface — further features
would be refinements of these 50 (+3 minor governance), not new territory.*
