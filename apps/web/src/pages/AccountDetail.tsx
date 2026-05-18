import { useParams, Link } from "react-router-dom";
import { useOne } from "../lib/hooks";
import { currency, date } from "../lib/api";
import { Account } from "../lib/types";
import { PageState, Card, Badge, Tabs } from "../components/ui";

export default function AccountDetail() {
  const { id } = useParams();
  const { data, isLoading, error } = useOne<Account>(`/accounts/${id}`);

  return (
    <PageState loading={isLoading} error={error}>
      {data && (
        <div className="space-y-4">
          <Card className="p-5">
            <div className="flex items-start justify-between">
              <div>
                <h2 className="text-xl font-semibold">{data.name}</h2>
                <div className="mt-1 flex items-center gap-2 text-sm text-slate-500">
                  <Badge value={data.type} />
                  <span>·</span>
                  <span>{data.email ?? "—"}</span>
                  <span>·</span>
                  <span>{data.phone ?? "—"}</span>
                </div>
              </div>
              <div className="text-right text-sm text-slate-500">
                <div>Account Manager</div>
                <div className="font-medium text-slate-800">
                  {data.accountManager ?? "—"}
                </div>
                <div className="mt-1">Terms: {data.paymentTerms ?? "—"}</div>
              </div>
            </div>
            {data.notes && (
              <p className="mt-3 rounded-lg bg-amber-50 p-3 text-sm text-amber-800">
                {data.notes}
              </p>
            )}
          </Card>

          <Tabs
            tabs={[
              {
                label: `Sites (${data.sites?.length ?? 0})`,
                content: (
                  <Card className="divide-y divide-slate-100">
                    {(data.sites ?? []).map((s) => (
                      <div key={s.id} className="flex justify-between p-4 text-sm">
                        <div>
                          <div className="font-medium">{s.name}</div>
                          <div className="text-slate-500">
                            {s.address}, {s.suburb} {s.state} {s.postcode}
                          </div>
                        </div>
                        <div className="text-slate-500">
                          {s.preferredVisitWindow}
                        </div>
                      </div>
                    ))}
                    {data.sites?.length === 0 && (
                      <div className="p-6 text-sm text-slate-500">No sites.</div>
                    )}
                  </Card>
                ),
              },
              {
                label: `Work Orders (${data.workOrders?.length ?? 0})`,
                content: (
                  <Card className="divide-y divide-slate-100">
                    {(data.workOrders ?? []).map((w) => (
                      <Link
                        key={w.id}
                        to={`/work-orders/${w.id}`}
                        className="flex items-center justify-between p-4 text-sm hover:bg-slate-50"
                      >
                        <div>
                          <span className="font-medium text-brand-600">
                            {w.workOrderNumber}
                          </span>{" "}
                          — {w.title}
                        </div>
                        <div className="flex items-center gap-2">
                          <Badge value={w.priority} />
                          <Badge value={w.status} />
                        </div>
                      </Link>
                    ))}
                    {data.workOrders?.length === 0 && (
                      <div className="p-6 text-sm text-slate-500">
                        No work orders.
                      </div>
                    )}
                  </Card>
                ),
              },
              {
                label: `Invoices (${data.invoices?.length ?? 0})`,
                content: (
                  <Card className="divide-y divide-slate-100">
                    {(data.invoices ?? []).map((i) => (
                      <div
                        key={i.id}
                        className="flex items-center justify-between p-4 text-sm"
                      >
                        <div className="font-medium">{i.invoiceNumber}</div>
                        <div className="flex items-center gap-3">
                          <span>{currency(i.total)}</span>
                          <span className="text-slate-500">
                            due {date(i.dueAt)}
                          </span>
                          <Badge value={i.status} />
                        </div>
                      </div>
                    ))}
                    {data.invoices?.length === 0 && (
                      <div className="p-6 text-sm text-slate-500">
                        No invoices.
                      </div>
                    )}
                  </Card>
                ),
              },
            ]}
          />
        </div>
      )}
    </PageState>
  );
}
