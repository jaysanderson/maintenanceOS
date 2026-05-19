# MaintenanceOS MCP

MaintenanceOS speaks **MCP** (Model Context Protocol). Any MCP-aware agent
— Claude Desktop, Claude Code, an n8n node, a custom Anthropic SDK app, an
ARAG retrieval agent — can drive the ERP as a system-of-record: read jobs,
quote, dispatch, complete, invoice, run reports.

There is **one MCP server** for MaintenanceOS, exposed in two ways:

| Transport          | URL / command                                       | Use when                              |
| ------------------ | --------------------------------------------------- | ------------------------------------- |
| **Streamable HTTP** | `https://maintenanceos.fly.dev/mcp`                | Hosted agents, n8n, remote tooling     |
| **stdio**          | `npx @maintenanceos/mcp` (or `node dist/server.js`) | Claude Desktop / Code on your laptop   |

Both share the same code (`packages/mcp-core`) and the same tool catalogue.

---

## How the tool catalogue is built

**Tools are not hand-curated.** On startup, the MCP layer reads the API's
own OpenAPI document (`/docs/json`) and turns each operation into a tool.
That guarantees the agent surface can never drift from the REST API.

The catalogue **excludes**:

- All `DELETE` operations (irreversible)
- Everything under `/api/system/*` (demo reset, DB backup)
- Binary endpoints (PDF download, attachment download, multipart upload)
- `POST /api/auth/login` (the agent is already authenticated)

Net result: ~60 tools covering accounts, sites, work orders, quotes,
invoices, inventory, employees, vehicles, assets, reports and recurring
plans — read **+ write, no destructive**.

### Tool naming convention

```
GET    /api/accounts/                 → accounts_list_accounts
GET    /api/accounts/{id}             → accounts_get_accounts
POST   /api/accounts/                 → accounts_create_accounts
PUT    /api/accounts/{id}             → accounts_update_accounts
PATCH  /api/work-orders/{id}/status   → work_orders_status
POST   /api/quotes/{id}/approve       → quotes_approve
```

Every tool's `inputSchema` wraps the operation's path / query / body
parameters into a single object:

```json
{
  "path":  { "id": "wo_abc" },
  "query": { "limit": 10 },
  "body":  { "title": "Fix tap", "jobType": "REPAIR" }
}
```

Path is required when present; body is required if the OpenAPI marks it so.

---

## Resources

Read-only context the agent can attach without invoking a tool.

| URI                                          | Returns                                                |
| -------------------------------------------- | ------------------------------------------------------ |
| `maintenanceos://openapi`                    | Full OpenAPI 3 document                                |
| `maintenanceos://dashboard`                  | Live KPIs (open jobs, SLA breaches, revenue, margin)   |
| `maintenanceos://work-order/{id}`            | A single work order with all its joins                 |
| `maintenanceos://account/{id}`               | An account with sites, work orders, invoices           |

## Prompts

Curated workflows the agent can launch into.

| Name                          | Args            | What it does                                                                 |
| ----------------------------- | --------------- | ---------------------------------------------------------------------------- |
| `triage-work-order`           | `workOrderId`   | Classify a job (type, priority, skills) and recommend the dispatch action.   |
| `draft-quote-from-history`    | `workOrderId`   | Draft a quote anchored to comparable historical jobs.                        |
| `daily-operations-briefing`   | —               | Manager-style morning briefing of SLA, unassigned, margin, low stock.        |

---

## Authentication

MCP carries the **same JWT** as the REST API. There is no separate MCP
account — RBAC roles (Admin, Manager, Supervisor, Dispatcher, Technician)
apply to MCP tool calls exactly as they apply to the web UI. A tool call
that would 403 against `/api/*` returns `isError: true` with the same
`{error,details}` body.

### Getting a JWT

```bash
curl -s https://maintenanceos.fly.dev/api/auth/login \
  -H 'content-type: application/json' \
  -d '{"email":"admin@maintenanceos.com.au","password":"demo1234"}' \
  | jq -r .token
```

Demo passwords are all `demo1234`. Use whichever role you want the agent
to operate as:

