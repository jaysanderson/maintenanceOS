import { describe, it, expect, beforeAll, afterAll } from "vitest";
import type { FastifyInstance } from "fastify";
import { buildApp } from "../dist/src/app.js";

let app: FastifyInstance;
let adminToken = "";

async function login(email: string, password: string) {
  const res = await app.inject({
    method: "POST",
    url: "/api/auth/login",
    payload: { email, password },
  });
  return res;
}

const auth = (t: string) => ({ authorization: `Bearer ${t}` });

beforeAll(async () => {
  app = await buildApp();
  await app.ready();
  const res = await login("admin@maintenanceos.com.au", "demo1234");
  adminToken = res.json().token;
});

afterAll(async () => {
  await app.close();
});

describe("auth & security", () => {
  it("health is public", async () => {
    const res = await app.inject({ method: "GET", url: "/health" });
    expect(res.statusCode).toBe(200);
  });

  it("rejects unauthenticated API access", async () => {
    const res = await app.inject({ method: "GET", url: "/api/accounts" });
    expect(res.statusCode).toBe(401);
  });

  it("rejects bad credentials", async () => {
    const res = await login("admin@maintenanceos.com.au", "wrong");
    expect(res.statusCode).toBe(401);
  });

  it("issues a token for valid credentials", async () => {
    expect(adminToken).toBeTruthy();
  });

  it("allows authenticated access", async () => {
    const res = await app.inject({
      method: "GET",
      url: "/api/accounts",
      headers: auth(adminToken),
    });
    expect(res.statusCode).toBe(200);
    expect(Array.isArray(res.json())).toBe(true);
  });
});

describe("RBAC", () => {
  it("technician cannot delete or reset", async () => {
    const t = (await login("tech@maintenanceos.com.au", "demo1234")).json()
      .token;
    const accs = await app.inject({
      method: "GET",
      url: "/api/accounts",
      headers: auth(t),
    });
    const id = accs.json()[0].id;
    const del = await app.inject({
      method: "DELETE",
      url: `/api/accounts/${id}`,
      headers: auth(t),
    });
    expect(del.statusCode).toBe(403);

    const reset = await app.inject({
      method: "POST",
      url: "/api/system/reset",
      headers: auth(t),
      payload: { confirm: true },
    });
    expect(reset.statusCode).toBe(403);
  });
});

describe("core ERP flow", () => {
  it("account → site → WO → quote → approve → complete → invoice → costing", async () => {
    const h = auth(adminToken);

    const account = (
      await app.inject({
        method: "POST",
        url: "/api/accounts",
        headers: h,
        payload: { name: "Test Co", type: "COMMERCIAL" },
      })
    ).json();
    expect(account.id).toBeTruthy();

    const site = (
      await app.inject({
        method: "POST",
        url: "/api/sites",
        headers: h,
        payload: {
          accountId: account.id,
          name: "Site 1",
          address: "1 St",
          suburb: "Bendigo",
          state: "VIC",
          postcode: "3550",
        },
      })
    ).json();

    const wo = (
      await app.inject({
        method: "POST",
        url: "/api/work-orders",
        headers: h,
        payload: {
          accountId: account.id,
          siteId: site.id,
          title: "Fix tap",
          jobType: "REPAIR",
        },
      })
    ).json();
    expect(wo.workOrderNumber).toMatch(/^WO-/);

    // invalid status transition is rejected
    const bad = await app.inject({
      method: "PATCH",
      url: `/api/work-orders/${wo.id}/status`,
      headers: h,
      payload: { status: "INVOICED" },
    });
    expect(bad.statusCode).toBe(400);

    const quote = (
      await app.inject({
        method: "POST",
        url: "/api/quotes",
        headers: h,
        payload: {
          workOrderId: wo.id,
          labourHours: 4,
          labourRate: 110,
          materialCost: 150,
          marginPercent: 25,
        },
      })
    ).json();
    expect(quote.gst).toBeCloseTo(quote.subtotal * 0.1, 1);

    await app.inject({
      method: "POST",
      url: `/api/quotes/${quote.id}/approve`,
      headers: h,
    });
    const woAfter = (
      await app.inject({
        method: "GET",
        url: `/api/work-orders/${wo.id}`,
        headers: h,
      })
    ).json();
    expect(woAfter.status).toBe("APPROVED");

    await app.inject({
      method: "POST",
      url: `/api/work-orders/${wo.id}/complete`,
      headers: h,
      payload: { actualHours: 5, completionNotes: "done" },
    });

    const invoice = (
      await app.inject({
        method: "POST",
        url: `/api/invoices/from-work-order/${wo.id}`,
        headers: h,
      })
    ).json();
    expect(invoice.invoiceNumber).toMatch(/^INV-/);

    const costing = (
      await app.inject({
        method: "GET",
        url: `/api/work-orders/${wo.id}/costing`,
        headers: h,
      })
    ).json();
    expect(costing).toHaveProperty("grossMarginPercent");
  });
});

