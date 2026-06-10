/**
 * Generate a synthetic supplier order-confirmation PDF for spiking the J1
 * vision-extraction feature. Uses supplier + item names that exist in our
 * seed (so SKU/supplier matching is exercised) plus one deliberately
 * unmatchable line. Throwaway test fixture.
 *
 *   npm run gen:sample-po          → writes /tmp/sample-po.pdf
 * then rasterise:  sips -s format png /tmp/sample-po.pdf --out /tmp/sample-po.png
 */
import PDFDocument from "pdfkit";
import { createWriteStream } from "node:fs";

const doc = new PDFDocument({ size: "A4", margin: 50 });
doc.pipe(createWriteStream("/tmp/sample-po.pdf"));

const money = (n: number) => `$${n.toFixed(2)}`;

// Supplier letterhead (Reece Plumbing exists in our seed).
doc.fontSize(22).fillColor("#0b5cab").text("Reece Plumbing", { continued: false });
doc
  .fontSize(9)
  .fillColor("#444")
  .text("Reece Pty Ltd  ·  ABN 84 004 097 090")
  .text("118 Lyons St South, Ballarat VIC 3350")
  .text("trade@reece.com.au  ·  03 5331 7000");
doc.moveDown();

doc.fontSize(16).fillColor("#111").text("ORDER CONFIRMATION");
doc
  .fontSize(10)
  .fillColor("#444")
  .text("Order No:  RCE-449182")
  .text("Order Date:  23/05/2026")
  .text("Expected Delivery:  28/05/2026")
  .text("Bill To:  MaintenanceOS Demo Co, 1 Depot Lane, Bendigo VIC 3550");
doc.moveDown();

// Table header
const cols = { desc: 50, sku: 300, qty: 380, unit: 440, total: 510 };
doc.fontSize(10).fillColor("#000");
const row = (
  d: string,
  s: string,
  q: string,
  u: string,
  t: string,
  bold = false
) => {
  if (bold) doc.font("Helvetica-Bold");
  else doc.font("Helvetica");
  const y = doc.y;
  doc.text(d, cols.desc, y, { width: 240 });
  doc.text(s, cols.sku, y);
  doc.text(q, cols.qty, y);
  doc.text(u, cols.unit, y);
  doc.text(t, cols.total, y);
  doc.moveDown(0.6);
};
row("Description", "Code", "Qty", "Unit", "Total", true);
doc
  .strokeColor("#ccc")
  .moveTo(50, doc.y)
  .lineTo(560, doc.y)
  .stroke();
doc.moveDown(0.3);

// Lines: first three names match seeded inventory items; the last is a
// supplier-specific item with no match in our catalogue (tests "unmatched").
const lines: [string, string, number, number][] = [
  ["Tap washer kit (assorted)", "RW-1180", 10, 4.0],
  ["PVC pipe 1m DWV", "PVC-1000", 25, 8.0],
  ["Silicone sealant - clear", "SIL-300", 12, 9.0],
  ["Brasshards mixer cartridge 35mm", "BH-35MM", 4, 28.5],
];
let subtotal = 0;
for (const [d, s, q, u] of lines) {
  const t = q * u;
  subtotal += t;
  row(d, s, String(q), money(u), money(t));
}
doc.moveDown(0.5);
const gst = subtotal * 0.1;
doc.font("Helvetica");
doc.text(`Subtotal (ex GST):  ${money(subtotal)}`, 360);
doc.text(`GST 10%:  ${money(gst)}`, 360);
doc.font("Helvetica-Bold").text(`Total (inc GST):  ${money(subtotal + gst)}`, 360);

doc.end();
console.log("Wrote /tmp/sample-po.pdf");
