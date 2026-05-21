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
}

// (kept here so the ErpDoc type is importable by future routes without a
// separate import path churn)
export type { ErpDoc };
