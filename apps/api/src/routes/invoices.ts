import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { prisma } from "../prisma.js";
import { parse } from "../lib/validate.js";
import { notFound, badRequest } from "../lib/errors.js";
import { nextInvoiceNumber } from "../lib/numbering.js";
import { calcInvoiceTotals } from "../lib/costing.js";
import { INVOICE_STATUSES } from "../lib/enums.js";
import { getGstRate, getCompanyConfig } from "../lib/config.js";
import { audit } from "../lib/audit.js";
import { generateInvoicePdf } from "../lib/pdf.js";
import { notify } from "../lib/notify.js";

const createSchema = z.object({
  accountId: z.string().min(1),
  workOrderId: z.string().optional().nullable(),
  subtotal: z.number().nonnegative(),
  notes: z.string().optional().nullable(),
  dueInDays: z.number().int().positive().default(30),
});

export async function invoiceRoutes(app: FastifyInstance) {
  app.get("/", { schema: { tags: ["Invoices"], summary: "List invoices (search/paginate)" } }, async (req, reply) => {
    const { status, accountId, q, limit, offset } = req.query as Record<string, string | undefined>;
    const where = {
      ...(status ? { status } : {}),
      ...(accountId ? { accountId } : {}),
      ...(q
        ? {
            OR: [
              { invoiceNumber: { contains: q } },
              { account: { is: { name: { contains: q } } } },
            ],
          }
        : {}),
    };
    reply.header("X-Total-Count", String(await prisma.invoice.count({ where })));
    const invoices = await prisma.invoice.findMany({
      where,
      orderBy: { createdAt: "desc" },
      include: { account: true, workOrder: true },
      ...(limit ? { take: Math.min(Number(limit), 500) } : {}),
      ...(offset ? { skip: Number(offset) } : {}),
    });
    const now = new Date();
    return invoices.map((i) => ({
      ...i,
      overdue:
        ["SENT", "OVERDUE"].includes(i.status) &&
        !!i.dueAt &&
        new Date(i.dueAt) < now,
    }));
  });

  app.get("/:id", { schema: { tags: ["Invoices"], summary: "Get invoice" } }, async (req) => {
    const { id } = req.params as { id: string };
    const invoice = await prisma.invoice.findUnique({
      where: { id },
      include: { account: true, workOrder: { include: { site: true } } },
    });
    if (!invoice) throw notFound("Invoice");
    return invoice;
  });

  app.post("/", { schema: { tags: ["Invoices"], summary: "Create invoice" } }, async (req, reply) => {
    const data = parse(createSchema, req.body);
    const totals = calcInvoiceTotals(data.subtotal, await getGstRate());
    const issuedAt = new Date();
    const dueAt = new Date(issuedAt.getTime() + data.dueInDays * 86400000);
    reply.status(201);
    const created = await prisma.invoice.create({
      data: {
        invoiceNumber: await nextInvoiceNumber(),
        accountId: data.accountId,
        workOrderId: data.workOrderId ?? null,
        status: "DRAFT",
        subtotal: totals.subtotal,
        gst: totals.gst,
        total: totals.total,
        issuedAt,
        dueAt,
        notes: data.notes,
      },
      include: { account: true, workOrder: true },
    });
    await audit(req.authUser, {
      action: "INVOICE_CREATE",
      entity: "Invoice",
      entityId: created.id,
      summary: `${created.invoiceNumber} created (${created.total})`,
    });
    return created;
  });

  // Generate invoice from a completed work order (uses approved quote, else latest quote).
  app.post("/from-work-order/:workOrderId", { schema: { tags: ["Invoices"], summary: "Invoice from work order" } }, async (req, reply) => {
    const { workOrderId } = req.params as { workOrderId: string };
    const wo = await prisma.workOrder.findUnique({
      where: { id: workOrderId },
      include: { quotes: { orderBy: { createdAt: "desc" } } },
    });
    if (!wo) throw notFound("Work order");
    const approved = wo.quotes.find((q) => q.status === "APPROVED");
    const source = approved ?? wo.quotes[0];
    if (!source) {
      throw badRequest("No quote found for this work order to invoice from");
    }
    const totals = calcInvoiceTotals(source.subtotal, await getGstRate());
    const issuedAt = new Date();
    const dueAt = new Date(issuedAt.getTime() + 30 * 86400000);
    const invoice = await prisma.invoice.create({
      data: {
        invoiceNumber: await nextInvoiceNumber(),
        accountId: wo.accountId,
        workOrderId: wo.id,
        status: "SENT",
        subtotal: totals.subtotal,
        gst: totals.gst,
        total: totals.total,
        issuedAt,
        dueAt,
        notes: `Generated from ${wo.workOrderNumber}`,
      },
      include: { account: true, workOrder: true },
    });
    await prisma.workOrder.update({
      where: { id: wo.id },
      data: { status: "INVOICED" },
    });
    await audit(req.authUser, {
      action: "INVOICE_CREATE",
      entity: "Invoice",
      entityId: invoice.id,
      summary: `${invoice.invoiceNumber} generated from ${wo.workOrderNumber}`,
    });
    await notify({
      type: "INVOICE_RAISED",
      message: `Invoice ${invoice.invoiceNumber} raised for ${invoice.account.name} (${invoice.total})`,
      entity: "Invoice",
      entityId: invoice.id,
      email: {
        to: invoice.account.email ?? "billing@customer.example",
        subject: `Invoice ${invoice.invoiceNumber}`,
        body: `Please find invoice ${invoice.invoiceNumber} for ${invoice.total}.`,
      },
    });
    reply.status(201);
    return invoice;
  });

  app.get("/:id/pdf", { schema: { tags: ["Invoices"], summary: "Download invoice PDF" } }, async (req, reply) => {
    const { id } = req.params as { id: string };
    const invoice = await prisma.invoice.findUnique({
      where: { id },
      include: { account: true, workOrder: true },
    });
    if (!invoice) throw notFound("Invoice");
    const pdf = await generateInvoicePdf(invoice, await getCompanyConfig());
    reply.header("Content-Type", "application/pdf");
    reply.header(
      "Content-Disposition",
      `inline; filename="${invoice.invoiceNumber}.pdf"`
    );
    return reply.send(pdf);
  });

  app.patch("/:id/status", { schema: { tags: ["Invoices"], summary: "Update invoice status" } }, async (req) => {
    const { id } = req.params as { id: string };
    const { status } = parse(z.object({ status: z.enum(INVOICE_STATUSES) }), req.body);
    const existing = await prisma.invoice.findUnique({ where: { id } });
    if (!existing) throw notFound("Invoice");
    const updated = await prisma.invoice.update({
      where: { id },
      data: {
        status,
        ...(status === "PAID" ? { paidAt: new Date() } : {}),
      },
      include: { account: true, workOrder: true },
    });
    await audit(req.authUser, {
      action: "INVOICE_STATUS",
      entity: "Invoice",
      entityId: id,
      summary: `${updated.invoiceNumber}: ${existing.status} → ${status}`,
    });
    return updated;
  });
}
