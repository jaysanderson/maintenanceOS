import {
  AragError,
  type AragAskRequest,
  type AragAskResponse,
  type AragConfig,
  type AragFindRequest,
  type AragFindResponse,
  type AragHealth,
  type AragLabelsetDef,
  type AragLabelsetsResponse,
  type AragPredictChatRequest,
  type AragResourceInput,
  type AragUpsertResult,
} from './types.js';

/** Inlined to keep this package dependency-free. */
const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));

interface RequestOptions {
  method: 'GET' | 'POST' | 'PATCH' | 'DELETE';
  path: string;
  body?: unknown;
  /** Extra request headers (e.g. X-Synchronous for /ask). */
  headers?: Record<string, string>;
  /** Skip retry (used by health checks). */
  noRetry?: boolean;
}

/** Map our context author to the Progress/Nuclia wire value. */
function wireContext(turns: AragAskRequest['context']): Array<{ author: string; text: string }> {
  return (turns ?? []).map((t) => ({
    author: t.author === 'ARAG' ? 'NUCLIA' : 'USER',
    text: t.text,
  }));
}

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null;
}

function answerTextFromLine(line: string): string | null {
  let parsed: unknown;
  try {
    parsed = JSON.parse(line);
  } catch {
    return null;
  }
  if (!isRecord(parsed) || !isRecord(parsed.item)) return null;
  const item = parsed.item;
  if (item.type === 'answer' && typeof item.text === 'string') return item.text;
  return null;
}

function extractCitations(data: Record<string, unknown>): { resourceId: string; title: string }[] {
  const rr = data.retrieval_results;
  const resources = isRecord(rr) && isRecord(rr.resources) ? rr.resources : undefined;
  if (!resources) return [];
  return Object.entries(resources).map(([rid, r]) => ({
    resourceId: rid,
    title: isRecord(r) && typeof r.title === 'string' ? r.title : rid,
  }));
}

function extractHits(
  data: Record<string, unknown>,
): { resourceId: string; slug?: string; title: string; score: number; snippet?: string }[] {
  const resources = isRecord(data.resources) ? data.resources : {};
  const best = Array.isArray(data.best_matches) ? (data.best_matches as unknown[]) : [];
  const uuids = best.length
    ? best.filter((b): b is string => typeof b === 'string').map((p) => p.split('/')[0] ?? p)
    : Object.keys(resources);

  const seen = new Set<string>();
  const hits: { resourceId: string; slug?: string; title: string; score: number; snippet?: string }[] = [];
  for (const uuid of uuids) {
    if (seen.has(uuid)) continue;
    seen.add(uuid);
    const r = resources[uuid];
    hits.push({
      resourceId: uuid,
      slug: isRecord(r) && typeof r.slug === 'string' ? r.slug : undefined,
      title: isRecord(r) && typeof r.title === 'string' ? r.title : uuid,
      score: 0,
      snippet: isRecord(r) && typeof r.summary === 'string' ? r.summary : undefined,
    });
  }
  return hits;
}

/**
 * Typed ARAG API client. All AI features route through here — there are no
 * direct LLM calls anywhere in MaintenanceOS. Transient failures (network,
 * timeout, 5xx) are retried with exponential backoff; everything else throws
 * a typed AragError so callers can degrade gracefully.
 */
export class AragClient {
  private readonly baseUrl: string;
  private readonly apiKey: string;
  private readonly timeoutMs: number;
  private readonly maxRetries: number;

  constructor(config: AragConfig) {
    if (!config.baseUrl) {
      throw new AragError('config', 'ARAG_BASE_URL is not configured');
    }
    this.baseUrl = config.baseUrl.replace(/\/+$/, '');
    this.apiKey = config.apiKey;
    this.timeoutMs = config.timeoutMs ?? 30_000;
    this.maxRetries = config.maxRetries ?? 3;
  }

  private kbPath(kbId: string, suffix: string): string {
    if (!kbId) throw new AragError('config', 'Knowledge Box id is required');
    return `/api/v1/kb/${encodeURIComponent(kbId)}/${suffix}`;
  }

