/**
 * Ingest the MaintenanceOS user guide (docs/USER-GUIDE.md) into the ARAG
 * Knowledge Box, one resource per "## " section, each labelled
 * doctype=userguide. This is the corpus the in-app Help assistant queries via
 * /api/ai/ask filtered to that label.
 *
 * Idempotent (upsert by slug) — safe to re-run after editing the guide.
 * No ARAG creds? Runs DRY-RUN: prints the sections it would ingest.
 *
 *   npm run arag:ingest-guide        (from apps/api)
 */
import { readFile } from "node:fs/promises";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { isConfigured, upsertErpDoc, getAragConfig, type ErpDoc } from "../src/lib/arag.js";

const here = dirname(fileURLToPath(import.meta.url)); // apps/api/scripts
const GUIDE_PATH = join(here, "..", "..", "..", "docs", "USER-GUIDE.md");

const kebab = (s: string) =>
  s
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 60);

/** Split the guide into one chunk per top-level (## ) section. Everything
 *  before the first ## (the # title + intro) becomes the "overview" chunk. */
function splitSections(md: string): { title: string; body: string }[] {
  const lines = md.split("\n");
  const out: { title: string; body: string }[] = [];
  let title = "Overview";
  let buf: string[] = [];
  const flush = () => {
    const body = buf.join("\n").trim();
    if (body) out.push({ title, body });
  };
  for (const line of lines) {
    const m = /^##\s+(.*)$/.exec(line);
    if (m) {
      flush();
      title = m[1].trim();
      buf = [line];
    } else {
      buf.push(line);
    }
  }
  flush();
  return out;
}

async function main() {
  const md = await readFile(GUIDE_PATH, "utf8");
  const sections = splitSections(md);
  const docs: ErpDoc[] = sections.map((s) => ({
    slug: `userguide-${kebab(s.title)}`,
    title: `User Guide — ${s.title}`,
    body: s.body,
    path: "/userguide",
    labels: [["doctype", "userguide"]],
    relations: [],
  }));

  if (!isConfigured()) {
    console.log("ARAG not configured — DRY RUN. Would ingest these sections:");
    for (const d of docs) console.log(`  ${d.slug}  (${d.body.length} chars)  ${d.title}`);
    console.log(`\n${docs.length} sections. Set ARAG_KB_ID/ARAG_KB_KEY to ingest for real.`);
    return;
  }

  const { kbId } = getAragConfig();
  console.log(`Ingesting ${docs.length} user-guide sections into KB ${kbId} (doctype=userguide)…`);
  let created = 0;
  let updated = 0;
  for (const d of docs) {
    const res = await upsertErpDoc(d);
    if (res.action === "created") created++;
    else updated++;
    console.log(`  ${res.action.padEnd(7)} ${res.slug}`);
  }
  console.log(`\nDone. ${created} created, ${updated} updated.`);
}

main().catch((e) => {
  console.error("ingest-user-guide failed:", e);
  process.exit(1);
});
