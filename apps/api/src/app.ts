import Fastify, { type FastifyInstance } from "fastify";
import cors from "@fastify/cors";
import helmet from "@fastify/helmet";
import rateLimit from "@fastify/rate-limit";
import jwt from "@fastify/jwt";
import multipart from "@fastify/multipart";
import fastifyStatic from "@fastify/static";
import swagger from "@fastify/swagger";
import swaggerUi from "@fastify/swagger-ui";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { existsSync } from "node:fs";
import {
  serializerCompiler,
  validatorCompiler,
  jsonSchemaTransform,
  ResponseValidationError,
} from "fastify-type-provider-zod";
import { ApiError } from "./lib/errors.js";
import { ZodError } from "zod";
import { JWT_SECRET, ADMIN_ROLES } from "./lib/auth.js";
import { requireAuth } from "./auth-guard.js";

import { authRoutes } from "./routes/auth.js";
import { accessTokenRoutes } from "./routes/access-tokens.js";
import { dashboardRoutes } from "./routes/dashboard.js";
import { accountRoutes } from "./routes/accounts.js";
import { siteRoutes } from "./routes/sites.js";
import { employeeRoutes } from "./routes/employees.js";
import { skillRoutes } from "./routes/skills.js";
import { workOrderRoutes } from "./routes/workOrders.js";
import { quoteRoutes } from "./routes/quotes.js";
import { inventoryRoutes } from "./routes/inventory.js";
import { supplierRoutes } from "./routes/suppliers.js";
import { purchaseOrderRoutes } from "./routes/purchaseOrders.js";
import { supplierBillRoutes } from "./routes/supplierBills.js";
import { invoiceRoutes } from "./routes/invoices.js";
import { vehicleRoutes } from "./routes/vehicles.js";
import { assetRoutes } from "./routes/assets.js";
import { reportRoutes } from "./routes/reports.js";
import { settingsRoutes } from "./routes/settings.js";
import { auditRoutes } from "./routes/audit.js";
import { systemRoutes } from "./routes/system.js";
import { attachmentRoutes } from "./routes/attachments.js";
import { notificationRoutes } from "./routes/notifications.js";
import { recurringRoutes } from "./routes/recurring.js";
import { aiRoutes } from "./routes/ai.js";
import { mcpPlugin } from "./mcp.js";

