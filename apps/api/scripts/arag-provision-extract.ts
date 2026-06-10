/**
 * Provision the MaintenanceOS document extract strategy — a rules-based
 * visual-LLM (VLLM) extraction config applied on file ingestion so scanned
 * PDFs / images are read with our extraction rules (line items, header
 * fields, tables) rather than plain OCR.
 *
 * Idempotent: re-running returns the same strategy id.
 *
 *   npm run arag:provision-extract        (from apps/api)
 *
 * Prints the strategy id — add it to apps/api/.env as
 * `ARAG_EXTRACT_STRATEGY_ID=<id>` so `ingestAndExtractText` applies it.
 */
import { ensureDocExtractStrategy, isConfigured } from "../src/lib/arag.js";

if (!isConfigured()) {
  console.error("ARAG is not configured (set ARAG_* in apps/api/.env).");
  process.exit(1);
}

const id = await ensureDocExtractStrategy();
console.log("Extract strategy 'maintenanceos-docs' ready.");
console.log(`ARAG_EXTRACT_STRATEGY_ID=${id}`);
console.log("→ add that line to apps/api/.env to apply it on document ingestion.");
