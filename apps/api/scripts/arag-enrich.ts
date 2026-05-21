/**
 * ARAG Data-Augmentation enrichment for the MaintenanceOS KB.
 *
 * Runs entirely inside ARAG (no MaintenanceOS AI code) to enrich the
 * ingested ERP corpus:
 *   - LLM_GRAPH        — extract entities/relations → knowledge graph
 *   - SYNTHETIC_QUESTIONS — generate Q&A per resource → better retrieval
 *   - LABELER (trade)  — auto-classify each record by trade discipline
 *
 * Idempotent (server upserts tasks). Defensive: a task that the deployment
 * rejects is logged and skipped — the others still run. `apply: ALL`
 * re-processes the resources already ingested by arag-sync.
 *
 *   npm run arag:enrich            (from apps/api)
 */
import { aragKbFromEnv, type AragDaTaskParams } from "@maintenanceos/arag-client";

const kb = aragKbFromEnv();

const TRADES = [
  "plumbing",
  "electrical",
  "carpentry",
  "hvac",
  "roofing",
  "painting",
  "grounds",
  "general",
];

const tasks: { name: string; spec: AragDaTaskParams }[] = [
  {
    name: "mos-graph",
    spec: {
      taskName: "LLM_GRAPH",
      apply: "ALL",
      parameters: {
        name: "mos-graph",
        on: "FIELD",
        operations: [{ graph: { entities: ["ORG", "PERSON", "LOCATION", "PRODUCT"] } }],
      },
    },
  },
  {
    name: "mos-qa",
    spec: {
      taskName: "SYNTHETIC_QUESTIONS",
      apply: "ALL",
      parameters: {
        name: "mos-qa",
        on: "FIELD",
        operations: [{ synthetic_questions: { count: 3 } }],
      },
    },
  },
  {
    name: "mos-trade",
    spec: {
      taskName: "LABELER",
      apply: "ALL",
      parameters: {
        name: "mos-trade",
        on: "FIELD",
        operations: [{ label: { labelset: "trade", labels: TRADES } }],
      },
    },
  },
];

async function main(): Promise<void> {
  // Ensure the `trade` labelset exists (LABELER assigns into it).
  try {
    await kb.putLabelset("trade", {
      title: "Trade",
      color: "#0D6EFD",
      kind: ["RESOURCES"],
      labels: TRADES.map((title) => ({ title })),
    });
    console.log("labelset 'trade' ensured");
  } catch (e) {
    console.log("labelset 'trade' ERR:", (e as Error).message);
  }

  for (const t of tasks) {
    try {
      await kb.setupDaTask(t.spec);
      console.log(`DA task ${t.name} (${t.spec.taskName}) started — apply=${t.spec.apply}`);
    } catch (e) {
      console.log(`DA task ${t.name} ERR:`, (e as Error).message);
    }
  }

  try {
    const list = await kb.listDaTasks();
    console.log(`\ninstalled DA tasks: ${list.tasks?.length ?? 0}`);
    for (const t of list.tasks ?? []) console.log(` - ${t.task_name} ${t.name} [${t.status}]`);
  } catch (e) {
    console.log("listDaTasks ERR:", (e as Error).message);
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
