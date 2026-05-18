import { Link } from "react-router-dom";
import { useList } from "../lib/hooks";
import { currency } from "../lib/api";
import { DashboardSummary } from "../lib/types";
import { KpiCard, PageState, Card, Badge } from "../components/ui";

export default function Dashboard() {
  const { data, isLoading, error } = useList<DashboardSummary>(
    "/dashboard/summary"
  );

  return (
    <PageState loading={isLoading} error={error}>
      {data && (
        <div className="space-y-6">
          <div className="grid grid-cols-2 gap-4 md:grid-cols-3 lg:grid-cols-4">
            <KpiCard label="Open Work Orders" value={data.openWorkOrders} />
            <KpiCard
              label="Unassigned Jobs"
              value={data.unassignedJobs}
              tone={data.unassignedJobs > 0 ? "warn" : "default"}
              sub="Need a technician"
            />
            <KpiCard
              label="Jobs Due Today"
              value={data.jobsDueToday}
              tone={data.jobsDueToday > 0 ? "warn" : "default"}
            />
            <KpiCard
              label="SLA Breaches"
              value={data.slaBreaches}
              tone={data.slaBreaches > 0 ? "danger" : "good"}
            />
            <KpiCard
              label="Waiting On Parts"
              value={data.jobsWaitingOnParts}
              tone={data.jobsWaitingOnParts > 0 ? "warn" : "default"}
            />
            <KpiCard
              label="Technician Utilisation"
              value={`${data.technicianUtilization}%`}
            />
            <KpiCard
              label="Revenue This Month"
              value={currency(data.revenueThisMonth)}
              tone="good"
            />
            <KpiCard
              label="Gross Margin (Month)"
              value={`${data.grossMarginThisMonth}%`}
              tone={data.grossMarginThisMonth < 25 ? "danger" : "good"}
            />
            <KpiCard
              label="Outstanding Invoices"
              value={currency(data.outstandingInvoices)}
              sub={`${data.outstandingInvoiceCount} invoices`}
              tone={data.outstandingInvoices > 0 ? "warn" : "default"}
            />
            <KpiCard
              label="Low Stock Items"
              value={data.lowStockItems}
              tone={data.lowStockItems > 0 ? "warn" : "good"}
            />
            <KpiCard
              label="Vehicles Due Service"
              value={data.vehiclesDueForService}
              tone={data.vehiclesDueForService > 0 ? "warn" : "good"}
            />
          </div>

          <Card>
            <div className="border-b border-slate-200 px-5 py-3">
              <h2 className="font-semibold">Worst Jobs by Margin Leakage</h2>
              <p className="text-xs text-slate-500">
                Completed/invoiced jobs with the lowest gross margin — investigate
                quoting and cost capture.
              </p>
            </div>
            {data.worstJobsByMargin.length === 0 ? (
              <div className="p-6 text-sm text-slate-500">
                No costed jobs yet.
              </div>
            ) : (
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-slate-200 bg-slate-50 text-left text-xs uppercase text-slate-500">
                    <th className="px-5 py-2 font-medium">Work Order</th>
                    <th className="px-5 py-2 font-medium">Title</th>
                    <th className="px-5 py-2 font-medium">Revenue</th>
                    <th className="px-5 py-2 font-medium">Gross Profit</th>
                    <th className="px-5 py-2 font-medium">Margin</th>
                    <th className="px-5 py-2 font-medium">Flag</th>
                  </tr>
                </thead>
                <tbody>
                  {data.worstJobsByMargin.map((j) => (
                    <tr
                      key={j.workOrderId}
                      className="border-b border-slate-100 last:border-0"
                    >
                      <td className="px-5 py-2 font-medium">
                        <Link
                          className="text-brand-600 hover:underline"
                          to={`/work-orders/${j.workOrderId}`}
                        >
                          {j.workOrderNumber}
                        </Link>
                      </td>
                      <td className="px-5 py-2">{j.title}</td>
                      <td className="px-5 py-2">{currency(j.revenue)}</td>
                      <td
                        className={`px-5 py-2 ${
                          j.grossProfit < 0 ? "text-red-600" : ""
                        }`}
                      >
                        {currency(j.grossProfit)}
                      </td>
                      <td className="px-5 py-2">{j.grossMarginPercent}%</td>
                      <td className="px-5 py-2">
                        {j.marginRisk && <Badge value="MARGIN RISK" />}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </Card>
        </div>
      )}
    </PageState>
  );
}
