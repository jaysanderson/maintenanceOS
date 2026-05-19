/**
 * Curated MCP prompts: ready-made workflows agents can use as a launch
 * point. Arguments are simple strings; the prompt text instructs the
 * agent to call the appropriate MCP tools/resources.
 */

export interface PromptDef {
  name: string;
  description: string;
  arguments: { name: string; description: string; required: boolean }[];
  /** Render the prompt's user message given the arguments. */
  render(args: Record<string, string>): string;
}

export const PROMPTS: PromptDef[] = [
  {
    name: "triage-work-order",
    description:
      "Given a work order ID, classify the job (type, priority, required skills) and recommend the next dispatch action.",
    arguments: [
      { name: "workOrderId", description: "Work order ID to triage.", required: true },
    ],
    render: ({ workOrderId }) => [
      `Triage work order \`${workOrderId}\`.`,
      ``,
      `1. Read \`maintenanceos://work-order/${workOrderId}\` for full context.`,
      `2. Decide jobType (REPAIR / MAINTENANCE / INSPECTION / EMERGENCY / RECURRING_SERVICE),`,
      `   priority (LOW / NORMAL / HIGH / URGENT), and required skills.`,
      `3. Recommend the dispatch action: assign a technician (call`,
      `   \`employees_list_employees\` with appropriate filters), and set the schedule.`,
      `4. If unsure, ask one clarifying question; otherwise summarise the recommendation and`,
      `   propose the exact tool call(s) you would make (don't execute mutations without confirmation).`,
    ].join("\n"),
  },
  {
    name: "draft-quote-from-history",
    description:
      "Draft a quote for a work order using comparable historical jobs as reference.",
    arguments: [
      {
        name: "workOrderId",
        description: "Work order the quote is for.",
        required: true,
      },
    ],
    render: ({ workOrderId }) => [
      `Draft a quote for work order \`${workOrderId}\`.`,
      ``,
      `1. Read \`maintenanceos://work-order/${workOrderId}\` for scope.`,
      `2. Use \`work_orders_list_work_orders\` to find ~5 comparable completed jobs`,
      `   (same jobType / similar title) and review their costing via`,
      `   \`work_orders_costing_work_orders\` to anchor labour hours, materials and margin.`,
      `3. Propose labour hours, labour rate, materials, subcontractor, equipment, travel,`,
      `   disposal and margin percent. The API computes subtotal/GST/total server-side.`,
      `4. Output the proposed quote as a JSON body suitable for \`quotes_create_quotes\``,
      `   and explain your reasoning. Do not create the quote — let the human confirm.`,
    ].join("\n"),
  },
  {
    name: "daily-operations-briefing",
    description:
      "Summarise today's operational state: SLA breaches, unassigned jobs, revenue progress, low stock, margin risk.",
    arguments: [],
    render: () => [
      `Produce today's operations briefing for the manager.`,
      ``,
      `Gather context via:`,
      `- \`maintenanceos://dashboard\` for KPIs`,
      `- \`reports_list_sla-breaches\` for breach details`,
      `- \`work_orders_list_work_orders\` (unassigned=true) for stuck jobs`,
      `- \`reports_list_margin-leakage\` for jobs at risk of losing money`,
      `- \`reports_list_low-stock\` for inventory to chase`,
      ``,
      `Output: 6–10 bullets, ordered by priority, with concrete recommended actions and`,
      `the work-order / invoice numbers a manager can click into. Be specific, not vague.`,
    ].join("\n"),
  },
];
