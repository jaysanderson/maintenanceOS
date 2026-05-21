/** Typed surface for the ARAG endpoints MaintenanceOS uses.
 *  Ported from the PartnerForge arag-client (proven against the same
 *  Progress/Nuclia deployment). ARAG is MaintenanceOS's only AI gateway. */

export interface AragConfig {
  baseUrl: string;
  apiKey: string;
  timeoutMs?: number;
  maxRetries?: number;
}

export interface AragClassification {
  labelset: string;
  label: string;
}

/** A knowledge-graph relation to an entity (drives graph search). */
export interface AragRelation {
  /** Entity surface form, e.g. the account or technician name. */
  entity: string;
  /** Entity group, e.g. 'account' | 'site' | 'technician'. */
  entityGroup: string;
}

/**
 * A resource to upsert. `slug` is the stable idempotency key (deterministic
 * per source row). Bare uploads without classifications/relations are
 * rejected — the knowledge graph + labels are what power filtered retrieval.
 */
export interface AragResourceInput {
  slug: string;
  title: string;
  /** Plain-text body fields, keyed by field id (e.g. { body }). */
  texts: Record<string, string>;
  classifications: AragClassification[];
  relations: AragRelation[];
}

export interface AragUpsertResult {
  slug: string;
  resourceId?: string;
  created: boolean;
}

// ── File/media resource primitives (TUS) ───────────────────────────────
// For manuals / SDS / before-after photos: create the resource, then TUS
// upload the binary, then poll by id for processing status.

export interface AragFileResourceInput {
  slug: string;
  title: string;
  summary?: string;
  notes?: string;
  origin?: {
    url?: string;
    metadata?: Record<string, string | number | boolean | null>;
  };
  classifications?: AragClassification[];
}

export interface AragCreatedResource {
  resourceId: string;
  slug: string;
}

/** A single ASK / LABELER / LLM_GRAPH / SYNTHETIC_QUESTIONS / LLAMA_GUARD
 *  task. Posted to `POST /configuration/task/start` for a KB. */
export interface AragDaTaskParams {
  taskName: 'ASK' | 'LABELER' | 'LLM_GRAPH' | 'SYNTHETIC_QUESTIONS' | 'LLAMA_GUARD' | 'PROMPT_GUARD';
  /** Re-process scope. `NEW` = future ingests only; `ALL` = reprocess. */
  apply: 'NEW' | 'EXISTING' | 'ALL';
  parameters: Record<string, unknown>;
}

/** TUS upload options. The file body is a Node Buffer/Uint8Array. */
export interface AragTusUploadOpts {
  resourceId: string;
  /** Field id on the resource — e.g. `'file'`. */
  fieldId: string;
  filename: string;
  contentType: string;
  body: Buffer | Uint8Array;
  /** Bytes per PATCH. Default 5 MiB. */
  chunkSize?: number;
  /** Optional progress hook — 0 → 1. */
  onProgress?: (pct: number) => void;
}

export interface AragCitation {
  resourceId: string;
  title: string;
  snippet?: string;
  score?: number;
}

/** One turn of multi-turn context. ARAG /ask is stateless; callers pass this. */
export interface AragContextTurn {
  author: 'USER' | 'ARAG';
  text: string;
}

export interface AragAskRequest {
  query: string;
  context?: AragContextTurn[];
  filters?: AragClassification[];
}

export interface AragAskResponse {
  answer: string;
  citations: AragCitation[];
}

export interface AragFindRequest {
  query: string;
  filters?: AragClassification[];
  limit?: number;
}

export interface AragFindHit {
  resourceId: string;
  /** Stable slug (e.g. `wo-WO-2026-0001`) — maps back to the source row. */
  slug?: string;
  title: string;
  score: number;
  snippet?: string;
}

export interface AragFindResponse {
  hits: AragFindHit[];
}

/** A labelset definition (taxonomy). `kind` defaults to ['RESOURCES']. */
export interface AragLabelsetDef {
  title: string;
  color?: string;
  kind?: string[];
  labels: { title: string }[];
}

export interface AragLabelsetsResponse {
  uuid: string;
  labelsets: Record<string, AragLabelsetDef & { multiple?: boolean }>;
}

export interface AragHealth {
  ok: boolean;
  detail?: string;
}

/**
 * Non-grounded LLM call via ARAG's predict/chat. ARAG is our AI gateway —
 * direct-LLM call sites (form parsing, ad-hoc generation) use this instead
 * of importing OpenAI/Gemini SDKs directly. The KB's RAG path is suppressed
 * by supplying `queryContext` (caller-owned grounding); the `model` hint is
 * forwarded to ARAG when present.
 */
export interface AragPredictChatRequest {
  /** The prompt the LLM should answer. */
  question: string;
  /**
   * Caller-supplied context strings. Their presence tells ARAG to skip KB
   * retrieval and run as a pure model call. Pass at least one entry (a
   * system prompt or instructions) even for "no context" prompts.
   */
  queryContext: string[];
  /** Optional model id (ARAG resolves; unknown values fall back to KB default). */
  model?: string;
  /** Optional system prompt (in addition to queryContext). */
  systemPrompt?: string;
}

export type AragErrorKind = 'network' | 'timeout' | 'http' | 'parse' | 'config';

export class AragError extends Error {
  readonly kind: AragErrorKind;
  readonly status?: number;
  constructor(kind: AragErrorKind, message: string, status?: number) {
    super(message);
    this.name = 'AragError';
    this.kind = kind;
    this.status = status;
  }
}