  private async raw(opts: RequestOptions): Promise<Response> {
    const url = `${this.baseUrl}${opts.path}`;
    const attempts = opts.noRetry ? 1 : this.maxRetries;
    let lastErr: AragError | null = null;

    for (let attempt = 0; attempt < attempts; attempt++) {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), this.timeoutMs);
      try {
        const res = await fetch(url, {
          method: opts.method,
          headers: {
            authorization: `Bearer ${this.apiKey}`,
            ...(opts.body !== undefined ? { 'content-type': 'application/json' } : {}),
            ...opts.headers,
          },
          body: opts.body !== undefined ? JSON.stringify(opts.body) : undefined,
          signal: controller.signal,
        });
        clearTimeout(timer);

        if (res.status >= 500) {
          lastErr = new AragError('http', `ARAG ${res.status} on ${opts.path}`, res.status);
          await this.backoff(attempt);
          continue;
        }
        if (!res.ok) {
          throw new AragError('http', `ARAG ${res.status} on ${opts.path}`, res.status);
        }
        return res;
      } catch (err) {
        clearTimeout(timer);
        if (err instanceof AragError && err.kind === 'http') throw err;
        const isAbort = err instanceof Error && err.name === 'AbortError';
        lastErr = new AragError(
          isAbort ? 'timeout' : 'network',
          isAbort
            ? `ARAG request to ${opts.path} timed out after ${this.timeoutMs}ms`
            : `ARAG request to ${opts.path} failed: ${(err as Error).message}`,
        );
        await this.backoff(attempt);
      }
    }
    throw lastErr ?? new AragError('network', `ARAG request to ${opts.path} failed`);
  }

  private async backoff(attempt: number): Promise<void> {
    await sleep(300 * 2 ** attempt);
  }

  private async json<T>(opts: RequestOptions): Promise<T> {
    const res = await this.raw(opts);
    try {
      return (await res.json()) as T;
    } catch {
      throw new AragError('parse', `Failed to parse ARAG response for ${opts.path}`);
    }
  }

  private askBody(req: AragAskRequest): Record<string, unknown> {
    const body: Record<string, unknown> = { query: req.query };
    if (req.context?.length) body.context = wireContext(req.context);
    if (req.filters?.length) {
      body.filters = req.filters.map((f) => `/classification.labels/${f.labelset}/${f.label}`);
    }
    return body;
  }

  /** RAG-powered Q&A (synchronous): one assembled answer + citations. */
  async ask(kbId: string, req: AragAskRequest): Promise<AragAskResponse> {
    const data = await this.json<Record<string, unknown>>({
      method: 'POST',
      path: this.kbPath(kbId, 'ask'),
      headers: { 'x-synchronous': 'true' },
      body: this.askBody(req),
    });
    return {
      answer: typeof data.answer === 'string' ? data.answer : '',
      citations: extractCitations(data),
    };
  }

  /** Streaming /ask — yields answer text as NDJSON items arrive. */
  async *askStream(kbId: string, req: AragAskRequest): AsyncGenerator<string> {
    const res = await this.raw({
      method: 'POST',
      path: this.kbPath(kbId, 'ask'),
      body: this.askBody(req),
      noRetry: true,
    });
    if (!res.body) throw new AragError('parse', 'ARAG stream returned no body');
    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split('\n');
      buffer = lines.pop() ?? '';
      for (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed) continue;
        const text = answerTextFromLine(trimmed);
        if (text) yield text;
      }
    }
    const tail = buffer.trim();
    if (tail) {
      const text = answerTextFromLine(tail);
      if (text) yield text;
    }
  }

  /**
   * Non-grounded LLM call via /predict/chat — ARAG as the AI gateway.
   * Supplying `query_context` tells ARAG to skip retrieval and run as a pure
   * model call. The response body is the assembled answer with a trailing
   * citation-count token (`0` ok, `-2` no-data) that we strip.
   */
  async predictChat(kbId: string, req: AragPredictChatRequest): Promise<string> {
    if (!req.queryContext.length) {
      throw new AragError(
        'config',
        'predictChat requires at least one queryContext entry (caller-owned grounding)',
      );
    }
    const body: Record<string, unknown> = {
      question: req.question,
      query_context: req.queryContext,
    };
    if (req.model) body.model = req.model;
    if (req.systemPrompt) body.system_prompt = req.systemPrompt;
    const res = await this.raw({
      method: 'POST',
      path: this.kbPath(kbId, 'predict/chat'),
      body,
    });
    const text = await res.text();
    return text.replace(/[-]?\d+\s*$/, '').trim();
  }

  /** Semantic + keyword + graph search. */
  async find(kbId: string, req: AragFindRequest): Promise<AragFindResponse> {
    const body: Record<string, unknown> = { query: req.query, page_size: req.limit ?? 20 };
    if (req.filters?.length) {
      body.filters = req.filters.map((f) => `/classification.labels/${f.labelset}/${f.label}`);
    }
    const data = await this.json<Record<string, unknown>>({
      method: 'POST',
      path: this.kbPath(kbId, 'find'),
      body,
    });
    return { hits: extractHits(data) };
  }

  /** Authenticated KB info — also the per-KB health/auth check. */
  async kbInfo(kbId: string): Promise<{ uuid: string; title: string }> {
    const data = await this.json<{ uuid: string; config?: { title?: string } }>({
      method: 'GET',
      path: `/api/v1/kb/${encodeURIComponent(kbId)}`,
    });
    return { uuid: data.uuid, title: data.config?.title ?? '' };
  }

  /** Resource counters (resources / paragraphs / fields) — verifies ingest. */
  counters(kbId: string): Promise<Record<string, unknown>> {
    return this.json<Record<string, unknown>>({
      method: 'GET',
      path: this.kbPath(kbId, 'counters'),
    });
  }

  private resourceBody(r: AragResourceInput): Record<string, unknown> {
    if (!r.classifications.length && !r.relations.length) {
      throw new AragError(
        'config',
        'ARAG resource requires classifications and/or relations (graph + labels power retrieval)',
      );
    }
    const texts: Record<string, { body: string; format: string }> = {};
    for (const [field, body] of Object.entries(r.texts)) {
      texts[field] = { body, format: 'PLAIN' };
    }
    return {
      title: r.title,
      slug: r.slug,
      texts,
      usermetadata: {
        classifications: r.classifications,
        relations: r.relations.map((rel) => ({
          relation: 'ENTITY',
          to: { value: rel.entity, type: 'entity', group: rel.entityGroup },
        })),
      },
    };
  }

  /** Idempotent resource upsert keyed by `slug` (POST, PATCH on 409). */
  async upsertResource(kbId: string, r: AragResourceInput): Promise<AragUpsertResult> {
    const body = this.resourceBody(r);
    try {
      const created = await this.json<{ uuid?: string }>({
        method: 'POST',
        path: this.kbPath(kbId, 'resources'),
        body,
      });
      return { slug: r.slug, resourceId: created.uuid, created: true };
    } catch (err) {
      if (err instanceof AragError && err.status === 409) {
        await this.raw({
          method: 'PATCH',
          path: `/api/v1/kb/${encodeURIComponent(kbId)}/slug/${encodeURIComponent(r.slug)}`,
          body,
        });
        return { slug: r.slug, created: false };
      }
      throw err;
    }
  }

  async deleteResourceBySlug(kbId: string, slug: string): Promise<void> {
    await this.raw({
      method: 'DELETE',
      path: `/api/v1/kb/${encodeURIComponent(kbId)}/slug/${encodeURIComponent(slug)}`,
    });
  }

  /**
   * Provision a Data Augmentation task on a KB (LABELER / LLM_GRAPH /
   * SYNTHETIC_QUESTIONS / ASK). Idempotent — 200 OK on re-create.
   */
  async setupDaTask(
    kbId: string,
    spec: import('./types.js').AragDaTaskParams,
  ): Promise<{ ok: boolean }> {
    await this.json({
      method: 'POST',
      path: this.kbPath(kbId, 'configuration/task/start'),
      body: { task_name: spec.taskName, apply: spec.apply, parameters: spec.parameters },
    });
    return { ok: true };
  }

  listDaTasks(kbId: string): Promise<{
    tasks: Array<{ id: string; name: string; status: string; task_name: string }>;
  }> {
    return this.json({ method: 'GET', path: this.kbPath(kbId, 'configuration/tasks') });
  }

  listLabelsets(kbId: string): Promise<AragLabelsetsResponse> {
    return this.json<AragLabelsetsResponse>({
      method: 'GET',
      path: this.kbPath(kbId, 'labelsets'),
    });
  }

  async putLabelset(kbId: string, labelsetId: string, def: AragLabelsetDef): Promise<void> {
    await this.raw({
      method: 'POST',
      path: `/api/v1/kb/${encodeURIComponent(kbId)}/labelset/${encodeURIComponent(labelsetId)}`,
      body: {
        title: def.title,
        color: def.color ?? '#0D6EFD',
        kind: def.kind ?? ['RESOURCES'],
        labels: def.labels,
      },
    });
  }

  graphNodes(kbId: string, body: unknown): Promise<unknown> {
    return this.json({ method: 'POST', path: this.kbPath(kbId, 'graph/nodes'), body });
  }

  /** Reachability probe. Any HTTP response means reachable. */
  async health(): Promise<AragHealth> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeoutMs);
    try {
      const res = await fetch(`${this.baseUrl}/api/v1/health`, {
        method: 'GET',
        headers: { authorization: `Bearer ${this.apiKey}` },
        signal: controller.signal,
      });
      return { ok: true, detail: `reachable (HTTP ${res.status})` };
    } catch (err) {
      const isAbort = err instanceof Error && err.name === 'AbortError';
      return {
        ok: false,
        detail: isAbort ? 'timeout' : `unreachable: ${(err as Error).message}`,
      };
    } finally {
      clearTimeout(timer);
    }
  }
}

