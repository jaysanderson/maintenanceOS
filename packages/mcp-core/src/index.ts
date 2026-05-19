/**
 * @maintenanceos/mcp-core
 *
 * Shared library that turns a MaintenanceOS OpenAPI document into a fully
 * wired MCP server. Used by both the stdio binary (`apps/mcp`) and the
 * hosted Streamable-HTTP plugin (`apps/api/src/mcp.ts`).
 */
import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import {
  ListToolsRequestSchema,
  CallToolRequestSchema,
  ListResourcesRequestSchema,
  ListResourceTemplatesRequestSchema,
  ReadResourceRequestSchema,
  ListPromptsRequestSchema,
  GetPromptRequestSchema,
  type CallToolResult,
} from "@modelcontextprotocol/sdk/types.js";

import {
  fetchSpec,
  listOperations,
  type FilterOptions,
  type OpenApiOperation,
} from "./openapi.js";
import { toolNameFor } from "./toolName.js";
import { buildInputSchema } from "./inputSchema.js";
import {
  dispatchOperation,
  fetchApiClient,
  type ApiClient,
  type DispatchArgs,
} from "./dispatch.js";
import {
  FIXED_RESOURCES,
  RESOURCE_TEMPLATES,
  readResource,
} from "./resources.js";
import { PROMPTS } from "./prompts.js";

export type {
  OpenApiOperation,
  FilterOptions,
  ApiClient,
  DispatchArgs,
};
export { fetchSpec, listOperations, fetchApiClient, toolNameFor };

export interface CreateServerOptions {
  name?: string;
  version?: string;
  /** OpenAPI document the tools are built from. */
  spec: unknown;
  /** How outgoing API requests are sent (fetch loopback or app.inject). */
  apiClient: ApiClient;
  /** Bearer token to attach to API requests (per-session or per-request). */
  bearerToken?: string;
  /** Optional override of the default filter (excludes DELETE, /system, binary, multipart). */
  filter?: FilterOptions;
}

/**
 * Build a fully wired MCP `Server` (low-level SDK class) — register the
 * tools/list, tools/call, resources/list, resources/read, prompts/list,
 * prompts/get handlers and return the server ready to `.connect(transport)`.
 */
export function createServer(opts: CreateServerOptions): {
  server: Server;
  operations: OpenApiOperation[];
  tools: { name: string; op: OpenApiOperation }[];
} {
  const server = new Server(
    {
      name: opts.name ?? "maintenanceos",
      version: opts.version ?? "1.0.0",
    },
    {
      capabilities: {
        tools: {},
        resources: { subscribe: false, listChanged: false },
        prompts: { listChanged: false },
      },
    }
  );

  const operations = listOperations(
    opts.spec as Parameters<typeof listOperations>[0],
    opts.filter
  );

  // Deterministic name + dedupe (rare clashes get a numeric suffix)
  const taken = new Set<string>();
  const tools: { name: string; op: OpenApiOperation }[] = operations.map((op) => {
    let name = toolNameFor(op.method, op.path, op.tag);
    let i = 2;
    while (taken.has(name)) {
      name = `${toolNameFor(op.method, op.path, op.tag)}_${i++}`;
    }
    taken.add(name);
    return { name, op };
  });

  // tools/list
  server.setRequestHandler(ListToolsRequestSchema, async () => ({
    tools: tools.map(({ name, op }) => ({
      name,
      description: [op.summary, op.description].filter(Boolean).join(" — ") ||
        `${op.method} ${op.path}`,
      inputSchema: buildInputSchema(op),
    })),
  }));

  // tools/call
  server.setRequestHandler(CallToolRequestSchema, async (req): Promise<CallToolResult> => {
    const entry = tools.find((t) => t.name === req.params.name);
    if (!entry) {
      return {
        content: [{ type: "text", text: `Unknown tool: ${req.params.name}` }],
        isError: true,
      };
    }
    const args = (req.params.arguments ?? {}) as DispatchArgs;
    const result = await dispatchOperation(
      entry.op,
      args,
      opts.apiClient,
      opts.bearerToken
    );
    return result as CallToolResult;
  });

  // resources/list and resources/templates/list
  server.setRequestHandler(ListResourcesRequestSchema, async () => ({
    resources: FIXED_RESOURCES.map((r) => ({
      uri: r.uri,
      name: r.name,
      description: r.description,
      mimeType: r.mimeType,
    })),
  }));
  server.setRequestHandler(ListResourceTemplatesRequestSchema, async () => ({
    resourceTemplates: RESOURCE_TEMPLATES.map((t) => ({
      uriTemplate: t.uriTemplate,
      name: t.name,
      description: t.description,
      mimeType: t.mimeType,
    })),
  }));

  // resources/read
  server.setRequestHandler(ReadResourceRequestSchema, async (req) => {
    const r = await readResource(
      req.params.uri,
      opts.apiClient,
      opts.bearerToken
    );
    return { contents: [r] };
  });

  // prompts/list and prompts/get
  server.setRequestHandler(ListPromptsRequestSchema, async () => ({
    prompts: PROMPTS.map((p) => ({
      name: p.name,
      description: p.description,
      arguments: p.arguments,
    })),
  }));
  server.setRequestHandler(GetPromptRequestSchema, async (req) => {
    const p = PROMPTS.find((x) => x.name === req.params.name);
    if (!p) throw new Error(`Unknown prompt: ${req.params.name}`);
    const text = p.render(
      (req.params.arguments ?? {}) as Record<string, string>
    );
    return {
      messages: [{ role: "user", content: { type: "text", text } }],
    };
  });

  return { server, operations, tools };
}
