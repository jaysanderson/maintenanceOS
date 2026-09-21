/**
 * AI routes — thin proxies onto Progress Agentic RAG (the only AI gateway).
 *
 * F1 Knowledge Copilot: grounded, cited Q&A over the ingested ERP corpus +
 * policy/safety docs. The browser never talks to ARAG directly — it calls
 * these routes (which already sit behind the /api JWT auth hook), and the
 * server holds the ARAG service key.
 */
import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { ApiError } from "../lib/errors.js";
import {
  isConfigured,
  agentConfigured,
  agent,
  ask,
  find,
  agentAsk,
  isLowConfidenceAnswer,
  LOW_CONFIDENCE_MESSAGE,
  type ErpDoc,
} from "../lib/arag.js";
import { generateBriefing, dispatchActions, draftQuote, savePlaybook, opsAssistant, extractPurchaseOrderDraft, flagSimilarWorkOrders, suggestPartsKit, technicianDayPlan, draftCompletionNote, workOrderTimeline, siteAccessBriefing, timeEntryAnomaly, analyzeLostQuotes, accountHealth, draftDunning, fleetComplianceDigest, recurringRunPreview, demandAwareReorder, skillGapSignal, proactiveMaintenance, variationClaim, customerStatusUpdate, slaEarlyWarning, quoteRiskCheck, draftQuoteComms, marginInsight, triageRequest, safetyPreflight, recurringSuggester, execSummary, auditAssistant, financeExceptions, faultRootCause, riskWatchlist, costExceptions, commitDate, assetServiceCoPilot, complianceReadiness, availableLots, lotTrace } from "../lib/aiFeatures.js";
import { getAiConfidenceThreshold } from "../lib/config.js";
import { AragError } from "@maintenanceos/arag-client";

const classification = z.object({ labelset: z.string(), label: z.string() });

const askBody = z.object({
  query: z.string().min(1).max(2000),
  /** Optional label filters, e.g. [{labelset:"doctype",label:"work-order"}]. */
  filters: z.array(classification).max(10).optional(),
});

const findBody = z.object({
  query: z.string().min(1).max(2000),
  filters: z.array(classification).max(10).optional(),
  limit: z.number().int().min(1).max(50).optional(),
});

const agentBody = z.object({
  question: z.string().min(1).max(2000),
  /** Optional structured params forwarded into the agent workflow. */
  args: z.record(z.string(), z.unknown()).optional(),
});

const JOB_TYPES = [
  "REPAIR",
  "MAINTENANCE",
  "INSPECTION",
  "EMERGENCY",
  "RECURRING_SERVICE",
] as const;

const playbookBody = z.object({
  /** Free-text job, e.g. "kitchen mixer tap replacement". */
  jobDescription: z.string().min(3).max(300),
  /** Optional: scope retrieval to a job type label. */
  jobType: z.enum(JOB_TYPES).optional(),
});

/** Pull the first JSON object out of an LLM answer (handles ```json fences). */
function extractJson(text: string): unknown | null {
  const cleaned = text.replace(/```json/gi, "").replace(/```/g, "");
  const start = cleaned.indexOf("{");
  const end = cleaned.lastIndexOf("}");
  if (start === -1 || end === -1 || end <= start) return null;
  try {
    return JSON.parse(cleaned.slice(start, end + 1));
  } catch {
    return null;
  }
}

function requireKb(): void {
  if (!isConfigured()) {
    throw new ApiError(503, "AI is not configured (set ARAG_* in the environment)");
  }
}

/** Map an AragError to our ApiError envelope so the UI degrades cleanly. */
function wrap<T>(p: Promise<T>): Promise<T> {
  return p.catch((e) => {
    if (e instanceof AragError) {
      const code = e.status && e.status >= 400 && e.status < 600 ? e.status : 502;
      throw new ApiError(code === 401 || code === 403 ? 502 : code, `AI gateway error: ${e.message}`);
    }
    throw e;
  });
}

// ── Live-agent progress narration ─────────────────────────────────────────
// The RAO stream is far richer than a generic spinner: each step carries the
// actual plan and the real MCP tool calls (tool name + arguments). We turn
// those into specific, non-repetitive lines ("Reading invoices · status =
// overdue") so the user watches the agent genuinely work, not a fake spinner.
type StepEvent = { kind: "plan" | "tool" | "think" | "write"; message: string; tool?: string };

