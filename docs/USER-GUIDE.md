# MaintenanceOS User Guide

MaintenanceOS is an API-first ERP / CMMS for a property-maintenance business.
It runs the full job lifecycle — from a customer request, through scheduling and
dispatch, to quoting, completion, invoicing and reporting — and layers AI
assistance (powered by Progress Agentic RAG) across every screen.

This guide explains what each part of the app does and how to perform the common
tasks. Use the Help assistant (the chat button in the bottom-right corner) to ask
questions about anything in here in plain English.

## Getting started and navigation

When you sign in you land on the **Dashboard**. The left-hand sidebar is the main
menu; the screen title and your account (name, role, Sign out) sit in the top bar,
along with the **Notifications** bell and a link to the **API Docs**.

The sidebar groups the app into operational screens (Work Orders, Dispatch Board,
Quotes, Invoices, Accounts, Sites, Employees, Inventory, Suppliers, Purchase
Orders, Fleet & Assets, Recurring, Reports, Settings) and AI screens (Knowledge
Copilot, Job Playbooks, Ops Assistant, AI Insights). The **Audit Log** is visible
only to Admin and Manager roles.

Most list screens share the same pattern: a filter or search at the top, a table
or list of records, and an action button (top-right) to create a new record.
Click a row or its reference number to open the detail view. Drafts and AI
suggestions are never sent or committed automatically — you always review first.

## Dashboard

The Dashboard is your daily starting point. At the top, the **AI Daily Briefing**
turns today's live numbers into a short plain-English summary — click **Generate
briefing** to produce it. Below the headline, click-through panels surface what
needs attention: jobs approaching or breaching SLA, overdue invoices, recently
completed jobs with thin margins, and inventory running low. Click any row to open
that record. The mini-KPIs show open jobs, unassigned jobs, jobs due today, and
SLA breaches.

## Accounts

Accounts are your customers (real-estate agencies, councils, schools, aged-care,
body corporates, commercial clients, homeowners). Open **Accounts** to see the
list; click an account to view its sites, work orders, quotes and invoices.

The account detail page also has AI assists: **Assess** gives an account-health
and churn/payment-risk read from recent activity, margin trend and overdue
invoices; **Suggest** proposes proactive maintenance worth offering the customer
now; **Propose** drafts a recurring maintenance plan from their repeat work.

To add an account, use the create action on the Accounts screen and fill in the
name, type, contact, billing details and payment terms.

## Sites

Sites are the physical locations where work happens; each site belongs to an
account. Use **Sites** to manage addresses, access notes and site contacts. Work
orders are raised against a site, and the site's access details feed the AI
"Site access briefing" on a work order.

## Work Orders

Work Orders are the core unit of work — one job at one site. The **Work Orders**
screen lists jobs with their status, priority, job type, assigned technician and
SLA. Statuses flow roughly: NEW/OPEN → SCHEDULED → IN_PROGRESS → COMPLETED →
INVOICED. Write actions are locked once a job reaches a terminal status.

To create a work order, use the create action and set the account, site, title,
description, job type (REPAIR, MAINTENANCE, INSPECTION, EMERGENCY,
RECURRING_SERVICE) and priority. You can also create a job from a Job Playbook,
which pre-fills the title, steps, safety notes and estimated hours.

Open a work order to assign a technician, schedule it, log time entries, record
materials used, and add completion notes. The detail page carries a full set of AI
assists (see "AI: Work order assists"), a per-account **Copilot** tab, and a
**Draft with AI** button to draft a quote from comparable jobs.

## Dispatch Board

The Dispatch Board is for assigning and sequencing the unassigned queue. The **AI
Next-Best-Actions** panel ranks open jobs into concrete actions — ASSIGN (to a
skill- and territory-matched technician), ESCALATE, or RESCHEDULE — each with a
reason. Click **Suggest actions** to generate them, then click **Assign {name}**
to apply an assignment in one click.

The **Technician day-plan** card narrates a chosen technician's day for a date and
flags scheduling clashes and wasteful travel: pick a technician and date and click
**Plan day**.

## Quotes

Quotes price a job before it's done. The **Quotes** screen lists quotes by status
(DRAFT, SENT, APPROVED, REJECTED, EXPIRED). Open a quote to see its labour,
materials, subcontractor, equipment, travel and disposal costs, margin and totals,
and to approve or reject it.

The fastest way to create a quote is from a work order: click **✶ Draft with AI**,
which anchors labour and materials on comparable completed jobs and shows its
reasoning; review and click **Create quote**. On the quote detail page, **Check**
flags under/over-pricing versus comparable margins, and **Draft** writes a
brand-voice cover note to send with the quote.

## Invoices (customer / accounts receivable)

