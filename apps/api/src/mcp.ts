/**
 * Hosted MCP transport — mounts `POST /mcp` (Streamable HTTP) on the same
 * Fastify app that serves the REST API. The tool catalogue is generated
 * from this app's own OpenAPI document (via `app.swagger()`), and tool
 * invocations are dispatched in-process via `app.inject()` so the REST
 * layer's auth + RBAC + validation apply uniformly.
 *
 * Statelessness: each request creates a fresh `Server` + transport pair.
 * That keeps the hosted endpoint scale-friendly on a single Fly machine
 * and avoids any cross-tenant session state.
 */
import type { FastifyInstance, FastifyRequest, FastifyReply } from "fastify";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import {
  createServer,
  type ApiClient,
} from "@maintenanceos/mcp-core";
import { prisma } from "./prisma.js";
import { getMcpPublicAccess } from "./lib/config.js";
import type { Role } from "./lib/auth.js";

let cachedSpec: unknown | null = null;

/** Lazily resolve the OpenAPI doc the tool generator runs against. */
function getSpec(app: FastifyInstance): unknown {
  if (cachedSpec) return cachedSpec;
  // app.swagger() builds the doc from currently-registered routes.
  // The MCP plugin is registered after the /api routes, so by the time
  // a request hits /mcp the catalogue is complete.
  cachedSpec = (app as unknown as { swagger: () => unknown }).swagger();
  return cachedSpec;
}

/** Build an MCP ApiClient that routes calls back into this Fastify app. */
function injectApiClient(app: FastifyInstance): ApiClient {
  return async ({ method, url, body, headers }) => {
    const res = await app.inject({
      method: method as "GET" | "POST" | "PUT" | "PATCH" | "DELETE",
      url,
      payload: body,
      headers,
    });
    const h: Record<string, string | undefined> = {};
    for (const [k, v] of Object.entries(res.headers)) {
      h[k.toLowerCase()] = Array.isArray(v)
        ? v.join(", ")
        : v == null
          ? undefined
          : String(v);
    }
    return {
      status: res.statusCode,
      headers: h,
      text: res.body,
    };
  };
}

function extractBearer(req: FastifyRequest): string | undefined {
  const auth = req.headers["authorization"];
  if (typeof auth !== "string") return undefined;
  if (!auth.toLowerCase().startsWith("bearer ")) return undefined;
  return auth.slice(7).trim() || undefined;
}

/**
 * Fastify plugin: mounts `POST /mcp` for Streamable HTTP transport.
 * Must be registered AFTER the `/api` routes so `app.swagger()` sees them.
 */
export async function mcpPlugin(app: FastifyInstance): Promise<void> {
  // `schema: { hide: true }` keeps the MCP endpoint out of the user-facing
  // Swagger UI (it's an RPC channel, not a REST endpoint).
  app.route({
    method: ["POST"],
    url: "/mcp",
    schema: { hide: true },
    handler: async (req: FastifyRequest, reply: FastifyReply) => {
      let bearerToken = extractBearer(req);

      // Public-MCP fallback: when the caller didn't present any token,
      // check the company setting. If public access is enabled and a
      // public-user is configured, mint a short-lived JWT for that user
      // on the fly — the rest of the request then flows through the
      // normal auth path (so RBAC, audit, etc. all still apply).
      // Off by default; intended for demos.
      if (!bearerToken) {
        const pub = await getMcpPublicAccess();
        if (pub.enabled) {
          // Use the configured public user when it resolves to an active
          // account; otherwise fall back to the first active admin/manager.
          // The fallback keeps public access working after a demo-DB reseed,
          // which regenerates user ids (stale stored publicUserId).
          let user =
            (pub.userId &&
              (await prisma.user.findUnique({ where: { id: pub.userId } }))) ||
            null;
          if (!user || !user.active) {
            user = await prisma.user.findFirst({
              where: { active: true, role: { in: ["ADMIN", "MANAGER"] } },
              orderBy: { createdAt: "asc" },
            });
          }
          if (user && user.active) {
            bearerToken = (app as unknown as { jwt: { sign: (p: unknown, o: unknown) => string } }).jwt.sign(
              {
                sub: user.id,
                email: user.email,
                role: user.role as Role,
                name: user.name,
              },
              { expiresIn: "5m" }
            );
            app.log.info(
              { userId: user.id, email: user.email },
              "MCP: anonymous request, using public-access user"
            );
          }
        }
      }

      let spec: unknown;
      try {
        spec = getSpec(app);
      } catch (err) {
        app.log.error({ err }, "MCP: failed to load OpenAPI spec");
        return reply
          .status(500)
          .send({ error: "MCP transport not ready" });
      }

      const apiClient = injectApiClient(app);

      const { server } = createServer({
        name: "maintenanceos",
        version: "1.0.0",
        spec,
        apiClient,
        bearerToken,
      });

      // Stateless mode: no session ID, every request is independent.
      const transport = new StreamableHTTPServerTransport({
        sessionIdGenerator: undefined,
      });

      // Best-effort cleanup when the client hangs up.
      reply.raw.on("close", () => {
        transport.close().catch(() => {});
        server.close().catch(() => {});
      });

      await server.connect(transport);

      // Hijack Fastify's reply so the transport can write the HTTP response
      // directly (streaming JSON-RPC / SSE frames).
      reply.hijack();
      try {
        await transport.handleRequest(req.raw, reply.raw, req.body);
      } catch (err) {
        app.log.error({ err }, "MCP: transport.handleRequest failed");
        if (!reply.raw.headersSent) {
          reply.raw.statusCode = 500;
          reply.raw.end(
            JSON.stringify({ error: "MCP transport error" })
          );
        }
      }
    },
  });

  // Friendly GET /mcp for browsers and connector probes — most MCP clients
  // POST, so we just point humans at the docs.
  app.get(
    "/mcp",
    { schema: { hide: true } },
    async (_req, reply) =>
      reply.type("application/json").send({
        service: "maintenanceos-mcp",
        transport: "streamable-http",
        message:
          "POST JSON-RPC 2.0 frames to this URL with an `Authorization: Bearer <jwt>` header.",
      })
  );
}
