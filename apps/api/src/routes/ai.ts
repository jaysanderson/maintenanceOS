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
  type ErpDoc,
} from "../lib/arag.js";
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
      const res = await wrap(ask({ query, filters }));
      return { answer: res.answer, citations: res.citations };
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
      const query = [
        `Create a standard job playbook for: "${jobDescription}".`,
        `Base it on comparable past MaintenanceOS work orders and the relevant safety/policy documents.`,
        `Return ONLY a JSON object with these keys:`,
        `{"title": string, "requiredSkills": string[], "typicalMaterials": string[], "estimatedHours": number, "steps": string[], "safetyControls": string[]}.`,
      ].join(" ");
      const filters = jobType ? [{ labelset: "jobType", label: jobType }] : undefined;
      const res = await wrap(ask({ query, filters }));
      const playbook = extractJson(res.answer);
      return {
        jobDescription,
        jobType: jobType ?? null,
        playbook: playbook ?? null,
        // Always include the raw answer so the UI degrades gracefully if the
        // model didn't return clean JSON.
        raw: playbook ? undefined : res.answer,
        citations: res.citations,
      };
    }
  );
}

// (kept here so the ErpDoc type is importable by future routes without a
// separate import path churn)
export type { ErpDoc };
