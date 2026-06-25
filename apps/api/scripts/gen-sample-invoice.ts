/**
 * Generate a realistic supplier TAX INVOICE PDF to test the AP "Import bill
 * from document" flow. Uses a supplier name + catalogue item names that exist
 * in our seed (deterministic, so they match in prod too) plus one freight line
 * with no catalogue match — exercising the matched/unmatched paths.
 *
 * A digital PDF (real text layer) extracts far more reliably than a photo/scan,
 * which is what the importer recommends.
 *
 *   npm run gen:sample-invoice     → writes /tmp/sample-supplier-invoice.pdf
 */
import PDFDocument from "pdfkit";
import { createWriteStream } from "node:fs";

const OUT = "/tmp/sample-supplier-invoice.pdf";
const doc = new PDFDocument({ size: "A4", margin: 50 });
doc.pipe(createWriteStream(OUT));

const money = (n: number) => `$${n.toFixed(2)}`;
const RIGHT = 545; // right edge for right-aligned amounts

// Supplier letterhead — "Reece Plumbing" exists in our seed (auto-matches).
doc.fontSize(22).fillColor("#0b5cab").text("Reece Plumbing");
doc
  .fontSize(9)
  .fillColor("#444")
  .text("Reece Pty Ltd  ·  ABN 84 004 097 090")
  .text("118 Lyons St South, Ballarat VIC 3350")
  .text("accounts@reece.com.au  ·  03 5331 7000");
doc.moveDown(1);

doc.fontSize(16).fillColor("#111").text("TAX INVOICE");
doc.moveDown(0.3);
doc
  .fontSize(10)
  .fillColor("#444")
  .text("Invoice No:  RPI-2026-44871")
  .text("Invoice Date:  09/06/2026")
  .text("Due Date:  09/07/2026  (Net 30)")
  .text("Customer PO:  PO-2026-0004")
  .text("Bill To:  Bendigo Property Maintenance, 1 Depot Lane, Bendigo VIC 3550");
doc.moveDown(1);

// Table columns
const cols = { desc: 50, code: 290, qty: 360, unit: 420, total: 470 };
const header = doc.y;
doc.font("Helvetica-Bold").fontSize(10).fillColor("#000");
doc.text("Description", cols.desc, header, { width: 230 });
doc.text("Code", cols.code, header);
doc.text("Qty", cols.qty, header);
doc.text("Unit", cols.unit, header);
doc.text("Amount", cols.total, header, { width: RIGHT - cols.total, align: "right" });
doc.moveDown(0.4);
doc.strokeColor("#ccc").moveTo(50, doc.y).lineTo(RIGHT, doc.y).stroke();
doc.moveDown(0.4);

// First four descriptions are EXACT seed item names (→ green "matched");
// the last is a freight charge with no catalogue item (→ stays a description).
const lines: [string, string, number, number][] = [
  ["Tap washer kit", "SKU-0001", 12, 4.0],
  ["PVC pipe 1m", "SKU-0023", 30, 8.0],
  ["Flexible hose 600mm", "SKU-0002", 6, 9.0],
  ["Silicone sealant", "SKU-0012", 12, 9.0],
  ["Freight & handling", "FRT", 1, 18.0],
];

doc.font("Helvetica").fontSize(10).fillColor("#111");
let subtotal = 0;
for (const [d, c, q, u] of lines) {
  const amt = q * u;
  subtotal += amt;
  const y = doc.y;
  doc.text(d, cols.desc, y, { width: 230 });
  doc.text(c, cols.code, y);
  doc.text(String(q), cols.qty, y);
  doc.text(money(u), cols.unit, y);
  doc.text(money(amt), cols.total, y, { width: RIGHT - cols.total, align: "right" });
  doc.moveDown(0.7);
}

doc.moveDown(0.3);
doc.strokeColor("#ccc").moveTo(330, doc.y).lineTo(RIGHT, doc.y).stroke();
doc.moveDown(0.4);

const gst = subtotal * 0.1;
const total = subtotal + gst;
const totalRow = (label: string, value: string, bold = false) => {
  const y = doc.y;
  doc.font(bold ? "Helvetica-Bold" : "Helvetica");
  doc.text(label, 330, y, { width: 130 });
  doc.text(value, cols.total, y, { width: RIGHT - cols.total, align: "right" });
  doc.moveDown(0.5);
};
totalRow("Subtotal (ex GST)", money(subtotal));
totalRow("GST 10%", money(gst));
totalRow("Total (inc GST)", money(total), true);

doc.moveDown(1.2);
doc
  .font("Helvetica")
  .fontSize(9)
  .fillColor("#666")
  .text(
    "Payment terms: Net 30 days. Please remit to Reece Pty Ltd, BSB 083-004 Acc 12345678, " +
      "reference RPI-2026-44871. Thank you for your business.",
    50,
    doc.y,
    { width: RIGHT - 50 }
  );

doc.end();
console.log(`Wrote ${OUT}`);
console.log(`Subtotal ${money(subtotal)}  GST ${money(gst)}  Total ${money(total)}`);