describe("MCP transport", () => {
  // Stateless Streamable-HTTP MCP. We post JSON-RPC frames straight at
  // /mcp and assert the JSON body of the response. The MCP SDK uses SSE
  // framing under the hood — Fastify's app.inject returns the full text,
  // which always contains `"jsonrpc":"2.0"` in any successful response.

  const rpc = (id: number, method: string, params?: unknown) => ({
    jsonrpc: "2.0",
    id,
    method,
    ...(params !== undefined ? { params } : {}),
  });

  const mcpHeaders = (token: string) => ({
    authorization: `Bearer ${token}`,
    "content-type": "application/json",
    accept: "application/json, text/event-stream",
    "mcp-protocol-version": "2025-03-26",
  });

  // Parse JSON-RPC out of either application/json or SSE-framed responses.
  const parseRpc = (body: string) => {
    const trimmed = body.trim();
    if (trimmed.startsWith("{")) return JSON.parse(trimmed);
    // SSE: lines like `event: message\ndata: { ... }\n\n`
    const dataLine = trimmed
      .split("\n")
      .find((l) => l.startsWith("data:"));
    if (!dataLine) throw new Error(`No JSON-RPC body in: ${trimmed}`);
    return JSON.parse(dataLine.slice(5).trim());
  };

  it("tools/list returns the auto-generated tool catalogue", async () => {
    // Initialise then list
    await app.inject({
      method: "POST",
      url: "/mcp",
      headers: mcpHeaders(adminToken),
      payload: rpc(1, "initialize", {
        protocolVersion: "2025-03-26",
        capabilities: {},
        clientInfo: { name: "vitest", version: "1.0.0" },
      }),
    });
    const res = await app.inject({
      method: "POST",
      url: "/mcp",
      headers: mcpHeaders(adminToken),
      payload: rpc(2, "tools/list"),
    });
    expect(res.statusCode).toBe(200);
    const parsed = parseRpc(res.body);
    expect(parsed.result?.tools).toBeDefined();
    const names = parsed.result.tools.map((t: { name: string }) => t.name);
    expect(names.length).toBeGreaterThan(20);
    // Excludes DELETE and /api/system/* tools
    expect(names.some((n: string) => n.includes("delete"))).toBe(false);
    expect(names.some((n: string) => n.startsWith("system_"))).toBe(false);
    // Includes the obvious read + write candidates
    expect(names).toContain("dashboard_list_summary");
  });

  it("tools/call hits the REST layer and returns JSON", async () => {
    await app.inject({
      method: "POST",
      url: "/mcp",
      headers: mcpHeaders(adminToken),
      payload: rpc(1, "initialize", {
        protocolVersion: "2025-03-26",
        capabilities: {},
        clientInfo: { name: "vitest", version: "1.0.0" },
      }),
    });
    const res = await app.inject({
      method: "POST",
      url: "/mcp",
      headers: mcpHeaders(adminToken),
      payload: rpc(2, "tools/call", {
        name: "dashboard_list_summary",
        arguments: {},
      }),
    });
    expect(res.statusCode).toBe(200);
    const parsed = parseRpc(res.body);
    const text = parsed.result?.content?.[0]?.text;
    expect(text).toBeTruthy();
    const payload = JSON.parse(text);
    expect(payload).toHaveProperty("openWorkOrders");
  });

  it("tool calls inherit RBAC — technician cannot update settings", async () => {
    const t = (await login("tech@maintenanceos.com.au", "demo1234")).json()
      .token;
    await app.inject({
      method: "POST",
      url: "/mcp",
      headers: mcpHeaders(t),
      payload: rpc(1, "initialize", {
        protocolVersion: "2025-03-26",
        capabilities: {},
        clientInfo: { name: "vitest", version: "1.0.0" },
      }),
    });
    const res = await app.inject({
      method: "POST",
      url: "/mcp",
      headers: mcpHeaders(t),
      payload: rpc(2, "tools/call", {
        name: "settings_update_settings",
        arguments: { body: { companyName: "Hijacked Co" } },
      }),
    });
    expect(res.statusCode).toBe(200);
    const parsed = parseRpc(res.body);
    expect(parsed.result?.isError).toBe(true);
    expect(parsed.result?.content?.[0]?.text).toMatch(/403|permission/i);
  });
});
