import { useList } from "../lib/hooks";
import { currency } from "../lib/api";
import { JobCosting } from "../lib/types";
import { Card, PageState, Badge, Tabs } from "../components/ui";

interface RevenueRow { month: string; subtotal: number; gst: number; total: number; count: number; }
interface MarginRow { month: string; revenue: number; grossProfit: number; grossMarginPercent: number; }
interface WoReport { byStatus: { status: string; count: number }[]; byAccount: { account: string; count: number }[]; }
interface TechRow { employeeId: string; name: string; role: string; territory?: string | null; activeJobs: number; completedJobs: number; loggedHours: number; }
interface SlaRow { id: string; workOrderNumber: string; title: string; account: string; priority: string; status: string; assignedTo: string | null; hoursOverdue: number; }

function Bars({ data, label, value, fmt }: { data: any[]; label: (r: any) => string; value: (r: any) => number; fmt?: (n: number) => string }) {
  const max = Math.max(1, ...data.map(value));
  return (
    <div className="space-y-2">
      {data.map((r, i) => (
        <div key={i} className="flex items-center gap-3 text-sm">
          <div className="w-32 shrink-0 truncate text-slate-600">{label(r)}</div>
          <div className="h-5 flex-1 rounded bg-slate-100">
            <div
              className="h-5 rounded bg-brand-500"
              style={{ width: `${(value(r) / max) * 100}%` }}
            />
          </div>
          <div className="w-24 shrink-0 text-right font-medium">
            {fmt ? fmt(value(r)) : value(r)}
          </div>
        </div>
      ))}
      {data.length === 0 && <p className="text-sm text-slate-500">No data.</p>}
    </div>
  );
}

