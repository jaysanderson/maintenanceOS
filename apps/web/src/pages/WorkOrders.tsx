import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { useList, useApiMutation } from "../lib/hooks";
import { api, date } from "../lib/api";
import { WorkOrder, Account, Site, Employee } from "../lib/types";
import {
  PageState,
  DataTable,
  Badge,
  Button,
  Modal,
  Field,
  inputCls,
} from "../components/ui";

const STATUSES = [
  "NEW", "TRIAGE", "QUOTE_REQUIRED", "AWAITING_APPROVAL", "APPROVED",
  "SCHEDULED", "DISPATCHED", "IN_PROGRESS", "WAITING_ON_PARTS",
  "COMPLETED", "INVOICED", "CLOSED", "CANCELLED",
];
const PRIORITIES = ["LOW", "NORMAL", "HIGH", "URGENT"];
const JOB_TYPES = ["REPAIR", "MAINTENANCE", "INSPECTION", "EMERGENCY", "QUOTE_ONLY", "RECURRING_SERVICE"];

export default function WorkOrders() {
  const nav = useNavigate();
  const [status, setStatus] = useState("");
  const [priority, setPriority] = useState("");
  const [unassigned, setUnassigned] = useState(false);
  const [open, setOpen] = useState(false);

  const qs = new URLSearchParams();
  if (status) qs.set("status", status);
  if (priority) qs.set("priority", priority);
  if (unassigned) qs.set("unassigned", "true");
  const query = useList<WorkOrder[]>(`/work-orders?${qs.toString()}`);

  const accounts = useList<Account[]>("/accounts");
  const sites = useList<Site[]>("/sites");
  const employees = useList<Employee[]>("/employees?active=true");

  const [form, setForm] = useState({
    accountId: "",
    siteId: "",
    title: "",
    jobType: "REPAIR",
    priority: "NORMAL",
    description: "",
    estimatedHours: 2,
    slaDays: 5,
  });
  const create = useApiMutation(
    (body: Record<string, unknown>) => api.post("/work-orders", body),
    ["/work-orders", "/dashboard"]
  );

  const submit = () => {
    create.mutate(
      {
        accountId: form.accountId,
        siteId: form.siteId,
        title: form.title,
        jobType: form.jobType,
        priority: form.priority,
        description: form.description,
        estimatedHours: Number(form.estimatedHours),
        slaDueAt: new Date(Date.now() + form.slaDays * 86400000).toISOString(),
      },
      { onSuccess: () => setOpen(false) }
    );
  };

  const siteOptions = (sites.data ?? []).filter(
    (s) => !form.accountId || s.accountId === form.accountId
  );

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        <select className={`${inputCls} max-w-[180px]`} value={status} onChange={(e) => setStatus(e.target.value)}>
          <option value="">All statuses</option>
          {STATUSES.map((s) => (
            <option key={s} value={s}>{s.replace(/_/g, " ")}</option>
          ))}
        </select>
        <select className={`${inputCls} max-w-[150px]`} value={priority} onChange={(e) => setPriority(e.target.value)}>
          <option value="">All priorities</option>
          {PRIORITIES.map((p) => (
            <option key={p} value={p}>{p}</option>
          ))}
        </select>
        <label className="flex items-center gap-2 text-sm text-slate-600">
          <input type="checkbox" checked={unassigned} onChange={(e) => setUnassigned(e.target.checked)} />
          Unassigned only
        </label>
        <div className="ml-auto">
          <Button onClick={() => setOpen(true)}>+ New Work Order</Button>
        </div>
      </div>

      <PageState
        loading={query.isLoading}
        error={query.error}
        empty={query.data?.length === 0}
        emptyLabel="No work orders match these filters."
      >
        {query.data && (
          <DataTable
            rows={query.data}
            rowKey={(w) => w.id}
            onRowClick={(w) => nav(`/work-orders/${w.id}`)}
            columns={[
              { header: "WO #", cell: (w) => <span className="font-medium text-brand-600">{w.workOrderNumber}</span> },
              { header: "Title", cell: (w) => w.title },
              { header: "Account", cell: (w) => w.account?.name ?? "—" },
              { header: "Priority", cell: (w) => <Badge value={w.priority} /> },
              { header: "Status", cell: (w) => <Badge value={w.status} /> },
              {
                header: "Assigned",
                cell: (w) =>
                  w.assignedEmployee
                    ? `${w.assignedEmployee.firstName} ${w.assignedEmployee.lastName}`
                    : <span className="text-amber-600">Unassigned</span>,
              },
              {
                header: "SLA Due",
                cell: (w) => (
                  <span className={w.slaBreached ? "font-medium text-red-600" : ""}>
                    {date(w.slaDueAt)}
                    {w.slaBreached && " ⚠"}
                  </span>
                ),
              },
            ]}
          />
        )}
      </PageState>

      <Modal open={open} onClose={() => setOpen(false)} title="New Work Order">
        <div className="space-y-3">
          <Field label="Account">
            <select
              className={inputCls}
              value={form.accountId}
              onChange={(e) => setForm({ ...form, accountId: e.target.value, siteId: "" })}
            >
              <option value="">Select account…</option>
              {(accounts.data ?? []).map((a) => (
                <option key={a.id} value={a.id}>{a.name}</option>
              ))}
            </select>
          </Field>
          <Field label="Site">
            <select
              className={inputCls}
              value={form.siteId}
              onChange={(e) => setForm({ ...form, siteId: e.target.value })}
            >
              <option value="">Select site…</option>
              {siteOptions.map((s) => (
                <option key={s.id} value={s.id}>{s.name} — {s.suburb}</option>
              ))}
            </select>
          </Field>
          <Field label="Title">
            <input className={inputCls} value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} />
          </Field>
          <Field label="Description">
            <textarea className={inputCls} rows={2} value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} />
          </Field>
          <div className="grid grid-cols-2 gap-3">
            <Field label="Job Type">
              <select className={inputCls} value={form.jobType} onChange={(e) => setForm({ ...form, jobType: e.target.value })}>
                {JOB_TYPES.map((j) => <option key={j} value={j}>{j.replace(/_/g, " ")}</option>)}
              </select>
            </Field>
            <Field label="Priority">
              <select className={inputCls} value={form.priority} onChange={(e) => setForm({ ...form, priority: e.target.value })}>
                {PRIORITIES.map((p) => <option key={p} value={p}>{p}</option>)}
              </select>
            </Field>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <Field label="Estimated Hours">
              <input type="number" className={inputCls} value={form.estimatedHours} onChange={(e) => setForm({ ...form, estimatedHours: Number(e.target.value) })} />
            </Field>
            <Field label="SLA Due (days)">
              <input type="number" className={inputCls} value={form.slaDays} onChange={(e) => setForm({ ...form, slaDays: Number(e.target.value) })} />
            </Field>
          </div>
          {create.isError && <p className="text-sm text-red-600">{(create.error as Error).message}</p>}
          <div className="flex justify-end gap-2 pt-2">
            <Button variant="secondary" onClick={() => setOpen(false)}>Cancel</Button>
            <Button disabled={!form.accountId || !form.siteId || !form.title || create.isPending} onClick={submit}>
              {create.isPending ? "Creating…" : "Create Work Order"}
            </Button>
          </div>
        </div>
      </Modal>
    </div>
  );
}