export async function buildApp(): Promise<FastifyInstance> {
  const app = Fastify({
    logger: { level: process.env.LOG_LEVEL ?? "info" },
    bodyLimit: 1_048_576, // 1 MB
  });

  // Zod is the single source of truth: route `schema` Zod objects drive
  // request validation AND the OpenAPI doc (via jsonSchemaTransform).
  app.setValidatorCompiler(validatorCompiler);
  app.setSerializerCompiler(serializerCompiler);

  await app.register(helmet, { contentSecurityPolicy: false });

  const corsOrigin = process.env.CORS_ORIGIN
    ? process.env.CORS_ORIGIN.split(",").map((s) => s.trim())
    : process.env.NODE_ENV === "production"
      ? ["http://localhost:5173"]
      : true;
  await app.register(cors, { origin: corsOrigin, credentials: true });

  await app.register(rateLimit, {
    max: Number(process.env.RATE_LIMIT_MAX ?? 300),
    timeWindow: "1 minute",
    allowList: (req) => req.url === "/health",
  });

  await app.register(jwt, { secret: JWT_SECRET });
  await app.register(multipart, { limits: { fileSize: 10 * 1024 * 1024 } });

  await app.register(swagger, {
    openapi: {
      info: {
        title: "MaintenanceOS API",
        version: "1.0.0",
        description: [
          "**API-first ERP for a mid-sized property & handyman maintenance business.**",
          "",
          "The whole product is built on this API — the web app only ever talks to these endpoints, never the database.",
          "",
          "### Core flow",
          "`Account → Site → Work Order → Quote → Approval → Schedule → Technician Assignment → Job Completion → Invoice → Job Margin`",
          "",
          "### Authentication",
          "All `/api/*` routes require a JWT **except** `POST /api/auth/login`.",
          "1. `POST /api/auth/login` with a demo account to get a token.",
          "2. Click **Authorize** (top right) and paste the token.",
          "",
          "Demo logins (password `demo1234`): `admin@`, `manager@`, `supervisor@`, `dispatch@`, `tech@maintenanceos.com.au`. Roles are enforced: deletes & destructive/admin actions require Admin/Manager.",
          "",
          "### Conventions",
          "- List endpoints support `q` (search), `limit`, `offset`; total count is returned in the `X-Total-Count` header.",
          "- Errors use a consistent shape: `{ \"error\": string, \"details\"?: any }` (see the `ErrorResponse` schema). Common codes: `400` validation, `401` unauthenticated, `403` forbidden (role), `404` not found, `409` conflict (e.g. delete with dependents), `429` rate-limited.",
          "- Money is AUD; GST is configurable in Settings (default 10%). Totals are always computed server-side.",
        ].join("\n"),
        contact: { name: "MaintenanceOS", url: "https://maintenanceos.fly.dev" },
      },
      servers: [
        { url: "https://maintenanceos.fly.dev", description: "Production (Fly.io demo)" },
        { url: "http://localhost:4000", description: "Local development" },
      ],
      components: {
        securitySchemes: {
          bearerAuth: {
            type: "http",
            scheme: "bearer",
            bearerFormat: "JWT",
            description:
              "Paste the `token` from `POST /api/auth/login` (no 'Bearer ' prefix needed here).",
          },
        },
        schemas: {
          ErrorResponse: {
            type: "object",
            description: "Standard error envelope returned by every endpoint on failure.",
            properties: {
              error: { type: "string", example: "Validation failed" },
              details: {
                description:
                  "Optional extra context (e.g. Zod field errors for 400s).",
                nullable: true,
              },
            },
            required: ["error"],
          },
        },
      },
      security: [{ bearerAuth: [] }],
      tags: [
        { name: "Auth", description: "Log in and obtain a JWT; inspect the current user. Start here." },
        { name: "Dashboard", description: "Aggregated operational KPIs for the home dashboard (open jobs, SLA breaches, revenue, margin, low stock, etc.)." },
        { name: "Accounts", description: "Customers — real estate agencies, councils, schools, body corporates, aged-care, commercial, homeowners. List supports search & pagination." },
        { name: "Sites", description: "Physical properties belonging to an account. Work orders are raised against a site." },
        { name: "Employees", description: "Field & office staff: role, employment type, territory, hourly cost (drives job costing) and skills." },
        { name: "Skills", description: "Skill/clearance catalogue and assignment to employees (e.g. White Card, Working at Heights, Aged-care clearance)." },
        { name: "Work Orders", description: "The heart of the system. Lifecycle, scheduling, assignment, completion, status transitions (validated), timesheets and job costing." },
        { name: "Quotes", description: "Priced quotes for a work order. Subtotal/GST/total computed server-side; approving a quote advances the work order." },
        { name: "Inventory", description: "Items, locations (warehouse/van), stock levels and movements; low-stock against reorder points." },
        { name: "Suppliers", description: "Vendors used for purchase orders." },
        { name: "Purchase Orders", description: "Stock ordering and receiving (receipt updates inventory)." },
        { name: "Invoices", description: "Billing generated from completed work / approved quotes; status, overdue tracking, PDF." },
        { name: "Vehicles", description: "Fleet vehicles with service/registration due tracking." },
        { name: "Assets", description: "Tools, trailers, machines and safety equipment, with assignment and service due." },
        { name: "Reports", description: "Operational analytics: revenue & margin by month, SLA breaches, technician utilisation, margin leakage, low stock." },
        { name: "Settings", description: "Company profile & finance config (GST rate, margin-risk threshold). Editing requires Admin/Manager." },
        { name: "Audit", description: "Append-only log of significant actions (Admin/Manager)." },
        { name: "System", description: "Demo controls: reset to seeded demo data, database backups (Admin/Manager)." },
        { name: "Attachments", description: "Upload/download photos & documents against a work order (before/after, signed docs)." },
        { name: "Notifications", description: "In-app operational notifications and read state." },
        { name: "Recurring", description: "Contract/recurring maintenance plans that auto-generate work orders." },
        { name: "AI", description: "Progress Agentic RAG features: grounded Knowledge Copilot Q&A, search, and agent-backed workflows." },
      ],
    },
    transform: jsonSchemaTransform,
  });
  await app.register(swaggerUi, {
    routePrefix: "/docs",
    uiConfig: { docExpansion: "list", deepLinking: true, displayRequestDuration: true },
  });

  app.get("/health", { schema: { hide: true } }, async () => ({
    status: "ok",
    service: "maintenanceos-api",
  }));

  app.setErrorHandler((error, _req, reply) => {
    if (error instanceof ApiError) {
      return reply
        .status(error.statusCode)
        .send({ error: error.message, details: error.details });
    }
    // Request validation failures from the Zod type provider (or any Zod
    // thrown in a handler) → our standard { error, details } shape.
    const zerr =
      error instanceof ZodError
        ? error
        : ((error as { cause?: unknown }).cause instanceof ZodError
            ? ((error as { cause: ZodError }).cause)
            : null);
    if (zerr) {
      return reply
        .status(400)
        .send({ error: "Validation failed", details: zerr.flatten() });
    }
    if (
      (error as { code?: string }).code === "FST_ERR_VALIDATION" ||
      Array.isArray((error as { validation?: unknown }).validation)
    ) {
      return reply.status(400).send({
        error: "Validation failed",
        details: (error as { validation?: unknown }).validation ?? error.message,
      });
    }
    // Response serialization mismatch (a route's response schema is wrong).
    if (error instanceof ResponseValidationError) {
      app.log.error({ err: error }, "response serialization failed");
      return reply.status(500).send({ error: "Internal server error" });
    }
    if ((error as { statusCode?: number }).statusCode === 429) {
      return reply.status(429).send({ error: "Too many requests" });
    }
    app.log.error(error);
    return reply.status(500).send({ error: "Internal server error" });
  });

  // Path to the built web SPA (apps/web/dist). At runtime this compiled file
  // is apps/api/dist/src/app.js, so the web build is ../../../web/dist.
  // Overridable via WEB_DIST.
  const here = dirname(fileURLToPath(import.meta.url));
  const webDist =
    process.env.WEB_DIST ?? join(here, "..", "..", "..", "web", "dist");
  const serveSpa = existsSync(join(webDist, "index.html"));

  if (serveSpa) {
    await app.register(fastifyStatic, { root: webDist, wildcard: false });
  }

  // API/docs/health 404 as JSON; any other GET falls back to the SPA shell so
  // client-side routes and deep links work (login, /work-orders/:id, etc.).
  app.setNotFoundHandler((req, reply) => {
    const path = req.url.split("?")[0];
    const isApi =
      path.startsWith("/api") ||
      path.startsWith("/docs") ||
      path === "/health" ||
      path === "/mcp";
    if (serveSpa && !isApi && req.method === "GET") {
      return reply.type("text/html").sendFile("index.html");
    }
    return reply.status(404).send({ error: "Route not found" });
  });

  const api = async (instance: FastifyInstance) => {
    // Authenticate every /api route (login is exempted inside requireAuth).
    instance.addHook("onRequest", requireAuth);
    // Destructive deletes require an elevated role, enforced centrally.
    instance.addHook("onRequest", async (req) => {
      if (req.method === "DELETE" && req.authUser && !ADMIN_ROLES.includes(req.authUser.role)) {
        throw new ApiError(403, "Only Admin/Manager can delete records");
      }
    });

    await instance.register(authRoutes, { prefix: "/auth" });
    await instance.register(accessTokenRoutes, { prefix: "/access-tokens" });
    await instance.register(dashboardRoutes, { prefix: "/dashboard" });
    await instance.register(accountRoutes, { prefix: "/accounts" });
    await instance.register(siteRoutes, { prefix: "/sites" });
    await instance.register(employeeRoutes, { prefix: "/employees" });
    await instance.register(skillRoutes);
    await instance.register(workOrderRoutes, { prefix: "/work-orders" });
    await instance.register(quoteRoutes, { prefix: "/quotes" });
    await instance.register(inventoryRoutes, { prefix: "/inventory" });
    await instance.register(supplierRoutes, { prefix: "/suppliers" });
    await instance.register(purchaseOrderRoutes, { prefix: "/purchase-orders" });
    await instance.register(supplierBillRoutes, { prefix: "/supplier-bills" });
    await instance.register(invoiceRoutes, { prefix: "/invoices" });
    await instance.register(vehicleRoutes, { prefix: "/vehicles" });
    await instance.register(assetRoutes, { prefix: "/assets" });
    await instance.register(reportRoutes, { prefix: "/reports" });
    await instance.register(settingsRoutes, { prefix: "/settings" });
    await instance.register(auditRoutes, { prefix: "/audit" });
    await instance.register(systemRoutes, { prefix: "/system" });
    await instance.register(attachmentRoutes);
    await instance.register(notificationRoutes, { prefix: "/notifications" });
    await instance.register(recurringRoutes, { prefix: "/recurring" });
    await instance.register(aiRoutes, { prefix: "/ai" });
  };

  await app.register(api, { prefix: "/api" });

  // Hosted MCP transport — mounted OUTSIDE `/api` so it's exempt from the
  // /api JWT hook (the MCP plugin reads its own `Authorization` header and
  // forwards it on each tool call). Registered AFTER /api so app.swagger()
  // sees every route when the tool catalogue is generated.
  await app.register(mcpPlugin);

  return app;
}
