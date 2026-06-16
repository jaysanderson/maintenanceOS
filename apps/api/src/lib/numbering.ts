import { prisma } from "../prisma.js";

const year = () => new Date().getFullYear();

const pad = (n: number) => String(n).padStart(4, "0");

/**
 * Readable, year-scoped document numbers (e.g. WO-2026-0001).
 * Derived from the current count of that document type so numbers stay
 * sequential and human-friendly for a demo. Not concurrency-safe at
 * extreme scale, which is acceptable for this MVP.
 */
export async function nextWorkOrderNumber() {
  const count = await prisma.workOrder.count();
  return `WO-${year()}-${pad(count + 1)}`;
}

export async function nextQuoteNumber() {
  const count = await prisma.quote.count();
  return `Q-${year()}-${pad(count + 1)}`;
}

export async function nextPurchaseOrderNumber() {
  const count = await prisma.purchaseOrder.count();
  return `PO-${year()}-${pad(count + 1)}`;
}

export async function nextInvoiceNumber() {
  const count = await prisma.invoice.count();
  return `INV-${year()}-${pad(count + 1)}`;
}

export async function nextSupplierBillNumber() {
  const count = await prisma.supplierBill.count();
  return `BILL-${year()}-${pad(count + 1)}`;
}
