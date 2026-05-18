import type { FastifyInstance } from "fastify";
import { prisma } from "../prisma.js";
import { requireRole } from "../auth-guard.js";
import { ADMIN_ROLES } from "../lib/auth.js";

export async function auditRoutes(app: FastifyInstance) {
  app.get(
    "/",
    {
      schema: { tags: ["Audit"], summary: "Recent audit log (Admin/Manager)" },
      preHandler: requireRole(...ADMIN_ROLES),
    },
    async (req) => {
      const { page = "1", pageSize = "50", action, entity } =
        req.query as Record<string, string>;
      const take = Math.min(Number(pageSize) || 50, 200);
      const skip = (Math.max(Number(page) || 1, 1) - 1) * take;
      const where = {
        ...(action ? { action } : {}),
        ...(entity ? { entity } : {}),
      };
      const [total, data] = await Promise.all([
        prisma.auditLog.count({ where }),
        prisma.auditLog.findMany({
          where,
          orderBy: { at: "desc" },
          skip,
          take,
        }),
      ]);
      return { data, total, page: Number(page) || 1, pageSize: take };
    }
  );
}
