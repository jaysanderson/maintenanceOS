import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { prisma } from "../prisma.js";
import { parse } from "../lib/validate.js";
import { notFound } from "../lib/errors.js";
import { nextQuoteNumber } from "../lib/numbering.js";
import { calcQuoteTotals } from "../lib/costing.js";
import { getGstRate, getCompanyConfig } from "../lib/config.js";
import { audit } from "../lib/audit.js";
import { generateQuotePdf } from "../lib/pdf.js";

const costFields = z.object({
  labourHours: z.number().nonnegative().default(0),
  labourRate: z.number().nonnegative().default(0),
  materialCost: z.number().nonnegative().default(0),
  subcontractorCost: z.number().nonnegative().default(0),
  equipmentCost: z.number().nonnegative().default(0),
  travelCost: z.number().nonnegative().default(0),
  disposalCost: z.number().nonnegative().default(0),
  marginPercent: z.number().default(0),
});

const createSchema = costFields.extend({
  workOrderId: z.string().min(1),
  validUntil: z.coerce.date().optional().nullable(),
  notes: z.string().optional().nullable(),
});

export async function quoteRoutes(app: FastifyInstance) {
  app.get("/", { schema: { tags: ["Quotes"], summary: "List quotes" } }, async (req) => {
    const { status, workOrderId } = req.query as Record<string, string | undefined>;
    return prisma.quote.findMany({
      where: { ...(status ? { status } : {}), ...(workOrderId ? { workOrderId } : {}) },
      orderBy: { createdAt: "desc" },
      include: { account: true, workOrder: true },
    });
  });

  app.get("/:id", { schema: { tags: ["Quotes"], summary: "Get quote" } }, async (req) => {
    const { id } = req.params as { id: string };
    const quote = await prisma.quote.findUnique({
      where: { id },
      include: { account: true, workOrder: { include: { site: true } } },
    });
    if (!quote) throw notFound("Quote");
    return quote;
  });

  app.post("/", { schema: { tags: ["Quotes"], summary: "Create quote (totals computed server-side)" } }, async (req, reply) => {
    const data = parse(createSchema, req.body);
    const wo = await prisma.workOrder.findUnique({ where: { id: data.workOrderId } });
    if (!wo) throw notFound("Work order");
    const totals = calcQuoteTotals(data, await getGstRate());
    const quote = await prisma.quote.create({
      data: {
        quoteNumber: await nextQuoteNumber(),
        workOrderId: data.workOrderId,
        accountId: wo.accountId,
        status: "DRAFT",
        labourHours: data.labourHours,
        labourRate: data.labourRate,
        materialCost: data.materialCost,
        subcontractorCost: data.subcontractorCost,
        equipmentCost: data.equipmentCost,
        travelCost: data.travelCost,
        disposalCost: data.disposalCost,
        marginPercent: data.marginPercent,
        subtotal: totals.subtotal,
        gst: totals.gst,
        total: totals.total,
        validUntil: data.validUntil,
        notes: data.notes,
      },
      include: { account: true, workOrder: true },
    });
    if (["NEW", "TRIAGE", "QUOTE_REQUIRED"].includes(wo.status)) {
      await prisma.workOrder.update({
        where: { id: wo.id },
        data: { status: "AWAITING_APPROVAL" },
      });
    }
    reply.status(201);
    return quote;
  });

  app.put("/:id", { schema: { tags: ["Quotes"], summary: "Update quote" } }, async (req) => {
    const { id } = req.params as { id: string };
    const existing = await prisma.quote.findUnique({ where: { id } });
    if (!existing) throw notFound("Quote");
    const data = parse(costFields.partial().extend({
      validUntil: z.coerce.date().optional().nullable(),
      notes: z.string().optional().nullable(),
      status: z.enum(["DRAFT", "SENT", "APPROVED", "REJECTED", "EXPIRED"]).optional(),
    }), req.body);
    const merged = { ...existing, ...data };
    const totals = calcQuoteTotals(merged, await getGstRate());
    return prisma.quote.update({
      where: { id },
      data: { ...data, subtotal: totals.subtotal, gst: totals.gst, total: totals.total },
      include: { account: true, workOrder: true },
    });
  });

  app.get("/:id/pdf", { schema: { tags: ["Quotes"], summary: "Download quote PDF" } }, async (req, reply) => {
    const { id } = req.params as { id: string };
    const quote = await prisma.quote.findUnique({
      where: { id },
      include: { account: true, workOrder: true },
    });
    if (!quote) throw notFound("Quote");
    const pdf = await generateQuotePdf(quote, await getCompanyConfig());
    reply.header("Content-Type", "application/pdf");
    reply.header(
      "Content-Disposition",
      `inline; filename="${quote.quoteNumber}.pdf"`
    );
    return reply.send(pdf);
  });

  app.post("/:id/approve", { schema: { tags: ["Quotes"], summary: "Approve quote → work order APPROVED" } }, async (req) => {
    const { id } = req.params as { id: string };
    const quote = await prisma.quote.findUnique({ where: { id } });
    if (!quote) throw notFound("Quote");
    const updated = await prisma.quote.update({
      where: { id },
      data: { status: "APPROVED" },
      include: { account: true, workOrder: true },
    });
    await prisma.workOrder.update({
      where: { id: quote.workOrderId },
      data: { status: "APPROVED" },
    });
    await audit(req.authUser, {
      action: "QUOTE_APPROVED",
      entity: "Quote",
      entityId: id,
      summary: `${updated.quoteNumber} approved (${updated.total})`,
    });
    return updated;
  });

  app.post("/:id/reject", { schema: { tags: ["Quotes"], summary: "Reject quote" } }, async (req) => {
    const { id } = req.params as { id: string };
    const quote = await prisma.quote.findUnique({ where: { id } });
    if (!quote) throw notFound("Quote");
    const rejected = await prisma.quote.update({
      where: { id },
      data: { status: "REJECTED" },
      include: { account: true, workOrder: true },
    });
    await audit(req.authUser, {
      action: "QUOTE_REJECTED",
      entity: "Quote",
      entityId: id,
      summary: `${rejected.quoteNumber} rejected`,
    });
    return rejected;
  });
}