/**
 * A client bound to one Knowledge Box (its id + scoped key), so callers
 * never pass a kbId.
 */
export class AragKbClient {
  private readonly client: AragClient;
  readonly kbId: string;

  constructor(kbId: string, config: AragConfig) {
    this.kbId = kbId;
    this.client = new AragClient(config);
  }

  ask(req: AragAskRequest): Promise<AragAskResponse> {
    return this.client.ask(this.kbId, req);
  }
  askStream(req: AragAskRequest): AsyncGenerator<string> {
    return this.client.askStream(this.kbId, req);
  }
  predictChat(req: AragPredictChatRequest): Promise<string> {
    return this.client.predictChat(this.kbId, req);
  }
  find(req: AragFindRequest): Promise<AragFindResponse> {
    return this.client.find(this.kbId, req);
  }
  upsertResource(r: AragResourceInput): Promise<AragUpsertResult> {
    return this.client.upsertResource(this.kbId, r);
  }
  deleteResourceBySlug(slug: string): Promise<void> {
    return this.client.deleteResourceBySlug(this.kbId, slug);
  }
  setupDaTask(spec: import('./types.js').AragDaTaskParams): Promise<{ ok: boolean }> {
    return this.client.setupDaTask(this.kbId, spec);
  }
  listDaTasks(): Promise<{
    tasks: Array<{ id: string; name: string; status: string; task_name: string }>;
  }> {
    return this.client.listDaTasks(this.kbId);
  }
  listLabelsets(): Promise<AragLabelsetsResponse> {
    return this.client.listLabelsets(this.kbId);
  }
  putLabelset(labelsetId: string, def: AragLabelsetDef): Promise<void> {
    return this.client.putLabelset(this.kbId, labelsetId, def);
  }
  counters(): Promise<Record<string, unknown>> {
    return this.client.counters(this.kbId);
  }
  graphNodes(body: unknown): Promise<unknown> {
    return this.client.graphNodes(this.kbId, body);
  }
  kbInfo(): Promise<{ uuid: string; title: string }> {
    return this.client.kbInfo(this.kbId);
  }
  async health(): Promise<AragHealth> {
    try {
      const info = await this.client.kbInfo(this.kbId);
      return { ok: true, detail: `KB "${info.title}" reachable` };
    } catch (err) {
      const e = err instanceof AragError ? err : null;
      return {
        ok: false,
        detail: e ? `${e.kind}: ${e.message}` : `error: ${(err as Error).message}`,
      };
    }
  }
}