The **Invoices** screen has two tabs. The **Customer invoices** tab is your
accounts-receivable ledger — invoices you issue to customers. Each row shows the
account, the originating work order, subtotal, total, issued and due dates, and
status (DRAFT, SENT, PAID, OVERDUE, VOID). Overdue invoices are flagged in red.

To raise an invoice, click **+ Raise invoice** and choose a source:
- **From a completed job** — pick a completed work order; the invoice is generated
  from the job's approved (or latest) quote, GST included, and the job is marked
  invoiced. If the job has no quote, the invoice is costed from its actual labour
  and materials.
- **Manual** — pick an account, enter a subtotal (ex GST) and due-in-days; GST is
  added automatically and a DRAFT invoice is created.

Change an invoice's status from the row's status dropdown. For an overdue invoice,
click **✶ Remind** to draft an AI payment reminder (a "dunning" note) whose tone
escalates with how overdue it is — review before sending. Click an invoice number
to download its PDF.

## Supplier bills (accounts payable)

The **Supplier bills (AP)** tab on the Invoices screen tracks bills you have
*received* from suppliers — the money you owe, as opposed to customer invoices
(money owed to you). Each bill shows the supplier, the supplier's own invoice
reference, a linked purchase order (if matched), issued and due dates, total and
status (DRAFT, APPROVED, PAID, DISPUTED, VOID). Overdue bills are flagged.

To enter a bill manually, click **+ New bill**, choose the supplier, enter the
supplier invoice number and dates, optionally link a purchase order, add line
items (description, qty, unit cost — a line can be a catalogue item or a
service/freight charge), set tax, and click **Create bill**. The faster way is to
import it from a document (see the next section).

## Importing a supplier invoice with AI

On the **Supplier bills (AP)** tab, click **✶ Import bill from document** and
choose a supplier invoice (PDF, PNG, JPG). The AI reads the document — you'll see a
live preview and progress while it uploads, reads, extracts and matches — then
opens a review form pre-filled with:
- the **supplier** (matched to your supplier list, tolerant of legal-entity names
  like "Reece Pty Ltd" vs the trading name "Reece Plumbing"),
- the **supplier invoice number** and **issue/due dates**,
- a **linked purchase order** (3-way match) when the document references one of
  your PO numbers, and
- **line items** matched to your inventory catalogue (a green "✓ matched" badge by
  each matched line; unmatched lines are editable).

Review every line, adjust the linked PO or any field if needed, then click
**Create bill**. A digital PDF (with a real text layer) reads most reliably;
photos or screenshots can lose the line-item table.

## Inventory

The **Inventory** screen manages stock items (SKU, name, category, unit, unit
cost, sell price, reorder point) across locations (warehouses, vans, trailers).
Stock movements record receipts, transfers, consumption on jobs, adjustments and
returns. Low-stock items surface on the Dashboard and feed the AI demand-aware
reorder suggestions.

## Suppliers

The **Suppliers** screen holds the vendors you buy from (contact, email, phone,
address, payment terms). Suppliers are referenced by purchase orders and supplier
bills, and the AI document importer matches an uploaded invoice's vendor to this
list.

## Purchase Orders

Purchase Orders are what you *order from a supplier* (as opposed to a supplier bill,
which is what they invoice you). On **Purchase Orders**, click **+ New Purchase
Order**, choose the supplier and expected date, add line items from your inventory
catalogue (item, qty, unit cost), and create it. Set a "Receive into" location and
click **Receive Stock** on a PO to book the goods into inventory; the PO status
moves to PART_RECEIVED or RECEIVED. A received PO can later be matched to the
supplier's bill for a 3-way match.

## Employees and skills

The **Employees** screen manages your workforce — technicians, dispatchers,
supervisors — with their roles, skills/licences and hourly cost. Skills drive the
dispatcher's skill-matching and the safety pre-flight check on a work order
(confirming the assigned technician holds the required licences). Skill-coverage
gaps across open jobs are surfaced in AI Insights as a hiring signal.

## Fleet and assets

**Fleet & Assets** tracks vehicles and equipment, including service and
registration due dates. The AI **Fleet compliance** check (in AI Insights) lists
vehicles with service or registration due soon so nothing lapses.

## Recurring work

**Recurring** manages repeating service plans (e.g. quarterly maintenance) that
generate work orders on a cadence. Use it to define a plan against an account/site
and run it to create the next batch of jobs. The AI **Recurring-run preview** (in
AI Insights) narrates what the next run would create and flags opportunities to
batch jobs at the same site.

## Reports

The **Reports** screen provides operational and financial reporting — revenue,
margin and margin leakage, SLA breaches, technician utilisation, low stock and work
order summaries. Several of these also have AI narrative versions in AI Insights.

