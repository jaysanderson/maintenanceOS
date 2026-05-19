import type { OpenApiOperation } from "./openapi.js";

/**
 * Abstract HTTP client so the hosted MCP plugin can use Fastify's
 * in-process `app.inject` and the stdio binary can use real `fetch`.
 * Result mirrors the shape of a fetch Response after `.text()`.
 */
export interface ApiClientRequest {
  method: string;
  url: string; // path + querystring, e.g. /api/accounts/?limit=10
  body?: string; // JSON string
  headers: Record<string, string>;
}
export interface ApiClientResponse {
  status: number;
  headers: Record<string, string | undefined>;
  text: string;
}
export type ApiClient = (req: ApiClientRequest) => Promise<ApiClientResponse>;

/** What an MCP tool handler must return. */
export interface ToolResult {
  content: { type: "text"; text: string }[];
  isError?: boolean;
}

/** Substitute `{name}` placeholders in a path. */
function fillPath(
  template: string,
  params: Record<string, unknown> | undefined
): string {
  return template.replace(/\{([^}]+)\}/g, (_, name) => {
    const v = params?.[name];
    if (v == null) {
      throw new Error(`Missing path param: ${name}`);
    }
    return encodeURIComponent(String(v));
  });
}

function buildQuery(query?: Record<string, unknown>): string {
  if (!query) return "";
  const usp = new URLSearchParams();
  for (const [k, v] of Object.entries(query)) {
    if (v === undefined || v === null) continue;
    usp.append(k, String(v));
  }
  const s = usp.toString();
  return s ? `?${s}` : "";
}

export interface DispatchArgs {
  path?: Record<string, unknown>;
  query?: Record<string, unknown>;
  body?: unknown;
}

export async function dispatchOperation(
  op: OpenApiOperation,
  args: DispatchArgs,
  apiClient: ApiClient,
  bearerToken?: string
): Promise<ToolResult> {
  let url: string;
  try {
    url = fillPath(op.path, args.path) + buildQuery(args.query);
  } catch (e) {
    return {
      isError: true,
      content: [{ type: "text", text: (e as Error).message }],
    };
  }

  const headers: Record<string, string> = { "content-type": "application/json" };
  if (bearerToken) headers["authorization"] = `Bearer ${bearerToken}`;

  const body =
    args.body !== undefined && op.method !== "GET"
      ? JSON.stringify(args.body)
      : undefined;

  const res = await apiClient({ method: op.method, url, body, headers });
  const ct = res.headers["content-type"] ?? "";
  const isJson = ct.includes("application/json");
  const text = res.text;
  const payload = isJson ? text : JSON.stringify({ body: text, contentType: ct });

  if (res.status >= 200 && res.status < 300) {
    return { content: [{ type: "text", text: payload }] };
  }
  return {
    isError: true,
    content: [{ type: "text", text: `[HTTP ${res.status}] ${payload}` }],
  };
}

/** Build an ApiClient backed by global fetch (used by stdio host). */
export function fetchApiClient(apiBase: string): ApiClient {
  const base = apiBase.replace(/\/$/, "");
  return async ({ method, url, body, headers }) => {
    const res = await fetch(base + url, { method, body, headers });
    const text = await res.text();
    const h: Record<string, string> = {};
    res.headers.forEach((v, k) => (h[k] = v));
    return { status: res.status, headers: h, text };
  };
}
