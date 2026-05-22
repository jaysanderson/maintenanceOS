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
  ask,
  find,
  agentAsk,
  isLowConfidenceAnswer,
  LOW_CONFIDENCE_MESSAGE,
  type ErpDoc,
} from "../lib/arag.js";
import { generateBriefing, dispatchActions, draftQuote, savePlaybook } from "../lib/aiFeatures.js";
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
      // Probe with a plain grounded ask first: if ARAG can't ground the job
      // (sentinel) or the score is below threshold, don't fabricate a
      // structured playbook (e.g. "sing at a kids party" at a maintenance co).
      const probe = await wrap(ask({ query: jobDescription, filters }));
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
            "Not enough comparable completed jobs to draft a confident quote — " +
            "please quote this one manually.",
        };
      }
      return { ...r, lowConfidence: false };
    }
  );
}

// (kept here so the ErpDoc type is importable by future routes without a
// separate import path churn)
export type { ErpDoc };
