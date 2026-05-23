# MaintenanceOS — AI Features Demo Script

A 7–8 minute click-through of the **six AI features**, all powered by
**Progress Agentic RAG (ARAG)**. This is a "what to do" runbook: which
nav item to click, the exact input to type, and the one line to say at
each beat. Every input has been verified in production.

**Demo URL:** https://maintenanceos.fly.dev/
**Login:** `admin@maintenanceos.com.au` / `demo1234`

---

## 0. Before you start (30 sec)

1. Open the demo URL and log in with the credentials above.
2. The sidebar should show **Knowledge Copilot**, **Job Playbooks**, and
   **Ops Assistant** near the top — these are the three AI screens. The
   other AI features (briefing, dispatch, quote draft) appear inline on
   the screens they belong to.
3. Optional sanity check in another tab: `GET /api/ai/status` should
   return `{"kb":true,"agent":true}`.

> Opening line: *"Everything you're about to see — search, playbooks,
> the morning briefing, dispatch suggestions, quote drafting, and a
> natural-language ops assistant — runs through Progress Agentic RAG.
> The app never talks to any other AI."*

---

## 1. Ops Assistant — "Ask your business" (~1 min)

The lead because it's the most magical to watch: a plain-English
question over the live operation.

1. Sidebar → **⚡ Ops Assistant**.
2. Click the chip **"Which technicians have the most open jobs right
   now?"**. Wait ~3–5s.
3. Answer comes back naming **real technicians** with **exact open-job
   counts** (e.g. *James Cooper — 3 open jobs, Noah Lee — 3 open jobs*).
4. Now click **"How many SLA breaches do we have and which accounts are
   affected?"**. Wait ~5s. Walk the answer — it gives a precise count
   and lists the affected account names (Eaglehawk Aged Care, Ballarat
   Property Group, Macedon Ranges Shire, …).
5. **The safety beat:** type into the input
   **"who is the prime minister of australia?"** → click **Ask**.
   The amber banner **"Not in the current ops snapshot"** appears and
   the assistant refuses to answer instead of inventing one.

> Say: *"The numbers are pulled from the live database first, then ARAG
> writes the narrative. It can only answer about the operation — and
> when it can't, it says so honestly. No hallucinated prime ministers."*

---

## 2. Daily Operations Briefing — the manager's morning read (~1 min)

1. Sidebar → **▣ Dashboard**.
2. Top card **"AI Daily Briefing"** → click **Generate briefing**. Wait
   ~5s.
3. Read the top two bullets aloud — they cite real **WO-** numbers,
   real account names, and a recommended action each (urgent SLA
   breaches first, then overdue invoices, then margin risk).

> Say: *"The figures are computed from the database; ARAG only writes
> the narrative. The numbers and work-order references are always
> exact, never invented."*

---

## 3. Knowledge Copilot — grounded Q&A with citations (~1 min)

The field technician's go-to: ask about safety, procedures, or past
jobs and get a cited answer.

1. Sidebar → **✶ Knowledge Copilot**.
2. In the input, paste:
   **"What electrical isolation procedure should a technician follow
   before working on a switchboard?"**
3. Click **Ask**. Wait ~3–5s.
4. Read the four-step lock-out / test-before-touch procedure that comes
   back.
5. Scroll down to **Sources** — point at the chip
   **"Working at Heights Safety Policy"** (and the WO citations).

> Say: *"The answer is grounded in our own safety documentation — and
> it cites the source. Nothing is invented; if it isn't in the
> knowledge base, the copilot says so."*

---

## 4. Job Playbooks — turn knowledge into a reusable artifact (~1 min)

1. Sidebar → **✷ Job Playbooks**.
2. Click the example chip **"Replace a leaking kitchen mixer tap"** (or
   type it). Leave job type as **Any**.
3. Click **Generate**. Wait ~5s.
4. Walk the card: **Title**, **Estimated hours**, **Required skills**,
   **Materials**, the numbered **Steps**, and **Safety controls**.
5. Point at the **Save as template** button — *"this can become a
   reusable template in the knowledge base"* — and **Create job from
   playbook** — *"or it can become a real work order in one click."*

