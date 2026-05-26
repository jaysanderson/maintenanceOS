import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { requireRole } from "../auth-guard.js";
import { ADMIN_ROLES } from "../lib/auth.js";
import { getCompanyConfig, updateCompanyConfig } from "../lib/config.js";
import { audit } from "../lib/audit.js";

const putSchema = z.object({
  companyName: z.string().min(1).optional(),
  abn: z.string().optional(),
  email: z.string().email().optional(),
  phone: z.string().optional(),
  address: z.string().optional(),
  gstRate: z.number().min(0).max(1).optional(),
  marginRiskThreshold: z.number().min(0).max(1).optional(),
  defaultPaymentTerms: z.string().optional(),
  aiConfidenceThreshold: z.number().min(0).max(1).optional(),
  /**
   * Enable anonymous /mcp access (acts as mcpPublicUserId, falls back to
   * the toggling user). For test/demo only — exposes ERP data without
   * authentication. Default false.
   */
  mcpPublicAccess: z.boolean().optional(),
  mcpPublicUserId: z.string().nullable().optional(),
});

export async function settingsRoutes(app: FastifyInstance) {
  app.get(
    "/",
    { schema: { tags: ["Settings"], summary: "Company & finance settings" } },
    async () => getCompanyConfig()
  );

  app.put(
    "/",
    {
      schema: { tags: ["Settings"], summary: "Update settings (Admin/Manager)", body: putSchema },
      preHandler: requireRole(...ADMIN_ROLES),
    },
    async (req) => {
      const body = req.body as z.infer<typeof putSchema>;
      // When the user toggles public-MCP on without naming a user,
      // default the public identity to themselves so anonymous /mcp calls
      // inherit their (admin) role. They can change this later.
      const resolvedPublicUserId =
        body.mcpPublicAccess === true && body.mcpPublicUserId === undefined
          ? req.authUser.id
          : body.mcpPublicUserId;

      await updateCompanyConfig({
        "company.name": body.companyName,
        "company.abn": body.abn,
        "company.email": body.email,
        "company.phone": body.phone,
        "company.address": body.address,
        "finance.gstRate":
          body.gstRate !== undefined ? String(body.gstRate) : undefined,
        "finance.marginRiskThreshold":
          body.marginRiskThreshold !== undefined
            ? String(body.marginRiskThreshold)
            : undefined,
        "finance.defaultPaymentTerms": body.defaultPaymentTerms,
        "ai.confidenceThreshold":
          body.aiConfidenceThreshold !== undefined
            ? String(body.aiConfidenceThreshold)
            : undefined,
        "mcp.publicAccess":
          body.mcpPublicAccess !== undefined
            ? String(body.mcpPublicAccess)
            : undefined,
        "mcp.publicUserId":
          resolvedPublicUserId === null
            ? ""
            : resolvedPublicUserId,
      });
      await audit(req.authUser, {
        action: "SETTINGS_UPDATED",
        entity: "AppSetting",
        summary: `${req.authUser.email} updated company/finance settings`,
        meta: body,
      });
      return getCompanyConfig();
    }
  );
}
