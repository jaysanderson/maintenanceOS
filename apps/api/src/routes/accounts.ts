import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { prisma } from "../prisma.js";
import { parse } from "../lib/validate.js";
import { notFound, conflict } from "../lib/errors.js";
import { ACCOUNT_TYPES } from "../lib/enums.js";
import { audit } from "../lib/audit.js";

const upsertSchema = z.object({
  name: z.string().min(1),
  type: z.enum(ACCOUNT_TYPES),
  primaryContactName: z.string().optional().nullable(),
  email: z.string().email().optional().nullable(),
  phone: z.string().optional().nullable(),
  billingAddress: z.string().optional().nullable(),
  accountManager: z.string().optional().nullable(),
  paymentTerms: z.string().optional().nullable(),
  notes: z.string().optional().nullable(),
});

export async function accountRoutes(app: FastifyInstance) {
  app.get("/", { schema: { tags: ["Accounts"], summary: "List accounts (search/paginate)" } }, async (req, reply) => {
    const { type, q, limit, offset } = req.query as Record<string, string | undefined>;
    const where = {
      ...(type ? { type } : {}),
      ...(q
        ? {
            OR: [
              { name: { contains: q } },
              { primaryContactName: { contains: q } },
            ],
          }
        : {}),
    };
    const total = await prisma.account.count({ where });
    reply.header("X-Total-Count", String(total));
    const accounts = await prisma.account.findMany({
      where,
      orderBy: { name: "asc" },
      include: { _count: { select: { sites: true, workOrders: true } } },
      ...(limit ? { take: Math.min(Number(limit), 500) } : {}),
      ...(offset ? { skip: Number(offset) } : {}),
    });
    return accounts;
  });

  app.get("/:id", { schema: { tags: ["Accounts"], summary: "Get account" } }, async (req) => {
    const { id } = req.params as { id: string };
    const account = await prisma.account.findUnique({
      where: { id },
      include: {
        sites: true,
        workOrders: {
          orderBy: { createdAt: "desc" },
          include: { site: true, assignedEmployee: true },
        },
        invoices: { orderBy: { createdAt: "desc" } },
      },
    });
    if (!account) throw notFound("Account");
    return account;
  });

  app.post("/", { schema: { tags: ["Accounts"], summary: "Create account" } }, async (req, reply) => {
    const data = parse(upsertSchema, req.body);
    const account = await prisma.account.create({ data });
    reply.status(201);
    return account;
  });

  app.put("/:id", { schema: { tags: ["Accounts"], summary: "Update account" } }, async (req) => {
    const { id } = req.params as { id: string };
    const data = parse(upsertSchema.partial(), req.body);
    const existing = await prisma.account.findUnique({ where: { id } });
    if (!existing) throw notFound("Account");
    return prisma.account.update({ where: { id }, data });
  });

  app.delete("/:id", { schema: { tags: ["Accounts"], summary: "Delete account" } }, async (req, reply) => {
    const { id } = req.params as { id: string };
    const existing = await prisma.account.findUnique({
      where: { id },
      include: { _count: { select: { workOrders: true, sites: true, invoices: true } } },
    });
    if (!existing) throw notFound("Account");
    if (
      existing._count.workOrders > 0 ||
      existing._count.invoices > 0 ||
      existing._count.sites > 0
    ) {
      throw conflict(
        "Cannot delete an account with sites, work orders or invoices. Archive it instead."
      );
    }
    await prisma.account.delete({ where: { id } });
    await audit(req.authUser, {
      action: "ACCOUNT_DELETE",
      entity: "Account",
      entityId: id,
      summary: `Account "${existing.name}" deleted`,
    });
    reply.status(204);
    return null;
  });
}