// ── Retrieval Agent client (multi-source agent: KB + MCP drivers) ─────────
//
// Distinct base path (`/api/v1/agent/{id}`) and used by the agent-backed
// features (F3/F4/F5). Sessions hold conversation context; Interact streams
// SSE. The `headers` on Interact are forwarded to drivers — we pass the
// signed-in user's MaintenanceOS JWT there so the mcp_http driver inherits
// the user's RBAC.

export interface AragAgentConfig extends AragConfig {
  agentId: string;
}

export class AragAgentClient {
  private readonly baseUrl: string;
  private readonly apiKey: string;
  private readonly agentId: string;
  private readonly timeoutMs: number;

  constructor(config: AragAgentConfig) {
    if (!config.baseUrl) throw new AragError('config', 'ARAG_BASE_URL is not configured');
    if (!config.agentId) throw new AragError('config', 'ARAG agentId is required');
    this.baseUrl = config.baseUrl.replace(/\/+$/, '');
    this.apiKey = config.apiKey;
    this.agentId = config.agentId;
    this.timeoutMs = config.timeoutMs ?? 60_000;
  }

  private agentPath(suffix: string): string {
    return `/api/v1/agent/${encodeURIComponent(this.agentId)}/${suffix}`;
  }

  private async req(method: string, path: string, body?: unknown, extraHeaders?: Record<string, string>): Promise<Response> {
    const res = await fetch(`${this.baseUrl}${path}`, {
      method,
      headers: {
        authorization: `Bearer ${this.apiKey}`,
        ...(body !== undefined ? { 'content-type': 'application/json' } : {}),
        ...extraHeaders,
      },
      body: body !== undefined ? JSON.stringify(body) : undefined,
    });
    if (!res.ok && res.status !== 200) {
      throw new AragError('http', `ARAG agent ${res.status} on ${path}`, res.status);
    }
    return res;
  }

