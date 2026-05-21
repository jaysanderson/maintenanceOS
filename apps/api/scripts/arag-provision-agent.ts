/**
 * Config-as-code for the MaintenanceOS Retrieval Agent.
 *
 * Idempotently brings the agent's workflow to the known-good shape we
 * verified live on aws-eu-central-1-1:
 *
 *   drivers   : mcphttp → MaintenanceOS /mcp (auth header), [KB via nucliadb]
 *   context   : ask          (retrieval over the KB driver)
 *   generation: summarize    (model chatgpt-azure-4o-mini)
 *   rules     : cite identifiers; answer only from retrieved data
 *
 * PREREQUISITE that the REST API cannot do: the **nucliadb (Knowledge Box)
 * driver must be created in the ARAG dashboard** — for a same-region KB it
 * auto-provisions a scoped API key, which the API does not expose a field
 * for. This script verifies that driver exists and warns if it doesn't.
 *
 * The `generate` generation module and using an `mcphttp` driver as a
 * retrieval source both error server-side on this deployment (reported to
 * Progress) — so we use `summarize` + the `ask`/nucliadb path.
 *
 *   npm run arag:provision-agent          (from apps/api)
 */
import { aragAgentFromEnv, aragAgentConfigured } from "@maintenanceos/arag-client";

const MOS_MCP_URL = process.env.MOS_MCP_URL ?? "https://maintenanceos.fly.dev/mcp";
const MODEL = process.env.ARAG_AGENT_MODEL ?? "chatgpt-azure-4o-mini";

const RULES = [
  "Always cite the specific work order, invoice, or account identifiers used.",
  "Only answer from retrieved MaintenanceOS data and safety documents; do not speculate.",
];

const GEN_PROMPT =
  "Answer the question using ONLY the retrieved MaintenanceOS records (work orders, accounts, quotes, invoices) and safety/policy documents. Cite work order and invoice numbers. If the data isn't available, say so. Be concise.";

function cfg(d: unknown): Record<string, unknown> {
  // driver list entries are wrapped: { config: { identifier, provider, ... } }
  const o = d as { config?: Record<string, unknown> };
  return (o.config as Record<string, unknown>) ?? (d as Record<string, unknown>);
}

async function mintMosToken(): Promise<string | null> {
  // A static token for the MaintenanceOS mcphttp driver header. Demo creds;
  // swap for a long-lived service token in production.
  const email = process.env.MOS_EMAIL ?? "admin@maintenanceos.com.au";
  const password = process.env.MOS_PASSWORD ?? "demo1234";
  const base = MOS_MCP_URL.replace(/\/mcp$/, "");
  try {
    const res = await fetch(`${base}/api/auth/login`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ email, password }),
    });
    if (!res.ok) return null;
    const j = (await res.json()) as { token?: string };
    return j.token ?? null;
  } catch {
    return null;
  }
}

async function main(): Promise<void> {
  if (!aragAgentConfigured()) {
    console.error("ARAG agent not configured — set ARAG_AGENT_ID / ARAG_AGENT_KEY (+ ARAG_AGENT_BASE_URL) in .env");
    process.exit(1);
  }
  const agent = aragAgentFromEnv();

  // 1. Drivers
  const drivers = (await agent.listDrivers()).map(cfg);
  const haveMos = drivers.some((d) => d.identifier === "maintenanceos-mcp");
  const haveKb = drivers.some((d) => d.provider === "nucliadb");

  if (!haveMos) {
    const token = await mintMosToken();
    await agent.addDriver({
      identifier: "maintenanceos-mcp",
      name: "MaintenanceOS ERP",
      provider: "mcphttp",
      config: {
        uri: MOS_MCP_URL,
        headers: token ? { authorization: `Bearer ${token}` } : {},
      },
    });
    console.log(`driver mcphttp → ${MOS_MCP_URL} created${token ? " (with auth header)" : " (no token — set MOS_EMAIL/PASSWORD)"}`);
  } else {
    console.log("driver maintenanceos-mcp present");
  }

  if (!haveKb) {
    console.warn(
      "\n⚠  No nucliadb (Knowledge Box) driver found.\n" +
      "   Create it in the ARAG dashboard: Agent → Drivers → Add → Knowledge Box →\n" +
      "   select your KB. Same-region KBs get an auto-provisioned key. The REST\n" +
      "   API has no auth field for this driver, so it must be added there.\n"
    );
  } else {
    console.log("driver nucliadb (Knowledge Box) present");
  }

  // 2. Context (retrieval) — `ask` queries the nucliadb KB driver.
  const context = (await agent.listContext()) as { module?: string }[];
  if (!context.some((c) => c.module === "ask")) {
    await agent.addContext({ module: "ask" });
    console.log("context step `ask` created");
  } else {
    console.log("context step `ask` present");
  }

  // 3. Generation — `summarize` (the `generate` module is broken here).
  const generation = (await agent.listGeneration()) as { module?: string }[];
  if (!generation.some((g) => g.module === "summarize")) {
    await agent.addGeneration({
      title: "Answer",
      module: "summarize",
      model: MODEL,
      prompt: GEN_PROMPT,
    });
    console.log(`generation step \`summarize\` (${MODEL}) created`);
  } else {
    console.log("generation step `summarize` present");
  }

  // 4. Global rules
  await agent.setRules(RULES);
  console.log("global rules set");

  // 5. Smoke test (specific lookup — the path that works reliably)
  console.log("\nsmoke test: 'Summarize work order WO-2026-0023 …'");
  const r = await agent.interactAnswer(
    "Summarize work order WO-2026-0023 including its account, status and whether it is overdue."
  );
  if (r.error) console.log("  ⚠ step error:", r.error);
  console.log("  ANSWER:", r.answer || "(empty — check the nucliadb driver exists + is authenticated)");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
