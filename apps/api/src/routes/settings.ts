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