## Audit Log

The **Audit Log** (Admin/Manager only) is an immutable record of significant
actions — who changed what and when (invoices raised, statuses changed, settings
updated, records deleted). The AI **Audit assistant** in AI Insights lets you query
it in plain English (e.g. "who changed settings recently?").

## Settings

**Settings** holds company details (name, ABN, contact, address), finance defaults
(GST rate, margin-risk threshold, default payment terms), and AI configuration
(the confidence threshold below which AI answers are suppressed in favour of a
"not enough data" message). Only Admin/Manager roles can change settings.

## AI: Knowledge Copilot

The **Knowledge Copilot** is grounded, cited search over your *unstructured*
documents — safety, policy and compliance material in the knowledge base. Type a
question (or tap a suggestion) and it returns an answer with the source documents
it used. It does not answer from live ERP records — for live operational questions
use the Ops Assistant. Every AI answer is grounded; when there isn't enough
supporting material it says so rather than guessing.

## AI: Job Playbooks

**Job Playbooks** generate a reusable, structured plan for a type of job —
estimated hours, required skills, typical materials, ordered steps and safety
controls — grounded in comparable past jobs and your safety docs. Describe the job
(optionally pick a job type) and click **Generate**. Then **Save as template** to
reuse it, or **Create job from playbook** to pre-fill a new work order.

## AI: Ops Assistant

The **Ops Assistant** answers natural-language questions about your *live* business
— open jobs, technician workload, SLA breaches, overdue invoices, schedule, low
stock — by querying the live system in real time. Ask something like "Which
technician has the most open jobs right now?" and watch the activity log stream as
it plans, queries the live data and writes the answer. It runs off the
MaintenanceOS MCP endpoint, the same tool surface any external AI agent can use.

## AI: Insights

**AI Insights** is a board of on-demand analyses over your whole operation. Each
card runs when you click its button: Executive summary, SLA early-warning, Margin
insight, Lost-quote analysis, Demand-aware reorder, Skill-coverage gaps, Fleet
compliance, and Recurring-run preview. The page also has two interactive tools:
**Smart job intake (triage)** — paste a customer request and it classifies job
type, priority, SLA and required skills — and the **Audit assistant** for
natural-language audit-log questions.

## AI: Work order assists

Open a work order to find its AI assists, grouped by stage:
- **Duplicate / callback check** — flags likely repeat or warranty-callback jobs at
  the same site, so you don't bill the same fix twice.
- **Safety pre-flight** — surfaces the relevant safety controls and confirms the
  assigned technician holds the required skills/licences, with citations.
- **Site access briefing** — a "before you arrive" card (contact, access, pets,
  hours) from the site record.
- **Parts kit** — predicts the parts likely needed, grounded in actual usage on
  comparable jobs.
- **Completion note** — drafts the close-out note from time entries, parts and
  status.
- **Job timeline** — a short plain-English history of the job for handover or
  dispute.
- **Customer update** — drafts a friendly status message for the customer.
- **Time check** — flags when logged hours are unusually high versus comparable
  jobs, before you invoice.
- **Variation claim** — drafts a scope-creep/additional-works claim when actuals
  exceed the quote.

## AI: Quote, account and invoice assists

Beyond the work order, AI assists appear where they're useful: on a **quote**,
pricing-risk check and a cover-note draft; on an **account**, health/churn
assessment, proactive-maintenance suggestions and a recurring-plan proposal; on an
overdue **invoice**, an escalating payment-reminder (dunning) draft. All
customer-facing outputs are drafts for you to review and send.

## Roles and permissions

Roles are ADMIN, MANAGER, SUPERVISOR, DISPATCHER and TECHNICIAN. Admin and Manager
can see the Audit Log and change Settings, and only they can delete records.
Everyone can use the operational screens and AI assistants appropriate to their
work. Your role is shown in the top-right next to your name.

## API and MCP access

MaintenanceOS is API-first: every screen is backed by a documented REST API
(open **API Docs** from the top bar). It also exposes a hosted **MCP** endpoint, so
external AI agents (including the built-in Ops Assistant) can query and act on your
live data through the same tools, carrying the same permissions as the REST API.

## Tips and troubleshooting

- AI answers are grounded in your real data and documents; if there isn't enough to
  answer confidently, the assistant says so instead of guessing.
- Customer-facing AI outputs (quotes, reminders, status updates) are always drafts —
  review before sending.
- For document import, a digital PDF reads far more reliably than a photo or
  screenshot, which can lose the line-item table.
- Can't change a work order? It may be in a terminal status (COMPLETED/INVOICED),
  which locks write actions.
- Don't see the Audit Log or Settings changes? Those require an Admin or Manager
  role.
