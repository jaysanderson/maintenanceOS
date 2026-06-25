/**
 * Ingest the finance policy (docs/FINANCE-POLICY.md) into the ARAG Knowledge
 * Box, one resource per "## " section, labelled doctype=policy. This is the
 * rules source the finance Exception assistant (UC1B/UC7) cites via
 * /api/ai/finance-exceptions → ask(filters: doctype=policy).
 *
 * Idempotent (upsert by slug). No ARAG creds? DRY-RUN.
 *   npm run arag:ingest-finance-policy     (from apps/api)
 */
import { readFile } from "node:fs/promises";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { isConfigured, upsertErpDoc, getAragConfig, type ErpDoc } from "../src/lib/arag.js";

const here = dirname(fileURLToPath(import.meta.url)); // apps/api/scripts
const DOC_PATH = join(here, "..", "..", "..", "docs", "FINANCE-POLICY.md");

const kebab = (s: string) =>
  s.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 60);

function splitSections(md: string): { title: string; body: string }[] {
  const out: { title: string; body: string }[] = [];
  let title = "Finance Policy";
  let buf: string[] = [];
  const flush = () => {
    const body = buf.join("\n").trim();
    if (body) out.push({ title, body });
  };
  for (const line of md.split("\n")) {
    const m = /^##\s+(.*)$/.exec(line);
    if (m) { flush(); title = m[1].trim(); buf = [line]; }
    else buf.push(line);
  }
  flush();
  return out;
}

async function main() {
  const md = await readFile(DOC_PATH, "utf8");
  const docs: ErpDoc[] = splitSections(md).map((s) => ({
    slug: `finance-policy-${kebab(s.title)}`,
    title: `Finance Policy — ${s.title}`,
    body: s.body,
    path: "/policy",
    labels: [["doctype", "policy"]],
    relations: [],
  }));

  if (!isConfigured()) {
    console.log("ARAG not configured — DRY RUN. Would ingest:");
    for (const d of docs) console.log(`  ${d.slug}  (${d.body.length} chars)`);
    return;
  }
  const { kbId } = getAragConfig();
  console.log(`Ingesting ${docs.length} finance-policy sections into KB ${kbId} (doctype=policy)…`);
  let created = 0, updated = 0;
  for (const d of docs) {
    const res = await upsertErpDoc(d);
    res.action === "created" ? created++ : updated++;
    console.log(`  ${res.action.padEnd(7)} ${res.slug}`);
  }
  console.log(`\nDone. ${created} created, ${updated} updated.`);
}

main().catch((e) => {
  console.error("ingest-finance-policy failed:", e);
  process.exit(1);
});
