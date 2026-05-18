import { useState } from "react";
import { useList, useApiMutation } from "../lib/hooks";
import { api, currency, date, openAuthed } from "../lib/api";
import { Invoice } from "../lib/types";
import { PageState, DataTable, Badge, inputCls } from "../components/ui";

const STATUSES = ["DRAFT", "SENT", "PAID", "OVERDUE", "VOID"];

export default function Invoices() {
  const [status, setStatus] = useState("");
  const query = useList<Invoice[]>(`/invoices${status ? `?status=${status}` : ""}`);
  const setStatusM = useApiMutation(
    ({ id, status }: { id: string; status: string }) =>
      api.patch(`/invoices/${id}/status`, { status }),
    ["/invoices", "/dashboard"]
  );

  return (
    <div className="space-y-4">
      <select className={`${inputCls} max-w-xs`} value={status} onChange={(e) => setStatus(e.target.value)}>
        <option value="">All statuses</option>
        {STATUSES.map((s) => <option key={s} value={s}>{s}</option>)}
      </select>

      <PageState loading={query.isLoading} error={query.error} empty={query.data?.length === 0}>
        {query.data && (
          <DataTable
            rows={query.data}
            rowKey={(i) => i.id}
            columns={[
              {
                header: "Invoice #",
                cell: (i) => (
                  <button
                    className="font-medium text-brand-600 hover:underline"
                    onClick={(e) => {
                      e.stopPropagation();
                      openAuthed(`/invoices/${i.id}/pdf`);
                    }}
                    title="Download PDF"
                  >
                    {i.invoiceNumber}
                  </button>
                ),
              },
              { header: "Account", cell: (i) => i.account?.name ?? "—" },
              { header: "Work Order", cell: (i) => i.workOrder?.workOrderNumber ?? "—" },
              { header: "Subtotal", cell: (i) => currency(i.subtotal) },
              { header: "Total", cell: (i) => <span className="font-medium">{currency(i.total)}</span> },
              { header: "Issued", cell: (i) => date(i.issuedAt) },
              {
                header: "Due",
                cell: (i) => (
                  <span className={i.overdue ? "font-medium text-red-600" : ""}>
                    {date(i.dueAt)}{i.overdue && " ⚠"}
                  </span>
                ),
              },
              { header: "Status", cell: (i) => <Badge value={i.status} /> },
              {
                header: "Action",
                cell: (i) => (
                  <select
                    className="rounded-md border border-slate-300 px-2 py-1 text-xs"
                    value={i.status}
                    onClick={(e) => e.stopPropagation()}
                    onChange={(e) => setStatusM.mutate({ id: i.id, status: e.target.value })}
                  >
                    {STATUSES.map((s) => <option key={s} value={s}>{s}</option>)}
                  </select>
                ),
              },
            ]}
          />
        )}
      </PageState>
    </div>
  );
}
