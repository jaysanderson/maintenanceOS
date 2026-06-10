/**
 * SPIKE (throwaway) — confirm ARAG can do visual document extraction on our
 * managed host before we build the J1 feature (supplier PO → draft).
 *
 * Two probes:
 *   1. POST /api/v1/predict/compat/chat/completions with a vision model +
 *      a base64 image of a supplier PO, asking for strict JSON. (Route 2)
 *   2. GET /api/v1/extract_strategies/{kbid} — is the persistent
 *      Extract-Strategy API enabled for us? (Route 1 feasibility)
 *
 *   npm run spike:vision -- /absolute/path/to/supplier-po.png
 *   npm run spike:vision -- /path/to/po.pdf chatgpt-4.1
 *
 * Tries models in order until one returns usable JSON. Prints what worked
 * so we can record it in docs/AI-FEATURES-BACKLOG.md.
 */
import { readFileSync } from "node:fs";
import { extname } from "node:path";

const BASE = process.env.ARAG_BASE_URL ?? "";
const KB_KEY = process.env.ARAG_KB_KEY || process.env.ARAG_API_KEY || "";
// The /predict/compat endpoint needs a NUA key (the KB key gets 403). Prefer
// it; fall back to the KB key only to re-demonstrate the 403 if NUA is unset.
const NUA = process.env.ARAG_NUA_KEY || "";
const KEY = NUA || KB_KEY;
const KB = process.env.ARAG_KB_ID ?? "";

if (!BASE || !KEY) {
  console.error("Missing ARAG_BASE_URL / ARAG_KB_KEY in env.");
  process.exit(1);
}

const filePath = process.argv[2];
if (!filePath) {
  console.error(
    "Usage: npm run spike:vision -- /path/to/supplier-po.(png|jpg|pdf) [model]"
  );
  process.exit(1);
}

const MIME: Record<string, string> = {
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".webp": "image/webp",
  ".gif": "image/gif",
  ".pdf": "application/pdf",
};
const mime = MIME[extname(filePath).toLowerCase()] ?? "image/png";
const b64 = readFileSync(filePath).toString("base64");

// Vision-capable models on our deployment, cheapest-capable first.
const MODELS = process.argv[3]
  ? [process.argv[3]]
  : ["chatgpt-4.1", "gemini-2.5-flash-image", "chatgpt4o", "aws-claude-4-5-sonnet"];

const SYSTEM =
  "You are a precise document data-extraction engine for a property " +
  "maintenance company's purchasing system. You are given an image of a " +
  "supplier purchase order or order confirmation. Extract its contents as " +
  "STRICT JSON only — no prose, no markdown fences. Use this exact shape:\n" +
  '{"supplierName": string, "supplierRef": string|null, "orderDate": ' +
  'string|null, "expectedDate": string|null, "currency": string|null, ' +
  '"lines": [{"description": string, "sku": string|null, "quantity": ' +
  'number, "unitCost": number}]}\n' +
  "Dates as ISO yyyy-mm-dd where possible. unitCost is the ex-tax unit " +
  "price as a number. If a field is not present, use null (or [] for " +
  "lines). If this document is NOT a purchase order or order confirmation, " +
  'return {"notAPurchaseOrder": true}.';

async function tryVision(model: string, key: string): Promise<boolean> {
  const url = `${BASE}/api/v1/predict/compat/chat/completions`;
  const started = Date.now();
  const res = await fetch(url, {
    method: "POST",
    headers: {
      authorization: `Bearer ${key}`,
      "content-type": "application/json",
    },
    body: JSON.stringify({
      model,
      messages: [
        { role: "system", content: SYSTEM },
        {
          role: "user",
          content: [
            { type: "text", text: "Extract this purchase order as JSON." },
            {
              type: "image_url",
              image_url: { url: `data:${mime};base64,${b64}` },
            },
          ],
        },
      ],
    }),
  });
  const ms = Date.now() - started;
  const text = await res.text();
  if (!res.ok) {
    console.log(`  [${model}] HTTP ${res.status} (${ms}ms): ${text.slice(0, 200)}`);
    return false;
  }
  let content = "";
  try {
    content = JSON.parse(text)?.choices?.[0]?.message?.content ?? "";
  } catch {
    console.log(`  [${model}] response not JSON envelope: ${text.slice(0, 200)}`);
    return false;
  }
  const cleaned = content.replace(/```json/gi, "").replace(/```/g, "").trim();
  console.log(`  [${model}] OK (${ms}ms). Extracted content:`);
  try {
    console.log(JSON.stringify(JSON.parse(cleaned), null, 2));
  } catch {
    console.log(cleaned.slice(0, 800));
  }
  return true;
}

async function probeExtractStrategies(): Promise<void> {
  const url = `${BASE}/api/v1/extract_strategies/${KB}`;
  try {
    const res = await fetch(url, {
      method: "GET",
      headers: { authorization: `Bearer ${KEY}` },
    });
    const body = await res.text();
    console.log(
      `Route 1 probe — GET /extract_strategies/{kbid} → HTTP ${res.status}`
    );
    console.log("  " + body.slice(0, 300));
  } catch (e) {
    console.log("Route 1 probe failed:", (e as Error).message);
  }
}

(async () => {
  console.log(`File: ${filePath} (${mime}, ${Math.round(b64.length / 1365)}KB b64)`);
  console.log(`Host: ${BASE}\n`);

  console.log(
    `Route 2 — vision via /predict/compat/chat/completions (key: ${NUA ? "NUA" : "KB (expect 403)"})`
  );
  if (!NUA) {
    console.log("  ⚠ ARAG_NUA_KEY not set — compat needs a NUA key; this will 403.");
  }
  let ok = false;
  for (const model of MODELS) {
    ok = await tryVision(model, KEY);
    if (ok) {
      console.log(`\n✅ Route 2 works with model "${model}".`);
      break;
    }
  }
  if (!ok) console.log("\n❌ Route 2 failed for all models. See errors above.");

  console.log("");
  await probeExtractStrategies();
})();
