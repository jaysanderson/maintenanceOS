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
import { ApiError } from "./lib/errors.js";
import { ZodError } from "zod";
import { JWT_SECRET, ADMIN_ROLES } from "./lib/auth.js";
import { requireAuth } from "./auth-guard.js";

import { authRoutes } from "./routes/auth.js";
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

export async function buildApp(): Promise<FastifyInstance> {
  const app = Fastify({
    logger: { level: process.env.LOG_LEVEL ?? "info" },
    bodyLimit: 1_048_576, // 1 MB
  });

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
        description:
          "API-first ERP for a property maintenance business. Account → Site → Work Order → Quote → Approval → Schedule → Assignment → Completion → Invoice → Margin. Authenticated; send 'Authorization: Bearer <token>'.",
        version: "1.0.0",
      },
      components: {
        securitySchemes: {
          bearerAuth: { type: "http", scheme: "bearer", bearerFormat: "JWT" },
        },
      },
      security: [{ bearerAuth: [] }],
      tags: [
        { name: "Auth" },
        { name: "Dashboard" },
        { name: "Accounts" },
        { name: "Sites" },
        { name: "Employees" },
        { name: "Skills" },
        { name: "Work Orders" },
        { name: "Quotes" },
        { name: "Inventory" },
        { name: "Suppliers" },
        { name: "Purchase Orders" },
        { name: "Invoices" },
        { name: "Vehicles" },
        { name: "Assets" },
        { name: "Reports" },
        { name: "Settings" },
        { name: "Audit" },
        { name: "System" },
        { name: "Attachments" },
        { name: "Notifications" },
        { name: "Recurring" },
      ],
    },
  });
  await app.register(swaggerUi, { routePrefix: "/docs" });

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
    if (error instanceof ZodError) {
      return reply
        .status(400)
        .send({ error: "Validation failed", details: error.flatten() });
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
      path === "/health";
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
  };

  await app.register(api, { prefix: "/api" });

  return app;
}
