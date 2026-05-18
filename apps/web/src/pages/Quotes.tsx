import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { useList, useApiMutation } from "../lib/hooks";
import { api, currency, date } from "../lib/api";
import { Quote, WorkOrder } from "../lib/types";
import { PageState, DataTable, Badge, Button, Modal, Field, inputCls } from "../components/ui";

export default function Quotes() {
  const nav = useNavigate();
  const [status, setStatus] = useState("");
  const [open, setOpen] = useState(false);
  const query = useList<Quote[]>(`/quotes${status ? `?status=${status}` : ""}`);
  const workOrders = useList<WorkOrder[]>("/work-orders?");

  const [form, setForm] = useState({
    workOrderId: "",
    labourHours: 4,
    labourRate: 110,
    materialCost: 150,
    subcontractorCost: 0,
    equipmentCost: 0,
    travelCost: 40,
    disposalCost: 0,
    marginPercent: 25,
  });
  const create = useApiMutation(
    (body: typeof form) => api.post<Quote>("/quotes", body),
    ["/quotes", "/work-orders", "/dashboard"]
  );

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <select className={`${inputCls} max-w-xs`} value={status} onChange={(e) => setStatus(e.target.value)}>
          <option value="">All statuses</option>
          {["DRAFT", "SENT", "APPROVED", "REJECTED", "EXPIRED"].map((s) => (
            <option key={s} value={s}>{s}</option>
          ))}
        </select>
        <Button onClick={() => setOpen(true)}>+ New Quote</Button>
      </div>

      <PageState loading={query.isLoading} error={query.error} empty={query.data?.length === 0}>
        {query.data && (
          <DataTable
            rows={query.data}
            rowKey={(q) => q.id}
            onRowClick={(q) => nav(`/quotes/${q.id}`)}
            columns={[
              { header: "Quote #", cell: (q) => <span className="font-medium text-brand-600">{q.quoteNumber}</span> },
              { header: "Account", cell: (q) => q.account?.name ?? "—" },
              { header: "Work Order", cell: (q) => q.workOrder?.workOrderNumber ?? "—" },
              { header: "Subtotal", cell: (q) => currency(q.subtotal) },
              { header: "GST", cell: (q) => currency(q.gst) },
              { header: "Total", cell: (q) => <span className="font-medium">{currency(q.total)}</span> },
              { header: "Valid Until", cell: (q) => date(q.validUntil) },
              { header: "Status", cell: (q) => <Badge value={q.status} /> },
            ]}
          />
        )}
      </PageState>

      <Modal open={open} onClose={() => setOpen(false)} title="New Quote">
        <div className="space-y-3">
          <Field label="Work Order">
            <select className={inputCls} value={form.workOrderId} onChange={(e) => setForm({ ...form, workOrderId: e.target.value })}>
              <option value="">Select work order…</option>
              {(workOrders.data ?? []).map((w) => (
                <option key={w.id} value={w.id}>{w.workOrderNumber} — {w.title}</option>
              ))}
            </select>
          </Field>
          <div className="grid grid-cols-2 gap-3">
            {([
              ["labourHours", "Labour Hours"],
              ["labourRate", "Labour Rate ($/h)"],
              ["materialCost", "Material Cost"],
              ["subcontractorCost", "Subcontractor Cost"],
              ["equipmentCost", "Equipment Cost"],
              ["travelCost", "Travel Cost"],
              ["disposalCost", "Disposal Cost"],
              ["marginPercent", "Margin %"],
            ] as const).map(([key, label]) => (
              <Field key={key} label={label}>
                <input
                  type="number"
                  className={inputCls}
                  value={form[key]}
                  onChange={(e) => setForm({ ...form, [key]: Number(e.target.value) })}
                />
              </Field>
            ))}
          </div>
          <p className="text-xs text-slate-500">
            Subtotal, GST (10%) and total are calculated server-side.
          </p>
          {create.isError && <p className="text-sm text-red-600">{(create.error as Error).message}</p>}
          <div className="flex justify-end gap-2 pt-2">
            <Button variant="secondary" onClick={() => setOpen(false)}>Cancel</Button>
            <Button
              disabled={!form.workOrderId || create.isPending}
              onClick={() => create.mutate(form, { onSuccess: (q) => { setOpen(false); nav(`/quotes/${q.id}`); } })}
            >
              {create.isPending ? "Creating…" : "Create Quote"}
            </Button>
          </div>
        </div>
      </Modal>
    </div>
  );
}