/** "{'query': {'status': 'overdue'}}" → "status = overdue" (best-effort). */
function summariseToolArgs(raw: string): string {
  try {
    const o = JSON.parse(raw.trim().replace(/'/g, '"').replace(/\bNone\b/g, "null").replace(/\bTrue\b/g, "true").replace(/\bFalse\b/g, "false"));
    const q = (o && typeof o === "object" && "query" in o ? (o as Record<string, unknown>).query : o) as Record<string, unknown> | undefined;
    if (!q || typeof q !== "object") return "";
    return Object.entries(q)
      .filter(([, v]) => v !== null && v !== undefined && v !== "")
      .slice(0, 3)
      .map(([k, v]) => `${k.replace(/_/g, " ")} = ${typeof v === "object" ? JSON.stringify(v) : String(v)}`)
      .join(", ");
  } catch {
    return "";
  }
}

/** "work_orders_list_work_orders" → "work orders" (underscore-separated). */
function humaniseResource(tool: string): string {
  const r = tool.replace(/_(list|get|search|create|update|find|count|by)(_.*)?$/i, "").replace(/_/g, " ").trim();
  return r || tool.replace(/_/g, " ");
}

function planSummary(value: string): string {
  const m = value.match(/Plan:\s*\d+\s*step\(s\):\s*([^\n]+)/i);
  const text = (m ? m[1] : value.split("\n")[0] ?? "").trim().replace(/\s+/g, " ");
  // Final planner iterations often have nothing left to plan.
  if (!text || /no steps/i.test(text) || /^plan:?\s*$/i.test(text)) return "";
  return text.length > 110 ? text.slice(0, 107) + "…" : text;
}

/** Humanise one RAO step into a specific progress line, or null to skip noise. */
function describeAgentStep(step: { module?: string; title?: string; value?: unknown }): StepEvent | null {
  const title = step.title ?? "";
  const value = typeof step.value === "string" ? step.value : "";
  if (step.module === "mcp" || /^MCP:/.test(title)) {
    const m = value.match(/Used tool:\s*(\S+)\s+with arguments:\s*([\s\S]*)$/i);
    if (m) {
      const tool = m[1];
      const verb = /(^|_)(list|search|get|find|read|count)/i.test(tool)
        ? "Reading"
        : /(^|_)create/i.test(tool)
          ? "Drafting"
          : /(^|_)(update|set|patch|delete)/i.test(tool)
            ? "Updating"
            : "Querying";
      const filter = summariseToolArgs(m[2]);
      return { kind: "tool", tool, message: `${verb} ${humaniseResource(tool)}${filter ? ` · ${filter}` : ""}` };
    }
    return null; // unparseable tool step — skip rather than show a generic line
  }
  if (/Planner/i.test(title)) {
    const p = value ? planSummary(value) : "";
    return { kind: "plan", message: p ? `Planning · ${p}` : "Refining the plan" };
  }
  if (/Plan-execute mode completed/i.test(title)) return { kind: "think", message: "Connecting the evidence" };
  if (/Context validation/i.test(title)) return { kind: "think", message: "Double-checking the data" };
  if (/Summarize/i.test(title)) return { kind: "write", message: "Writing the grounded answer" };
  // Executor-turn / history-check steps are scaffolding — the tool calls above
  // are the real story, so we don't emit a line for them.
  return null;
}

export async function aiRoutes(app: FastifyInstance) {
  // Lets the UI show/hide AI features without leaking keys.
  app.get(
    "/status",
    { schema: { tags: ["AI"], summary: "AI availability (KB + agent configured?)" } },
    async () => ({ kb: isConfigured(), agent: agentConfigured() })
  );

  // F1 — grounded, cited answer.
  app.post(
    "/ask",
    {
      schema: {
        tags: ["AI"],
        summary: "Ask the Knowledge Copilot (grounded, cited answer)",
        body: askBody,
      },
    },
    async (req) => {
      requireKb();
      const { query, filters } = req.body as z.infer<typeof askBody>;
      const threshold = await getAiConfidenceThreshold();
      const res = await wrap(ask({ query, filters }));
      // Low confidence = ARAG's "not enough data" sentinel (primary) or a
      // retrieval score below the configurable threshold (secondary).
      const lowConfidence =
        isLowConfidenceAnswer(res.answer) || res.confidence < threshold;
      if (lowConfidence) {
        return {
          answer: LOW_CONFIDENCE_MESSAGE,
          citations: [],
          confidence: res.confidence,
          lowConfidence: true,
        };
      }
      return {
        answer: res.answer,
        citations: res.citations,
        confidence: res.confidence,
        lowConfidence: false,
      };
    }
  );

  // Raw retrieval hits (no generation) — useful for "related records" panels.
  app.post(
    "/find",
    {
      schema: {
        tags: ["AI"],
        summary: "Semantic + keyword search over the knowledge base",
        body: findBody,
      },
    },
    async (req) => {
      requireKb();
      const { query, filters, limit } = req.body as z.infer<typeof findBody>;
      const res = await wrap(find({ query, filters, limit }));
      return { hits: res.hits };
    }
  );

  // Multi-source Retrieval Agent (KB + live MaintenanceOS MCP). Forwards the
  // caller's JWT to the agent's drivers so RBAC is inherited.
  app.post(
    "/agent",
    {
      schema: {
        tags: ["AI"],
        summary: "Ask the Retrieval Agent (multi-source: KB + live ERP)",
        body: agentBody,
      },
    },
    async (req) => {
      if (!agentConfigured()) {
        throw new ApiError(503, "Retrieval Agent is not configured (set ARAG_AGENT_* )");
      }
      const { question, args } = req.body as z.infer<typeof agentBody>;
      const authz = req.headers["authorization"];
      const forwardJwt =
        typeof authz === "string" && authz.toLowerCase().startsWith("bearer ")
          ? authz.slice(7).trim()
          : undefined;
      const r = await wrap(agentAsk(question, { forwardJwt, args }));
      if (r.error && !r.answer) {
        throw new ApiError(502, `Agent error: ${r.error}`);
      }
      return { answer: r.answer, ...(r.error ? { warning: r.error } : {}) };
    }
  );

  // F2 — Job Playbooks: a reusable, structured playbook for a job type,
  // grounded in comparable historical work orders + safety/policy docs.
  app.post(
    "/playbook",
    {
      schema: {
        tags: ["AI"],
        summary: "Generate a structured Job Playbook (grounded in history + safety docs)",
        body: playbookBody,
      },
    },
    async (req) => {
      requireKb();
      const { jobDescription, jobType } = req.body as z.infer<typeof playbookBody>;
      const filters = jobType ? [{ labelset: "jobType", label: jobType }] : undefined;
      const threshold = await getAiConfidenceThreshold();
      // Probe with a grounded QUESTION first: if ARAG can't ground the job
      // (sentinel) or the score is below threshold, don't fabricate a
      // structured playbook (e.g. "sing at a kids party" at a maintenance co).
      // NB: phrase it as a question — a bare job description as the query makes
      // ARAG emit a non-answer that falsely trips the low-confidence detector.
      const probe = await wrap(
        ask({
          query: `What does the job "${jobDescription}" typically involve — the steps, materials and safety controls — based on comparable jobs and the safety/policy documents?`,
          filters,
        })
      );
      if (isLowConfidenceAnswer(probe.answer) || probe.confidence < threshold) {
        return {
          jobDescription,
          jobType: jobType ?? null,
          playbook: null,
          lowConfidence: true,
          confidence: probe.confidence,
          message:
            "Not enough comparable jobs or safety documentation to build a reliable playbook for this. " +
            "Try a job closer to the work this business does.",
          citations: [],
        };
      }
      const query = [
        `Create a standard job playbook for: "${jobDescription}".`,
        `Base it on comparable past MaintenanceOS work orders and the relevant safety/policy documents.`,
        `Return ONLY a JSON object with these keys:`,
        `{"title": string, "requiredSkills": string[], "typicalMaterials": string[], "estimatedHours": number, "steps": string[], "safetyControls": string[]}.`,
      ].join(" ");
      const res = await wrap(ask({ query, filters }));
      const playbook = extractJson(res.answer);
      return {
        jobDescription,
        jobType: jobType ?? null,
        playbook: playbook ?? null,
        lowConfidence: false,
        confidence: probe.confidence,
        // Always include the raw answer so the UI degrades gracefully if the
        // model didn't return clean JSON.
        raw: playbook ? undefined : res.answer,
        citations: res.citations,
      };
    }
  );

  // F2b — Save a generated playbook as a reusable template (into the KB).
  app.post(
    "/playbook/save",
    {
      schema: {
        tags: ["AI"],
        summary: "Save a generated playbook as a reusable template",
        body: z.object({
          jobDescription: z.string().min(3).max(300),
          playbook: z.record(z.string(), z.unknown()),
        }),
      },
    },
    async (req) => {
      requireKb();
      const { jobDescription, playbook } = req.body as {
        jobDescription: string;
        playbook: Record<string, unknown>;
      };
      const r = await wrap(savePlaybook(jobDescription, playbook));
      return { saved: true, slug: r.slug };
    }
  );

  // F4 — Daily Operations Briefing (hybrid: live KPIs → ARAG narration).
  app.get(
    "/briefing",
    { schema: { tags: ["AI"], summary: "Generate today's operations briefing" } },
    async () => {
      requireKb();
      const r = await wrap(generateBriefing());
      return { briefing: r.briefing, data: r.data };
    }
  );

  // F5 — Dispatcher Next-Best-Action (hybrid: open jobs + techs → ranked actions).
  app.post(
    "/dispatch-actions",
    {
      schema: {
        tags: ["AI"],
        summary: "Rank next-best dispatch actions for the unassigned queue",
        body: z.object({ territory: z.string().max(80).optional() }),
      },
    },
    async (req) => {
      requireKb();
      const { territory } = req.body as { territory?: string };
      const r = await wrap(dispatchActions(territory));
      return { actions: r.actions, raw: r.raw, context: r.context };
    }
  );

  // F3 — Site-Adaptive Quote Drafting (hybrid: WO + comparable costing → draft).
  app.post(
    "/draft-quote",
    {
      schema: {
        tags: ["AI"],
        summary: "Draft a quote for a work order, grounded in comparable jobs",
        body: z.object({ workOrderId: z.string().min(1) }),
      },
    },
    async (req) => {
      requireKb();
      const { workOrderId } = req.body as { workOrderId: string };
      const r = await wrap(draftQuote(workOrderId));
      if (!r) throw new ApiError(404, "Work order not found");
      // Only draft when grounded in enough comparable completed jobs.
      if (!r.draft || r.comparables.length < 2) {
        return {
          draft: null,
          comparables: r.comparables,
          lowConfidence: true,
          message:
            "Not enough comparable completed jobs to draft a confident quote - " +
            "please quote this one manually.",
        };
      }
      return { ...r, lowConfidence: false };
    }
  );

  // #5 — Ops Assistant: NL questions over the live ERP state (hybrid:
  // Prisma snapshot + ARAG /predict/chat narration).
  app.post(
    "/ops-assistant",
    {
      schema: {
        tags: ["AI"],
        summary: "Ask the operations question via the Retrieval Agent (streamed, live ERP via MCP)",
        body: z.object({ question: z.string().min(3).max(500) }),
      },
    },
    async (req, reply) => {
      requireKb();
      if (!agentConfigured()) {
        throw new ApiError(503, "Retrieval Agent is not configured (set ARAG_AGENT_*)");
      }
      const { question } = req.body as { question: string };

      // Stream the agent's progress to the browser as Server-Sent Events so
      // the user sees what's happening (the smart agent can take a while).
      // The `mos` workflow answers from the live ERP via the MaintenanceOS
      // MCP tools (the `default` workflow is "Do NOT use").
      reply.hijack();
      const raw = reply.raw;
      raw.writeHead(200, {
        "content-type": "text/event-stream",
        "cache-control": "no-cache, no-transform",
        connection: "keep-alive",
        "x-accel-buffering": "no",
      });
      const send = (o: unknown) => raw.write(`data: ${JSON.stringify(o)}\n\n`);
      const ping = setInterval(() => raw.write(": ping\n\n"), 15000);

      try {
        send({ type: "progress", kind: "plan", message: "Connecting to the live operation…" });
        const res = await agent().interactStream(question, {
          workflowId: "mos",
          args: { question },
        });
        const body = res.body as ReadableStream<Uint8Array> | null;
        if (!body) throw new Error("No stream returned by the agent");
        const reader = body.getReader();
        const decoder = new TextDecoder();
        let buf = "";
        let answer = "";
        let lastMsg = "";
        for (;;) {
          const { done, value } = await reader.read();
          if (done) break;
          buf += decoder.decode(value, { stream: true });
          const lines = buf.split("\n");
          buf = lines.pop() ?? "";
          for (const line of lines) {
            const t = line.trim().replace(/^data:\s*/, "");
            if (!t.startsWith("{")) continue;
            let d: Record<string, unknown>;
            try {
              d = JSON.parse(t);
            } catch {
              continue;
            }
            const step = d.step as { module?: string; title?: string; value?: unknown } | undefined;
            if (step?.title) {
              const ev = describeAgentStep(step);
              if (ev && ev.message !== lastMsg) {
                lastMsg = ev.message;
                send({ type: "progress", kind: ev.kind, message: ev.message, ...(ev.tool ? { tool: ev.tool } : {}) });
              }
            }
            // Token-by-token answer streaming (typewriter finish), when present.
            const chunk = d.streaming_response_chunk;
            if (typeof chunk === "string" && chunk) {
              send({ type: "answer-chunk", text: chunk });
            }
            const a = d.answer;
            if (typeof a === "string" && a && a !== "Error in generation" && a !== "Error in context") {
              answer = a;
            }
            if (typeof d.generated_text === "string" && d.generated_text) {
              answer = d.generated_text;
            }
          }
        }
        const low = !answer.trim() || isLowConfidenceAnswer(answer);
        send({
          type: "answer",
          text: low ? LOW_CONFIDENCE_MESSAGE : answer,
          lowConfidence: low,
        });
      } catch (e) {
        send({ type: "error", message: (e as Error).message });
      } finally {
        clearInterval(ping);
        raw.end();
      }
    }
  );

  // J1 — Document Intelligence (write-path): extract a draft Purchase Order
  // from an uploaded supplier doc via ARAG's vision model. Multipart upload;
  // returns a DRAFT only — the reviewed draft is created via the existing
  // POST /api/purchase-orders endpoint. Needs a NUA key (ARAG_NUA_KEY).
  app.post(
    "/extract-document",
    {
      schema: {
        tags: ["AI"],
        summary: "Extract a draft purchase order from an uploaded supplier document",
        consumes: ["multipart/form-data"],
      },
    },
    async (req, reply) => {
      requireKb();
      // Uses ARAG document ingestion (KB key) to extract text, then the text
      // generation gateway to structure it. Streams progress as SSE because
      // OCR + structuring can take 20-40s — the user sees each stage.
      const file = await req.file();
      if (!file) {
        return reply.status(400).send({ error: "No file uploaded" });
      }
      const allowed = ["image/png", "image/jpeg", "image/webp", "image/gif", "application/pdf"];
      if (!allowed.includes(file.mimetype)) {
        return reply
          .status(415)
          .send({ error: `Unsupported file type ${file.mimetype}. Upload a PNG/JPG/PDF.` });
      }
      const buffer = await file.toBuffer();
      const mimetype = file.mimetype;

      reply.hijack();
      const raw = reply.raw;
      raw.writeHead(200, {
        "content-type": "text/event-stream",
        "cache-control": "no-cache, no-transform",
        connection: "keep-alive",
        "x-accel-buffering": "no",
      });
      const send = (o: unknown) => raw.write(`data: ${JSON.stringify(o)}\n\n`);
      const ping = setInterval(() => raw.write(": ping\n\n"), 15000);
      try {
        const r = await extractPurchaseOrderDraft(buffer, mimetype, (message) =>
          send({ type: "progress", message })
        );
        send({ type: "result", ...r });
      } catch (e) {
        const msg = e instanceof AragError ? `AI gateway error: ${e.message}` : (e as Error).message;
        send({ type: "error", message: msg });
      } finally {
        clearInterval(ping);
        raw.end();
      }
    }
  );

  // L1 — Duplicate / callback / warranty detection for a work order.
  app.post(
    "/similar-work-orders",
    {
      schema: {
        tags: ["AI"],
        summary: "Flag likely duplicate or callback/warranty jobs at the same site",
        body: z.object({ workOrderId: z.string().min(1) }),
      },
    },
    async (req) => {
      requireKb();
      const { workOrderId } = req.body as { workOrderId: string };
      const r = await wrap(flagSimilarWorkOrders(workOrderId));
      if (!r) throw new ApiError(404, "Work order not found");
      return r;
    }
  );

  // L2 — Parts prediction / job kitting from comparable jobs' actual usage.
  app.post(
    "/parts-kit",
    {
      schema: {
        tags: ["AI"],
        summary: "Suggest a parts kit for a work order, grounded in actual usage",
        body: z.object({ workOrderId: z.string().min(1) }),
      },
    },
    async (req) => {
      requireKb();
      const { workOrderId } = req.body as { workOrderId: string };
      const r = await wrap(suggestPartsKit(workOrderId));
      if (!r) throw new ApiError(404, "Work order not found");
      return r;
    }
  );

  // L3 — Technician day-plan narrative + clash detection.
  app.post(
    "/day-plan",
    {
      schema: {
        tags: ["AI"],
        summary: "Narrate a technician's day, flag clashes and wasteful travel",
        body: z.object({
          employeeId: z.string().min(1),
          date: z.string().optional(),
        }),
      },
    },
    async (req) => {
      requireKb();
      const { employeeId, date } = req.body as { employeeId: string; date?: string };
      const r = await wrap(technicianDayPlan(employeeId, date));
      if (!r) throw new ApiError(404, "Employee not found");
      return r;
    }
  );

  // ── Theme H: work-order lifecycle assists (all take a workOrderId) ──
  const woBody = z.object({ workOrderId: z.string().min(1) });
  const woAssists: [string, string, (id: string) => Promise<unknown>][] = [
    ["/completion-note", "Draft a completion note for a finished job", draftCompletionNote],
    ["/work-order-timeline", "Narrate a work order's history (handover/dispute)", workOrderTimeline],
    ["/site-access-briefing", "Assemble a 'before you arrive' site briefing", siteAccessBriefing],
    ["/time-anomaly", "Flag a job whose logged hours are unusually high", timeEntryAnomaly],
  ];
  for (const [path, summary, fn] of woAssists) {
    app.post(
      path,
      { schema: { tags: ["AI"], summary, body: woBody } },
      async (req) => {
        requireKb();
        const { workOrderId } = req.body as { workOrderId: string };
        const r = await wrap(fn(workOrderId));
        if (!r) throw new ApiError(404, "Work order not found");
        return r;
      }
    );
  }

  // K2/K3 + a couple of H — more work-order-scoped assists (same shape).
  const woAssists2: [string, string, (id: string) => Promise<unknown>][] = [
    ["/variation-claim", "Draft a variation/additional-works note when actuals exceed the quote", variationClaim],
    ["/customer-status-update", "Draft a customer-facing job status update", customerStatusUpdate],
  ];
  for (const [path, summary, fn] of woAssists2) {
    app.post(path, { schema: { tags: ["AI"], summary, body: woBody } }, async (req) => {
      requireKb();
      const { workOrderId } = req.body as { workOrderId: string };
      const r = await wrap(fn(workOrderId));
      if (!r) throw new ApiError(404, "Work order not found");
      return r;
    });
  }

  // Account-scoped assists (I2 account health, K1 proactive maintenance).
  const acctBody = z.object({ accountId: z.string().min(1) });
  const acctAssists: [string, string, (id: string) => Promise<unknown>][] = [
    ["/account-health", "Account health & churn-risk summary", accountHealth],
    ["/proactive-maintenance", "Suggest proactive maintenance to offer a customer", proactiveMaintenance],
  ];
  for (const [path, summary, fn] of acctAssists) {
    app.post(path, { schema: { tags: ["AI"], summary, body: acctBody } }, async (req) => {
      requireKb();
      const { accountId } = req.body as { accountId: string };
      const r = await wrap(fn(accountId));
      if (!r) throw new ApiError(404, "Account not found");
      return r;
    });
  }

  // I3 dunning (invoice-scoped, draft only).
  app.post(
    "/dunning-draft",
    { schema: { tags: ["AI"], summary: "Draft an overdue-invoice reminder (draft only)", body: z.object({ invoiceId: z.string().min(1) }) } },
    async (req) => {
      requireKb();
      const { invoiceId } = req.body as { invoiceId: string };
      const r = await wrap(draftDunning(invoiceId));
      if (!r) throw new ApiError(404, "Invoice not found");
      return r;
    }
  );

  // Org-wide assists (no body): I1, I4, I5, I6, I7.
  const orgAssists: [string, string, () => Promise<unknown>][] = [
    ["/lost-quotes", "Analyse rejected/expired quotes for loss patterns", analyzeLostQuotes],
    ["/fleet-compliance", "Vehicles with service/registration due soon", () => fleetComplianceDigest()],
    ["/recurring-preview", "Preview what the next recurring run would create", recurringRunPreview],
    ["/demand-reorder", "Reorder suggestions weighted by upcoming job demand", demandAwareReorder],
    ["/skill-gap", "Skill-coverage gaps across open jobs vs active staff", skillGapSignal],
  ];
  for (const [path, summary, fn] of orgAssists) {
    app.post(path, { schema: { tags: ["AI"], summary } }, async () => {
      requireKb();
      return wrap(fn());
    });
  }

  // ── Themes B/C/D/E/F ──
  // Org-wide (no body): B3 SLA early-warning, C3 margin insight, F2 exec summary.
  const orgAssists2: [string, string, () => Promise<unknown>][] = [
    ["/sla-early-warning", "Jobs approaching an SLA breach + recommended action", () => slaEarlyWarning()],
    ["/margin-insight", "Where margin is leaking, by job type", marginInsight],
    ["/exec-summary", "Board-ready monthly operations summary", execSummary],
  ];
  for (const [path, summary, fn] of orgAssists2) {
    app.post(path, { schema: { tags: ["AI"], summary } }, async () => {
      requireKb();
      return wrap(fn());
    });
  }

  // UC1B/UC7: finance exception explainer + auto-fix. No requireKb — the scan
  // is DB-only; the policy citation is best-effort inside the feature.
  app.post(
    "/finance-exceptions",
    { schema: { tags: ["AI"], summary: "Scan invoices & supplier bills for exceptions, grouped with proposed fixes" } },
    async () => financeExceptions()
  );

  // UC1A: recurring-fault / callback root-cause for a work order's site.
  app.post(
    "/fault-root-cause",
    { schema: { tags: ["AI"], summary: "Rank recurring-fault root causes at a work order's site", body: z.object({ workOrderId: z.string().min(1) }) } },
    async (req) => {
      requireKb();
      const { workOrderId } = req.body as { workOrderId: string };
      const r = await wrap(faultRootCause(workOrderId));
      if (!r) throw new ApiError(404, "Work order not found");
      return r;
    }
  );

  // UC6/UC8 repackage + UC10: org-wide analyses (no body).
  const orgAssists3: [string, string, () => Promise<unknown>][] = [
    ["/risk-watchlist", "Composite multi-factor account risk watchlist", riskWatchlist],
    ["/cost-exceptions", "Completed-job cost variances pre-labelled unresolved/partial", costExceptions],
    ["/compliance-readiness", "Compliance readiness + policy-vs-practice gaps", complianceReadiness],
  ];
  for (const [path, summary, fn] of orgAssists3) {
    app.post(path, { schema: { tags: ["AI"], summary } }, async () => {
      requireKb();
      return wrap(fn());
    });
  }

  // UC2: service commit-date co-pilot.
  app.post(
    "/commit-date",
    { schema: { tags: ["AI"], summary: "Service commit-date co-pilot for a work order", body: z.object({ workOrderId: z.string().min(1), targetDate: z.string().optional() }) } },
    async (req) => {
      requireKb();
      const { workOrderId, targetDate } = req.body as { workOrderId: string; targetDate?: string };
      const r = await wrap(commitDate(workOrderId, targetDate));
      if (!r) throw new ApiError(404, "Work order not found");
      return r;
    }
  );

  // UC3: fleet/asset service co-pilot.
  app.post(
    "/asset-service",
    { schema: { tags: ["AI"], summary: "Fleet/asset service co-pilot", body: z.object({ kind: z.enum(["vehicle", "asset"]), id: z.string().min(1), symptom: z.string().min(1).max(500) }) } },
    async (req) => {
      requireKb();
      const { kind, id, symptom } = req.body as { kind: "vehicle" | "asset"; id: string; symptom: string };
      const r = await wrap(assetServiceCoPilot(kind, id, symptom));
      if (!r) throw new ApiError(404, "Asset/vehicle not found");
      return r;
    }
  );

  // UC9: part/lot trace (deterministic — no requireKb).
  app.post("/lots", { schema: { tags: ["AI"], summary: "List traceable lots (consumed on jobs)" } }, async () => ({ lots: await availableLots() }));
  app.post(
    "/lot-trace",
    { schema: { tags: ["AI"], summary: "Forward + backward trace of a part lot", body: z.object({ lot: z.string().min(1) }) } },
    async (req) => {
      const { lot } = req.body as { lot: string };
      const r = await lotTrace(lot);
      if (!r) throw new ApiError(404, "Lot not found");
      return r;
    }
  );

  // Quote-scoped: C1 risk check, C2 comms drafting.
  app.post(
    "/quote-risk",
    { schema: { tags: ["AI"], summary: "Flag under/over-pricing on a quote vs comparable jobs", body: z.object({ quoteId: z.string().min(1) }) } },
    async (req) => {
      requireKb();
      const { quoteId } = req.body as { quoteId: string };
      const r = await wrap(quoteRiskCheck(quoteId));
      if (!r) throw new ApiError(404, "Quote not found");
      return r;
    }
  );
  app.post(
    "/quote-comms",
    { schema: { tags: ["AI"], summary: "Draft a quote cover note or follow-up (draft only)", body: z.object({ quoteId: z.string().min(1), kind: z.enum(["cover", "followup"]).optional() }) } },
    async (req) => {
      requireKb();
      const { quoteId, kind } = req.body as { quoteId: string; kind?: "cover" | "followup" };
      const r = await wrap(draftQuoteComms(quoteId, kind));
      if (!r) throw new ApiError(404, "Quote not found");
      return r;
    }
  );

  // D1 intake triage (free text).
  app.post(
    "/triage",
    { schema: { tags: ["AI"], summary: "Classify an inbound request → jobType/priority/skills/SLA", body: z.object({ request: z.string().min(5).max(2000) }) } },
    async (req) => {
      requireKb();
      const { request } = req.body as { request: string };
      return wrap(triageRequest(request));
    }
  );

  // D3 safety pre-flight (work-order scoped).
  app.post(
    "/safety-preflight",
    { schema: { tags: ["AI"], summary: "Safety controls for a job + clearance check on the assigned tech", body: z.object({ workOrderId: z.string().min(1) }) } },
    async (req) => {
      requireKb();
      const { workOrderId } = req.body as { workOrderId: string };
      const r = await wrap(safetyPreflight(workOrderId));
      if (!r) throw new ApiError(404, "Work order not found");
      return r;
    }
  );

  // E2 recurring suggester (account-scoped).
  app.post(
    "/recurring-suggest",
    { schema: { tags: ["AI"], summary: "Propose a recurring plan from an account's job history", body: z.object({ accountId: z.string().min(1) }) } },
    async (req) => {
      requireKb();
      const { accountId } = req.body as { accountId: string };
      const r = await wrap(recurringSuggester(accountId));
      if (!r) throw new ApiError(404, "Account not found");
      return r;
    }
  );

  // F3 audit assistant (NL question over the audit log).
  app.post(
    "/audit-assistant",
    { schema: { tags: ["AI"], summary: "Ask a natural-language question over the audit log", body: z.object({ question: z.string().min(3).max(500) }) } },
    async (req) => {
      requireKb();
      const { question } = req.body as { question: string };
      return wrap(auditAssistant(question));
    }
  );
}

// (kept here so the ErpDoc type is importable by future routes without a
// separate import path churn)
export type { ErpDoc };
