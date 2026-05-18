import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { prisma } from "../prisma.js";
import { requireRole } from "../auth-guard.js";
import { ADMIN_ROLES } from "../lib/auth.js";

const listQuery = z.object({
  page: z.coerce.number().int().positive().optional(),
  pageSize: z.coerce.number().int().positive().optional(),
  action: z.string().optional(),
  entity: z.string().optional(),
});

export async function auditRoutes(app: FastifyInstance) {
  app.get(
    "/",
    {
      schema: { tags: ["Audit"], summary: "Recent audit log, filterable & paginated (Admin/Manager)", querystring: listQuery },
      preHandler: requireRole(...ADMIN_ROLES),
    },
    async (req) => {
      const { page, pageSize, action, entity } =
        req.query as z.infer<typeof listQuery>;
      const take = Math.min(pageSize || 50, 200);
      const skip = (Math.max(page || 1, 1) - 1) * take;
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
      return { data, total, page: page || 1, pageSize: take };
    }
  );
}
