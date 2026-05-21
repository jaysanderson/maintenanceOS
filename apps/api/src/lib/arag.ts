/**
 * ARAG integration surface for MaintenanceOS.
 *
 * ARAG is the ONLY AI gateway — no OpenAI/Gemini SDKs anywhere. This module
 * is a thin wrapper over @maintenanceos/arag-client that:
 *   - reports configuration state (so features degrade gracefully),
 *   - maps the ERP's document shape onto ARAG resources (labels → KB
 *     classifications, entities → KB graph relations),
 *   - exposes ask / find / predictChat / DA-task helpers for the routes.
 *
 * Config comes from apps/api/.env:
 *   ARAG_BASE_URL   e.g. https://aws-us-east-2-1.rag.progress.cloud
 *   ARAG_KB_ID      the Knowledge Box uuid
 *   ARAG_KB_KEY     service-account key (WRITER+; MANAGER for DA tasks)
 *   ARAG_AGENT_ID   Retrieval Agent id (F3/F4/F5)
 *   ARAG_AGENT_KEY  agent key
 */
import {
  aragKbFromEnv,
  aragAgentFromEnv,
  aragConfigured,
  aragAgentConfigured,
  type AragKbClient,
  type AragAgentClient,
  type AragAskRequest,
  type AragAskResponse,
  type AragFindRequest,
  type AragFindResponse,
  type AragClassification,
  type AragRelation,
  type AragDaTaskParams,
} from "@maintenanceos/arag-client";

/** A serialized ERP record ready to upsert into the KB. */
export interface ErpDoc {
  /** Stable idempotency key, e.g. `wo-WO-2026-0001`. */
  slug: string;
  title: string;
  /** Markdown body (human-readable serialization of the record). */
  body: string;
  /** Logical area, e.g. `/erp/work-orders` (kept for dry-run inspection). */
  path: string;
  /** [labelset, label] pairs → KB classifications. */
  labels: [string, string][];
  /** Knowledge-graph entities this record relates to. */
  relations?: AragRelation[];
}

export function isConfigured(): boolean {
  return aragConfigured();
}

export function agentConfigured(): boolean {
  return aragAgentConfigured();
}

export function getAragConfig(): { baseUrl: string; kbId: string; agentId?: string } {
  return {
    baseUrl: process.env.ARAG_BASE_URL ?? "",
    kbId: process.env.ARAG_KB_ID ?? "",
    agentId: process.env.ARAG_AGENT_ID || undefined,
  };
}

let _kb: AragKbClient | null = null;
function kb(): AragKbClient {
  if (!_kb) _kb = aragKbFromEnv();
  return _kb;
}

let _agent: AragAgentClient | null = null;
export function agent(): AragAgentClient {
  if (!_agent) _agent = aragAgentFromEnv();
  return _agent;
}

/** Idempotent upsert of one ERP document into the KB. */
export async function upsertErpDoc(
  doc: ErpDoc
): Promise<{ slug: string; action: "created" | "updated" }> {
  const classifications: AragClassification[] = doc.labels.map(([labelset, label]) => ({
    labelset,
    label,
  }));
  const res = await kb().upsertResource({
    slug: doc.slug,
    title: doc.title,
    texts: { body: doc.body },
    classifications,
    relations: doc.relations ?? [],
  });
  return { slug: doc.slug, action: res.created ? "created" : "updated" };
}

/** F1 retrieval: grounded, cited answer. */
export function ask(req: AragAskRequest): Promise<AragAskResponse> {
  return kb().ask(req);
}

/** Streaming /ask (token generator). */
export function askStream(req: AragAskRequest): AsyncGenerator<string> {
  return kb().askStream(req);
}

/** Raw retrieval hits (no generation). */
export function find(req: AragFindRequest): Promise<AragFindResponse> {
  return kb().find(req);
}

/** Non-grounded LLM call via ARAG (the AI gateway). */
export function predictChat(
  question: string,
  queryContext: string[],
  opts?: { model?: string; systemPrompt?: string }
): Promise<string> {
  return kb().predictChat({ question, queryContext, ...opts });
}

/** Provision/refresh a Data-Augmentation task (LABELER / LLM_GRAPH / …). */
export function startDaTask(spec: AragDaTaskParams): Promise<{ ok: boolean }> {
  return kb().setupDaTask(spec);
}

export { kb as kbClient };