> Say: *"It anchored the procedure on real past jobs and pulled the
> safety controls from policy — a standardised playbook in seconds.
> The dispatcher can save it for reuse, or turn it straight into a
> scheduled job."*

---

## 5. Dispatcher Next-Best-Action — ranked operational decisions (~1 min)

1. Sidebar → **⇄ Dispatch Board**.
2. Top card **"AI Next-Best-Actions"** → click **Suggest actions**.
   Wait ~8s.
3. Point at a green **ASSIGN** row — e.g. *"WO-2026-0027 → Ethan Foster
   — has the required skill and is in the right territory."*
4. Point at a red **ESCALATE** row — *"no technician holds every
   required skill, so it escalates rather than guessing."*

> Say: *"It only recommends a technician who holds every required
> skill — when nobody qualifies, it escalates instead of bluffing.
> These are proposals; the dispatcher still has to click to apply."*

---

## 6. Site-Adaptive Quote Drafting (~1 min)

1. Sidebar → **✦ Work Orders**.
2. Click any work order row.
3. Top-right → **✶ Draft with AI**. Wait ~5s.
4. In the modal, walk through:
   - **Labour** (hours × hourly rate)
   - **Materials** (cost)
   - **Margin %** (kept above the floor)
   - **Reasoning** (why those numbers)
   - **Anchored on** — the comparable historical jobs it used.
5. Point at the buttons: **Create quote** turns the draft into a real
   quote; **Regenerate** retries; **Cancel** discards.

> Say: *"It drafts from comparable historical jobs and keeps the margin
> above our floor. The maths is always done by the system, not the
> model — and a human reviews before anything is created."*

---

## Close (15 sec)

> *"Six features, one AI layer. The knowledge base grounds and cites;
> the live ERP gives exact numbers; Progress Agentic RAG turns both
> into something a technician, dispatcher, or manager can act on —
> with sources, with refusals when it doesn't know, and a human in
> the loop on anything that writes data."*

---

## Quick reference — the verified inputs

| Feature | Where | Input that works |
|---|---|---|
| Ops Assistant — happy path | `/ops-assistant` | "Which technicians have the most open jobs right now?" |
| Ops Assistant — second | `/ops-assistant` | "How many SLA breaches do we have and which accounts are affected?" |
| Ops Assistant — refusal | `/ops-assistant` | "who is the prime minister of australia?" |
| Daily Briefing | `/` | Click *Generate briefing* |
| Knowledge Copilot | `/copilot` | "What electrical isolation procedure should a technician follow before working on a switchboard?" |
| Job Playbooks — works | `/playbooks` | "Replace a leaking kitchen mixer tap" |
| Job Playbooks — also works | `/playbooks` | "Clean gutters and downpipes on a single-storey roof" |
| Job Playbooks — refusal | `/playbooks` | "Sing at a kids' birthday party" |
| Dispatch Suggest | `/dispatch` | Click *Suggest actions* |
| Quote Draft | `/work-orders/:id` | Click *Draft with AI* on any NEW work order |

## If something looks empty
- **F1/F2 say "not configured"** → API can't see ARAG creds. Confirm
  `ARAG_*` env vars are set (locally in `apps/api/.env`, on Fly via
  `fly secrets list -a maintenanceos`).
- **F4/F5/F3 error** → same env check; these also need the DB seeded
  (`npm run db:seed` from `apps/api/`).
- **Agent-specific check:** `GET /api/ai/status` should return
  `{"kb":true,"agent":true}`. If `kb:false`, the demo can't run.

## Why each refusal happens (in case anyone asks)
- **Ops Assistant — "PM of Australia"** → ARAG's `/predict/chat` returns
  a "not in the snapshot" sentinel because the question isn't grounded
  in the ops snapshot we passed it.
- **Playbooks — "Sing at a kids' birthday party"** → low retrieval
  confidence (no comparable jobs in the KB), so the route returns
  `lowConfidence: true` and the UI shows a friendly refusal instead of
  fabricating a playbook.
- **Quote Draft — work order with no comparables** → fewer than two
  comparable completed jobs found, so the modal shows
  *"please quote this one manually"* rather than guessing a price.
