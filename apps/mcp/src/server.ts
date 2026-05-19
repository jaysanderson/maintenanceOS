#!/usr/bin/env node
/**
 * MaintenanceOS MCP — stdio binary.
 *
 * Lets local agents (Claude Desktop, Claude Code, MCP-aware editors)
 * drive MaintenanceOS without standing up a server. The catalogue is
 * generated from the live API's `/docs/json`, and every tool call is
 * forwarded to the same REST endpoints — so RBAC, validation and audit
 * are identical to the web UI.
 *
 * Authentication (set via env):
 *   MOS_API_URL          base URL of the MaintenanceOS API (required)
 *   MOS_API_TOKEN        long-lived JWT (preferred for demos)
 *   MOS_EMAIL            email — used with MOS_PASSWORD if no token
 *   MOS_PASSWORD         password
 *
 * Logs go to stderr so they don't pollute the stdio JSON-RPC channel.
 */
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
  createServer,
  fetchSpec,
  fetchApiClient,
  type ApiClient,
} from "@maintenanceos/mcp-core";

function log(...args: unknown[]): void {
  // eslint-disable-next-line no-console
  console.error("[maintenanceos-mcp]", ...args);
}

interface AuthConfig {
  apiBase: string;
  token?: string;
  email?: string;
  password?: string;
}

function readConfig(): AuthConfig {
  const apiBase = process.env.MOS_API_URL?.trim();
  if (!apiBase) {
    log("FATAL: MOS_API_URL is required (e.g. https://maintenanceos.fly.dev)");
    process.exit(1);
  }
  return {
    apiBase: apiBase.replace(/\/$/, ""),
    token: process.env.MOS_API_TOKEN?.trim() || undefined,
    email: process.env.MOS_EMAIL?.trim() || undefined,
    password: process.env.MOS_PASSWORD ?? undefined,
  };
}

async function login(
  apiBase: string,
  email: string,
  password: string
): Promise<string> {
  const res = await fetch(`${apiBase}/api/auth/login`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ email, password }),
  });
  const text = await res.text();
  if (!res.ok) {
    throw new Error(`Login failed (${res.status}): ${text}`);
  }
  const json = JSON.parse(text) as { token?: string };
  if (!json.token) throw new Error("Login response missing token");
  return json.token;
}

/**
 * Wrap the base fetch-backed ApiClient so it can transparently re-login on
 * 401 (if credentials were supplied). Token mutates in place via closure.
 */
function buildAuthClient(
  cfg: AuthConfig,
  bearerRef: { current: string }
): ApiClient {
  const inner = fetchApiClient(cfg.apiBase);
  return async (req) => {
    const headers = { ...req.headers };
    if (bearerRef.current) {
      headers["authorization"] = `Bearer ${bearerRef.current}`;
    }
    let res = await inner({ ...req, headers });

    if (res.status === 401 && cfg.email && cfg.password) {
      try {
        const fresh = await login(cfg.apiBase, cfg.email, cfg.password);
        bearerRef.current = fresh;
        headers["authorization"] = `Bearer ${fresh}`;
        res = await inner({ ...req, headers });
      } catch (err) {
        log("re-login failed:", (err as Error).message);
      }
    }
    return res;
  };
}

async function main(): Promise<void> {
  const cfg = readConfig();
  const bearerRef = { current: cfg.token ?? "" };

  if (!bearerRef.current) {
    if (!cfg.email || !cfg.password) {
      log(
        "FATAL: provide MOS_API_TOKEN, or MOS_EMAIL + MOS_PASSWORD to log in."
      );
      process.exit(1);
    }
    try {
      bearerRef.current = await login(cfg.apiBase, cfg.email, cfg.password);
      log("logged in as", cfg.email);
    } catch (err) {
      log("FATAL:", (err as Error).message);
      process.exit(1);
    }
  }

  log("fetching OpenAPI spec from", cfg.apiBase, "...");
  const spec = await fetchSpec(cfg.apiBase);

  const apiClient = buildAuthClient(cfg, bearerRef);

  const { server, tools } = createServer({
    name: "maintenanceos",
    version: "1.0.0",
    spec,
    apiClient,
    // bearerToken is injected per-call by buildAuthClient — leave undefined
    // so mcp-core doesn't double up the header.
  });
  log(`registered ${tools.length} tools`);

  const transport = new StdioServerTransport();
  await server.connect(transport);
  log("ready (stdio)");
}

main().catch((err) => {
  log("fatal:", err);
  process.exit(1);
});