export default function Reports() {
  const revenue = useList<RevenueRow[]>("/reports/revenue");
  const margin = useList<MarginRow[]>("/reports/margin");
  const wo = useList<WoReport>("/reports/work-orders");
  const tech = useList<TechRow[]>("/reports/technician-utilization");
  const sla = useList<SlaRow[]>("/reports/sla-breaches");
  const leakage = useList<JobCosting[]>("/reports/margin-leakage");
  const lowStock = useList<{ itemId: string; name: string; totalQuantity: number; reorderPoint: number; unit: string }[]>("/reports/low-stock");

  return (
    <Tabs
      tabs={[
        {
          label: "Revenue & Margin",
          content: (
            <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
              <Card className="p-5">
                <h3 className="mb-4 font-semibold">Revenue by Month (ex GST)</h3>
                <PageState loading={revenue.isLoading} error={revenue.error}>
                  <Bars data={revenue.data ?? []} label={(r) => r.month} value={(r) => r.subtotal} fmt={currency} />
                </PageState>
              </Card>
              <Card className="p-5">
                <h3 className="mb-4 font-semibold">Gross Margin % by Month</h3>
                <PageState loading={margin.isLoading} error={margin.error}>
                  <Bars data={margin.data ?? []} label={(r) => r.month} value={(r) => r.grossMarginPercent} fmt={(n) => `${n}%`} />
                </PageState>
              </Card>
            </div>
          ),
        },
        {
          label: "Work Orders",
          content: (
            <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
              <Card className="p-5">
                <h3 className="mb-4 font-semibold">By Status</h3>
                <PageState loading={wo.isLoading} error={wo.error}>
                  <Bars data={wo.data?.byStatus ?? []} label={(r) => r.status.replace(/_/g, " ")} value={(r) => r.count} />
                </PageState>
              </Card>
              <Card className="p-5">
                <h3 className="mb-4 font-semibold">By Account</h3>
                <PageState loading={wo.isLoading} error={wo.error}>
                  <Bars data={wo.data?.byAccount ?? []} label={(r) => r.account} value={(r) => r.count} />
                </PageState>
              </Card>
            </div>
          ),
        },
        {
          label: "Technician Utilisation",
          content: (
            <Card className="p-5">
              <PageState loading={tech.isLoading} error={tech.error}>
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b text-left text-xs uppercase text-slate-500">
                      <th className="py-2">Technician</th>
                      <th className="py-2">Role</th>
                      <th className="py-2">Territory</th>
                      <th className="py-2">Active Jobs</th>
                      <th className="py-2">Completed</th>
                      <th className="py-2">Logged Hours</th>
                    </tr>
                  </thead>
                  <tbody>
                    {(tech.data ?? []).map((t) => (
                      <tr key={t.employeeId} className="border-b border-slate-100">
                        <td className="py-2 font-medium">{t.name}</td>
                        <td className="py-2">{t.role.replace(/_/g, " ")}</td>
                        <td className="py-2">{t.territory ?? "—"}</td>
                        <td className="py-2">{t.activeJobs}</td>
                        <td className="py-2">{t.completedJobs}</td>
                        <td className="py-2">{t.loggedHours}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </PageState>
            </Card>
          ),
        },
        {
          label: `SLA Breaches`,
          content: (
            <Card className="p-5">
              <PageState loading={sla.isLoading} error={sla.error} empty={sla.data?.length === 0} emptyLabel="No SLA breaches 🎉">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b text-left text-xs uppercase text-slate-500">
                      <th className="py-2">WO</th>
                      <th className="py-2">Title</th>
                      <th className="py-2">Account</th>
                      <th className="py-2">Priority</th>
                      <th className="py-2">Assigned</th>
                      <th className="py-2">Hours Overdue</th>
                    </tr>
                  </thead>
                  <tbody>
                    {(sla.data ?? []).map((s) => (
                      <tr key={s.id} className="border-b border-slate-100">
                        <td className="py-2 font-medium">{s.workOrderNumber}</td>
                        <td className="py-2">{s.title}</td>
                        <td className="py-2">{s.account}</td>
                        <td className="py-2"><Badge value={s.priority} /></td>
                        <td className="py-2">{s.assignedTo ?? "Unassigned"}</td>
                        <td className="py-2 font-medium text-red-600">{s.hoursOverdue}h</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </PageState>
            </Card>
          ),
        },
        {
          label: "Margin Leakage",
          content: (
            <Card className="p-5">
              <PageState loading={leakage.isLoading} error={leakage.error} empty={leakage.data?.length === 0} emptyLabel="No jobs below 25% margin.">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b text-left text-xs uppercase text-slate-500">
                      <th className="py-2">WO</th>
                      <th className="py-2">Title</th>
                      <th className="py-2">Revenue</th>
                      <th className="py-2">Cost</th>
                      <th className="py-2">Gross Profit</th>
                      <th className="py-2">Margin</th>
                    </tr>
                  </thead>
                  <tbody>
                    {(leakage.data ?? []).map((j) => (
                      <tr key={j.workOrderId} className="border-b border-slate-100">
                        <td className="py-2 font-medium">{j.workOrderNumber}</td>
                        <td className="py-2">{j.title}</td>
                        <td className="py-2">{currency(j.revenue)}</td>
                        <td className="py-2">{currency(j.totalActualCost)}</td>
                        <td className={`py-2 ${j.grossProfit < 0 ? "text-red-600" : ""}`}>{currency(j.grossProfit)}</td>
                        <td className="py-2">{j.grossMarginPercent}%</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </PageState>
            </Card>
          ),
        },
        {
          label: "Low Stock",
          content: (
            <Card className="p-5">
              <PageState loading={lowStock.isLoading} error={lowStock.error} empty={lowStock.data?.length === 0} emptyLabel="Everything above reorder point.">
                <Bars data={lowStock.data ?? []} label={(r) => r.name} value={(r) => r.totalQuantity} fmt={(n) => `${n}`} />
              </PageState>
            </Card>
          ),
        },
      ]}
    />
  );
}
