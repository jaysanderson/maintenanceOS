import type { OpenApiOperation, OpenApiParam } from "./openapi.js";

type JsonSchema = Record<string, unknown>;

/** Build an object schema from in:path or in:query parameters. */
function objectFromParams(params: OpenApiParam[]): JsonSchema | undefined {
  if (params.length === 0) return undefined;
  const properties: Record<string, JsonSchema> = {};
  const required: string[] = [];
  for (const p of params) {
    properties[p.name] = {
      ...(p.schema ?? { type: "string" }),
      ...(p.description ? { description: p.description } : {}),
    };
    if (p.required) required.push(p.name);
  }
  return {
    type: "object",
    properties,
    ...(required.length ? { required } : {}),
    additionalProperties: false,
  };
}

/**
 * MCP tools take a single inputSchema. We wrap an operation's path /
 * query / body schemas as `{ path?, query?, body? }` so they never
 * collide and `required` is preserved.
 */
export function buildInputSchema(op: OpenApiOperation): JsonSchema {
  const path = objectFromParams(op.pathParams);
  const query = objectFromParams(op.queryParams);
  const body = op.bodySchema;
  const properties: Record<string, JsonSchema> = {};
  const required: string[] = [];

  if (path) {
    properties.path = path;
    required.push("path");
  }
  if (query) {
    properties.query = query;
  }
  if (body) {
    properties.body = body;
    if (op.bodyRequired) required.push("body");
  }
  return {
    type: "object",
    properties,
    ...(required.length ? { required } : {}),
    additionalProperties: false,
  };
}