  /** Create a conversation session; returns its uuid. */
  async createSession(opts: { slug?: string; name?: string }): Promise<{ uuid: string }> {
    const res = await this.req('POST', this.agentPath('sessions'), {
      slug: opts.slug ?? `s-${Date.now()}`,
      name: opts.name ?? 'MaintenanceOS session',
      summary: '',
      data: '',
      format: 'PLAIN',
    });
    return (await res.json()) as { uuid: string };
  }

  /**
   * Ask a question in a session. `forwardHeaders` are passed to drivers
   * (e.g. the MaintenanceOS JWT for the mcp_http driver). Returns the raw
   * SSE Response so callers can stream it straight through to the browser.
   */
  interact(
    sessionId: string,
    question: string,
    opts?: { args?: Record<string, unknown>; forwardHeaders?: Record<string, string> },
  ): Promise<Response> {
    return this.req(
      'POST',
      this.agentPath(`session/${encodeURIComponent(sessionId)}`),
      { question, headers: opts?.forwardHeaders ?? {}, arguments: opts?.args ?? {}, operation: 0 },
      { accept: 'text/event-stream' },
    );
  }

  /** Driver CRUD (config-as-code provisioning). */
  async listDrivers(): Promise<unknown> {
    const res = await this.req('GET', this.agentPath('drivers'));
    return res.json();
  }
  async addDriver(driver: Record<string, unknown>): Promise<unknown> {
    const res = await this.req('POST', this.agentPath('drivers'), driver);
    return res.json().catch(() => ({}));
  }
  async addPreprocess(step: Record<string, unknown>): Promise<unknown> {
    const res = await this.req('POST', this.agentPath('preprocess'), step);
    return res.json().catch(() => ({}));
  }
  async addGeneration(step: Record<string, unknown>): Promise<unknown> {
    const res = await this.req('POST', this.agentPath('generation'), step);
    return res.json().catch(() => ({}));
  }
  async addPostprocess(step: Record<string, unknown>): Promise<unknown> {
    const res = await this.req('POST', this.agentPath('postprocess'), step);
    return res.json().catch(() => ({}));
  }
  async setRules(rules: unknown[]): Promise<unknown> {
    const res = await this.req('POST', this.agentPath('rules'), { rules });
    return res.json().catch(() => ({}));
  }
}

// ── Env factories (MaintenanceOS single-KB + single-agent) ────────────────

function baseConfig(apiKey: string): AragConfig {
  return {
    baseUrl: process.env.ARAG_BASE_URL ?? '',
    apiKey,
    timeoutMs: process.env.ARAG_TIMEOUT_MS ? Number(process.env.ARAG_TIMEOUT_MS) : undefined,
    maxRetries: process.env.ARAG_MAX_RETRIES ? Number(process.env.ARAG_MAX_RETRIES) : undefined,
  };
}

/** True when the KB env (base URL + KB id + key) is fully configured. */
export function aragConfigured(): boolean {
  return Boolean(process.env.ARAG_BASE_URL && process.env.ARAG_KB_ID && process.env.ARAG_KB_KEY);
}

/** Build the KB-bound client from environment. */
export function aragKbFromEnv(): AragKbClient {
  const key = process.env.ARAG_KB_KEY || process.env.ARAG_API_KEY || '';
  const kbId = process.env.ARAG_KB_ID ?? '';
  return new AragKbClient(kbId, baseConfig(key));
}

/** True when the agent env (base URL + agent id + key) is configured. */
export function aragAgentConfigured(): boolean {
  return Boolean(process.env.ARAG_BASE_URL && process.env.ARAG_AGENT_ID && process.env.ARAG_AGENT_KEY);
}

/** Build the Retrieval Agent client from environment. */
export function aragAgentFromEnv(): AragAgentClient {
  const key = process.env.ARAG_AGENT_KEY || process.env.ARAG_API_KEY || '';
  return new AragAgentClient({ ...baseConfig(key), agentId: process.env.ARAG_AGENT_ID ?? '' });
}