- `admin@maintenanceos.com.au`     — full access
- `manager@maintenanceos.com.au`   — full operational + financial
- `supervisor@maintenanceos.com.au`— field operations
- `dispatch@maintenanceos.com.au`  — scheduling & assignment
- `tech@maintenanceos.com.au`      — own work only

---

## Connecting Claude Desktop / Claude Code (stdio)

```bash
# From a checkout of this repo
npm install
npm run build

# Get a token (or use MOS_EMAIL + MOS_PASSWORD for auto-login)
TOKEN=$(curl -s https://maintenanceos.fly.dev/api/auth/login \
  -H 'content-type: application/json' \
  -d '{"email":"admin@maintenanceos.com.au","password":"demo1234"}' \
  | jq -r .token)

# Wire into Claude Code
claude mcp add maintenanceos -- \
  env MOS_API_URL=https://maintenanceos.fly.dev MOS_API_TOKEN="$TOKEN" \
  node /absolute/path/to/MaintenanceOS/apps/mcp/dist/server.js
```

For Claude Desktop, edit `~/Library/Application Support/Claude/claude_desktop_config.json`:

```json
{
  "mcpServers": {
    "maintenanceos": {
      "command": "node",
      "args": ["/absolute/path/to/MaintenanceOS/apps/mcp/dist/server.js"],
      "env": {
        "MOS_API_URL": "https://maintenanceos.fly.dev",
        "MOS_API_TOKEN": "<paste JWT here>"
      }
    }
  }
}
```

### stdio env vars

| Env             | Purpose                                                      |
| --------------- | ------------------------------------------------------------ |
| `MOS_API_URL`   | Required. Base URL of the MaintenanceOS API.                 |
| `MOS_API_TOKEN` | Long-lived JWT. Preferred for demos.                         |
| `MOS_EMAIL`     | Used with `MOS_PASSWORD` if no token (auto-login + refresh). |
| `MOS_PASSWORD`  | (see above)                                                  |

If both are set, `MOS_API_TOKEN` wins. With `MOS_EMAIL` + `MOS_PASSWORD`,
the binary auto-logs-in at boot and transparently re-logs-in on 401.

---

## Connecting a hosted agent (Streamable HTTP)

Endpoint: `POST https://maintenanceos.fly.dev/mcp`

Headers:

```
content-type:        application/json
accept:              application/json, text/event-stream
authorization:       Bearer <jwt>
mcp-protocol-version: 2025-03-26
```

Body: a JSON-RPC 2.0 frame (`initialize`, `tools/list`, `tools/call`, etc.).

The server runs in **stateless mode** — no session ID, each request is
independent. That's the right shape for serverless / scale-out agents.

For n8n, set the URL + headers above in the MCP node. For the Anthropic
SDK, point your MCP client at the URL with the same headers.

---

## Smoke test

```bash
# Health check
curl -s https://maintenanceos.fly.dev/health

# List tools
TOKEN=$(curl -s https://maintenanceos.fly.dev/api/auth/login \
  -H 'content-type: application/json' \
  -d '{"email":"admin@maintenanceos.com.au","password":"demo1234"}' \
  | jq -r .token)

curl -sN https://maintenanceos.fly.dev/mcp \
  -H "authorization: Bearer $TOKEN" \
  -H "content-type: application/json" \
  -H "accept: application/json, text/event-stream" \
  -H "mcp-protocol-version: 2025-03-26" \
  -d '{"jsonrpc":"2.0","id":1,"method":"tools/list"}'
```

---

## Architecture

```
Claude / agent ──stdio──▶ apps/mcp (binary)            ─┐
n8n / remote   ──HTTP───▶ POST /mcp (Fastify route)    ─┤
                                                         ├─▶ packages/mcp-core
                                                         │    (OpenAPI → tools,
                                                         │     dispatch, prompts)
                                                         │
                                                         ▼
                                            REST /api/* (same Fastify app —
                                            shared auth + RBAC + audit)
```

MCP never touches the database. Every tool call dispatches to the same
REST endpoints, so audit logging, validation, status-transition rules and
RBAC are all applied uniformly — whether the actor is a human in the web
app or an agent in Claude.
