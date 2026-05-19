/**
 * Pull operations out of an OpenAPI 3 document and filter to the set
 * MCP should expose. Source-of-truth is the API's /docs/json — the MCP
 * layer never reimplements business logic.
 */

export interface OpenApiParam {
  name: string;
  in: "path" | "query" | "header" | "cookie";
  required?: boolean;
  schema?: Record<string, unknown>;
  description?: string;
}

export interface OpenApiOperation {
  /** HTTP method, uppercase. */
  method: "GET" | "POST" | "PUT" | "PATCH" | "DELETE";
  /** Template path with `{name}` placeholders (e.g. `/api/work-orders/{id}`). */
  path: string;
  tag?: string;
  summary?: string;
  description?: string;
  pathParams: OpenApiParam[];
  queryParams: OpenApiParam[];
  /** JSON schema for application/json request body, if any. */
  bodySchema?: Record<string, unknown>;
  bodyRequired?: boolean;
}

interface OpenApiDoc {
  paths?: Record<string, Record<string, RawOperation>>;
}

interface RawOperation {
  tags?: string[];
  summary?: string;
  description?: string;
  parameters?: OpenApiParam[];
  requestBody?: {
    required?: boolean;
    content?: Record<string, { schema?: Record<string, unknown> }>;
  };
  responses?: Record<
    string,
    { content?: Record<string, { schema?: Record<string, unknown> }> }
  >;
}

const METHODS = ["get", "post", "put", "patch", "delete"] as const;

export interface FilterOptions {
  /** Skip DELETE operations. Default true. */
  excludeDeletes?: boolean;
  /** Path prefixes to skip entirely (e.g. ["/api/system"]). */
  excludePathPrefixes?: string[];
  /** Exact paths to skip. */
  excludePaths?: string[];
  /** Skip ops whose 2xx response declares any of these content types. */
  excludeResponseContentTypes?: string[];
}

const DEFAULTS: Required<FilterOptions> = {
  excludeDeletes: true,
  excludePathPrefixes: ["/api/system"],
  excludePaths: [
    "/api/auth/login", // the agent already authed; don't expose login as a tool
    "/api/work-orders/{id}/attachments", // multipart upload — not JSON
  ],
  excludeResponseContentTypes: ["application/pdf", "application/octet-stream"],
};

function shouldSkipResponse(
  op: RawOperation,
  excludedTypes: string[]
): boolean {
  for (const [code, resp] of Object.entries(op.responses ?? {})) {
    if (!code.startsWith("2")) continue;
    for (const ct of Object.keys(resp.content ?? {})) {
      if (excludedTypes.includes(ct)) return true;
    }
  }
  // Also skip paths whose name strongly implies a binary stream
  return false;
}

function pathLooksBinary(path: string): boolean {
  return (
    path.endsWith("/pdf") ||
    path.endsWith("/download") ||
    /\/pdf$/.test(path) ||
    /\/download$/.test(path)
  );
}

/** Pull the request body's application/json schema, if any. */
function jsonBody(op: RawOperation):
  | { schema: Record<string, unknown>; required: boolean }
  | undefined {
  const body = op.requestBody;
  const schema = body?.content?.["application/json"]?.schema;
  if (!schema) return undefined;
  return { schema, required: body?.required ?? false };
}

/**
 * Iterate every operation in `spec` and return those that pass the filter
 * (i.e. the operations we want to expose as MCP tools).
 */
export function listOperations(
  spec: OpenApiDoc,
  options: FilterOptions = {}
): OpenApiOperation[] {
  const opts: Required<FilterOptions> = { ...DEFAULTS, ...options };
  const out: OpenApiOperation[] = [];

  for (const [pathTpl, methods] of Object.entries(spec.paths ?? {})) {
    if (opts.excludePaths.includes(pathTpl)) continue;
    if (
      opts.excludePathPrefixes.some((p) => pathTpl === p || pathTpl.startsWith(p + "/"))
    )
      continue;
    if (pathLooksBinary(pathTpl)) continue;

    for (const m of METHODS) {
      const raw = methods[m];
      if (!raw) continue;
      const method = m.toUpperCase() as OpenApiOperation["method"];
      if (opts.excludeDeletes && method === "DELETE") continue;
      if (shouldSkipResponse(raw, opts.excludeResponseContentTypes)) continue;

      const params = raw.parameters ?? [];
      const body = jsonBody(raw);

      out.push({
        method,
        path: pathTpl,
        tag: raw.tags?.[0],
        summary: raw.summary,
        description: raw.description,
        pathParams: params.filter((p) => p.in === "path"),
        queryParams: params.filter((p) => p.in === "query"),
        bodySchema: body?.schema,
        bodyRequired: body?.required ?? false,
      });
    }
  }
  return out;
}

/** Fetch an OpenAPI document over HTTP (used by the stdio binary). */
export async function fetchSpec(
  apiBase: string,
  fetchImpl: typeof fetch = fetch
): Promise<OpenApiDoc> {
  const res = await fetchImpl(`${apiBase.replace(/\/$/, "")}/docs/json`);
  if (!res.ok) {
    throw new Error(`Failed to fetch /docs/json: ${res.status} ${res.statusText}`);
  }
  return (await res.json()) as OpenApiDoc;
}
