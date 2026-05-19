import { useState } from "react";
import { useParams, Link, useNavigate } from "react-router-dom";
import { useOne, useList, useApiMutation } from "../lib/hooks";
import {
  api,
  currency,
  dateTime,
  date,
  openAuthed,
  uploadAuthed,
} from "../lib/api";
import { useQueryClient } from "@tanstack/react-query";
import { WorkOrder, JobCosting, Employee } from "../lib/types";
import {
  PageState,
  Card,
  Badge,
  Button,
  Tabs,
  Field,
  inputCls,
} from "../components/ui";

const STATUSES = [
  "NEW", "TRIAGE", "QUOTE_REQUIRED", "AWAITING_APPROVAL", "APPROVED",
  "SCHEDULED", "DISPATCHED", "IN_PROGRESS", "WAITING_ON_PARTS",
  "COMPLETED", "INVOICED", "CLOSED", "CANCELLED",
];

export default function WorkOrderDetail() {
  const { id } = useParams();
  const nav = useNavigate();
  const wo = useOne<WorkOrder>(`/work-orders/${id}`);
  const costing = useOne<JobCosting>(`/work-orders/${id}/costing`);
  const employees = useList<Employee[]>("/employees?active=true");

  const inval = [`/work-orders/${id}`, "/work-orders", "/dashboard", "/quotes", "/invoices"];
  const setStatus = useApiMutation(
    (status: string) => api.patch(`/work-orders/${id}/status`, { status }),
    inval
  );
  const assign = useApiMutation(
    (assignedEmployeeId: string | null) =>
      api.patch(`/work-orders/${id}/assign`, { assignedEmployeeId }),
    inval
  );
  const schedule = useApiMutation(
    (body: { scheduledStart: string; scheduledEnd: string }) =>
      api.patch(`/work-orders/${id}/schedule`, body),
    inval
  );
  const complete = useApiMutation(
    (body: { actualHours: number; completionNotes: string }) =>
      api.post(`/work-orders/${id}/complete`, body),
    inval
  );
  const invoice = useApiMutation(
    () => api.post(`/invoices/from-work-order/${id}`),
    inval
  );

  const [actualHours, setActualHours] = useState(2);
  const [completionNotes, setCompletionNotes] = useState("");
  const [start, setStart] = useState("");
  const [end, setEnd] = useState("");

  const terminal =
    !!wo.data &&
    ["COMPLETED", "INVOICED", "CLOSED", "CANCELLED"].includes(wo.data.status);

  return (
    <PageState loading={wo.isLoading} error={wo.error}>
      {wo.data && (
        <div className="space-y-4">
          <Card className="p-5">
            <div className="flex items-start justify-between">
              <div>
                <div className="text-sm font-medium text-brand-600">
                  {wo.data.workOrderNumber}
                </div>
                <h2 className="text-xl font-semibold">{wo.data.title}</h2>
                <div className="mt-1 text-sm text-slate-500">
                  {wo.data.account && (
                    <Link className="text-brand-600 hover:underline" to={`/accounts/${wo.data.accountId}`}>
                      {wo.data.account.name}
                    </Link>
                  )}{" "}
                  · {wo.data.site?.name} — {wo.data.site?.suburb}
                </div>
              </div>
              <div className="flex flex-col items-end gap-2">
                <div className="flex gap-2">
                  <Badge value={wo.data.jobType} />
                  <Badge value={wo.data.priority} />
                  <Badge value={wo.data.status} />
                </div>
                {wo.data.slaBreached && (
                  <span className="text-sm font-medium text-red-600">
                    ⚠ SLA breached
                  </span>
                )}
              </div>
            </div>
          </Card>

          <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
            <div className="space-y-4 lg:col-span-2">
              <Tabs
                tabs={[
                  {
                    label: "Details",
                    content: (
                      <Card className="space-y-3 p-5 text-sm">
                        <Row label="Description" value={wo.data.description ?? "—"} />
                        <Row label="Customer Notes" value={wo.data.customerNotes ?? "—"} />
                        <Row label="Internal Notes" value={wo.data.internalNotes ?? "—"} />
                        <Row label="Scheduled" value={`${dateTime(wo.data.scheduledStart)} → ${dateTime(wo.data.scheduledEnd)}`} />
                        <Row label="SLA Due" value={date(wo.data.slaDueAt)} />
                        <Row label="Estimated Hours" value={String(wo.data.estimatedHours ?? "—")} />
                        <Row label="Actual Hours" value={String(wo.data.actualHours ?? "—")} />
                        <Row
                          label="Required Skills"
                          value={
                            (wo.data.requiredSkills ?? []).map((s) => s.skill.name).join(", ") || "—"
                          }
                        />
                        {wo.data.completionNotes && (
                          <Row label="Completion Notes" value={wo.data.completionNotes} />
                        )}
                      </Card>
                    ),
                  },
                  {
                    label: `Quotes (${wo.data.quotes?.length ?? 0})`,
                    content: (
                      <Card className="divide-y divide-slate-100">
                        {(wo.data.quotes ?? []).map((q) => (
                          <Link key={q.id} to={`/quotes/${q.id}`} className="flex items-center justify-between p-4 text-sm hover:bg-slate-50">
                            <span className="font-medium text-brand-600">{q.quoteNumber}</span>
                            <div className="flex items-center gap-3">
                              <span>{currency(q.total)}</span>
                              <Badge value={q.status} />
                            </div>
                          </Link>
                        ))}
                        {wo.data.quotes?.length === 0 && (
                          <div className="p-6 text-sm text-slate-500">No quotes yet.</div>
                        )}
                      </Card>
                    ),
                  },
                  {
                    label: `Materials (${wo.data.stockMovements?.length ?? 0})`,
                    content: (
                      <Card className="divide-y divide-slate-100">
                        {(wo.data.stockMovements ?? []).map((m) => (
                          <div key={m.id} className="flex justify-between p-4 text-sm">
                            <span>{m.inventoryItem?.name}</span>
                            <span className="text-slate-500">
                              {m.quantity} {m.inventoryItem?.unit} · {m.movementType.replace(/_/g, " ")}
                            </span>
                          </div>
                        ))}
                        {wo.data.stockMovements?.length === 0 && (
                          <div className="p-6 text-sm text-slate-500">No materials consumed.</div>
                        )}
                      </Card>
                    ),
                  },
                  {
                    label: `Files (${wo.data.attachments?.length ?? 0})`,
                    content: <AttachmentsTab woId={wo.data.id} />,
                  },
                  {
                    label: `Time (${wo.data.timeEntries?.length ?? 0})`,
                    content: (
                      <TimeTab
                        woId={wo.data.id}
                        employees={employees.data ?? []}
                      />
                    ),
                  },
                  {
                    label: "Job Costing",
                    content: (
                      <PageState loading={costing.isLoading} error={costing.error}>
                        {costing.data && (
                          <Card className="p-5">
                            <div className="mb-4 flex items-center justify-between">
                              <h3 className="font-semibold">Profitability</h3>
                              {costing.data.marginRisk && <Badge value="MARGIN RISK" />}
                            </div>
                            <div className="grid grid-cols-2 gap-x-8 gap-y-2 text-sm">
                              <Row label="Quoted Revenue" value={currency(costing.data.quotedRevenue)} />
                              <Row label="Invoice Revenue" value={currency(costing.data.invoiceRevenue)} />
                              <Row label="Est. Labour Cost" value={currency(costing.data.estLabourCost)} />
                              <Row label="Actual Labour Cost" value={currency(costing.data.actualLabourCost)} />
                              <Row
                                label="Labour Source"
                                value={
                                  costing.data.labourSource === "TIMESHEET"
                                    ? `Timesheets (${costing.data.timesheetHours}h)`
                                    : "Estimated hours"
                                }
                              />
                              <Row label="Material Cost" value={currency(costing.data.materialCost)} />
                              <Row label="Subcontractor" value={currency(costing.data.subcontractorCost)} />
                              <Row label="Equipment" value={currency(costing.data.equipmentCost)} />
                              <Row label="Travel / Disposal" value={currency(costing.data.travelCost + costing.data.disposalCost)} />
                            </div>
                            <hr className="my-4" />
                            <div className="grid grid-cols-3 gap-4">
                              <Stat label="Revenue" value={currency(costing.data.revenue)} />
                              <Stat
                                label="Gross Profit"
                                value={currency(costing.data.grossProfit)}
                                danger={costing.data.grossProfit < 0}
                              />
                              <Stat
                                label="Gross Margin"
                                value={`${costing.data.grossMarginPercent}%`}
                                danger={costing.data.marginRisk}
                              />
                            </div>
                            <p className="mt-3 text-xs text-slate-500">
                              Variance from quote: {currency(costing.data.varianceFromQuote)}
                            </p>
                          </Card>
                        )}
                      </PageState>
                    ),
                  },
                ]}
              />
            </div>

            <div className="space-y-4">
              <Card className="space-y-3 p-5">
                <h3 className="font-semibold">Dispatch</h3>
                {terminal && (
                  <p className="rounded-md bg-slate-100 px-3 py-2 text-xs text-slate-500">
                    This work order is {wo.data.status} — dispatch, completion
                    and billing actions are locked.
                  </p>
                )}
                <Field label="Assigned Technician">
                  <select
                    className={inputCls}
                    disabled={terminal}
                    value={wo.data.assignedEmployeeId ?? ""}
                    onChange={(e) => assign.mutate(e.target.value || null)}
                  >
                    <option value="">Unassigned</option>
                    {(employees.data ?? [])
                      .filter((e) => ["TECHNICIAN", "SENIOR_TECHNICIAN"].includes(e.role))
                      .map((e) => (
                        <option key={e.id} value={e.id}>
                          {e.firstName} {e.lastName}
                        </option>
                      ))}
                  </select>
                </Field>
                <Field label="Status">
                  <select
                    className={inputCls}
                    value={wo.data.status}
                    onChange={(e) => setStatus.mutate(e.target.value)}
                  >
                    {STATUSES.map((s) => (
                      <option key={s} value={s}>{s.replace(/_/g, " ")}</option>
                    ))}
                  </select>
                </Field>
                <div className="grid grid-cols-2 gap-2">
                  <Field label="Start">
                    <input type="datetime-local" className={inputCls} value={start} onChange={(e) => setStart(e.target.value)} />
                  </Field>
                  <Field label="End">
                    <input type="datetime-local" className={inputCls} value={end} onChange={(e) => setEnd(e.target.value)} />
                  </Field>
                </div>
                <Button
                  variant="secondary"
                  disabled={!start || !end || schedule.isPending || terminal}
                  onClick={() =>
                    schedule.mutate({
                      scheduledStart: new Date(start).toISOString(),
                      scheduledEnd: new Date(end).toISOString(),
                    })
                  }
                >
                  Save Schedule
                </Button>
              </Card>

              <Card className="space-y-3 p-5">
                <h3 className="font-semibold">Complete Job</h3>
                <Field label="Actual Hours">
                  <input type="number" className={inputCls} value={actualHours} onChange={(e) => setActualHours(Number(e.target.value))} />
                </Field>
                <Field label="Completion Notes">
                  <textarea className={inputCls} rows={2} value={completionNotes} onChange={(e) => setCompletionNotes(e.target.value)} />
                </Field>
                <Button
                  disabled={complete.isPending || terminal}
                  onClick={() => complete.mutate({ actualHours, completionNotes })}
                >
                  Mark Completed
                </Button>
              </Card>

              <Card className="space-y-3 p-5">
                <h3 className="font-semibold">Billing</h3>
                <Button
                  variant="secondary"
                  disabled={invoice.isPending || wo.data.status !== "COMPLETED"}
                  onClick={() =>
                    invoice.mutate(undefined, {
                      onSuccess: () => nav("/invoices"),
                    })
                  }
                >
                  Generate Invoice from Work Order
                </Button>
                {wo.data.status !== "COMPLETED" && (
                  <p className="text-xs text-slate-400">
                    Available once the work order is COMPLETED.
                  </p>
                )}
                {invoice.isError && (
                  <p className="text-sm text-red-600">
                    {(invoice.error as Error).message}
                  </p>
                )}
              </Card>
            </div>
          </div>
        </div>
      )}
    </PageState>
  );
}

function AttachmentsTab({ woId }: { woId: string }) {
  const qc = useQueryClient();
  const list = useList<
    { id: string; filename: string; kind: string; uploadedByEmail?: string | null; createdAt: string }[]
  >(`/work-orders/${woId}/attachments`);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const refresh = () => {
    qc.invalidateQueries({ predicate: (q) => String(q.queryKey[0]).includes(`/work-orders/${woId}`) });
  };

  const onPick = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setBusy(true);
    setErr(null);
    try {
      await uploadAuthed(`/work-orders/${woId}/attachments`, file);
      refresh();
    } catch (x) {
      setErr((x as Error).message);
    } finally {
      setBusy(false);
      e.target.value = "";
    }
  };

  const del = async (id: string) => {
    if (!window.confirm("Delete this attachment?")) return;
    try {
      await api.del(`/attachments/${id}`);
      refresh();
    } catch (x) {
      setErr((x as Error).message);
    }
  };

  return (
    <Card className="p-5">
      <div className="mb-3 flex items-center justify-between">
        <h3 className="font-semibold">Photos & Documents</h3>
        <label className="cursor-pointer rounded-lg bg-brand-600 px-3 py-2 text-sm font-medium text-white hover:bg-brand-700">
          {busy ? "Uploading…" : "Upload file"}
          <input type="file" className="hidden" onChange={onPick} disabled={busy} />
        </label>
      </div>
      {err && <p className="mb-2 text-sm text-red-600">{err}</p>}
      <PageState
        loading={list.isLoading}
        error={list.error}
        empty={list.data?.length === 0}
        emptyLabel="No files yet. Upload before/after photos or signed docs."
      >
        <div className="divide-y divide-slate-100">
          {(list.data ?? []).map((a) => (
            <div key={a.id} className="flex items-center justify-between py-3 text-sm">
              <div>
                <button
                  className="font-medium text-brand-600 hover:underline"
                  onClick={() => openAuthed(`/attachments/${a.id}/download`)}
                >
                  {a.filename}
                </button>
                <div className="text-xs text-slate-400">
                  {a.kind} · {a.uploadedByEmail ?? "—"} · {dateTime(a.createdAt)}
                </div>
              </div>
              <button
                className="text-xs text-red-600 hover:underline"
                onClick={() => del(a.id)}
              >
                Delete
              </button>
            </div>
          ))}
        </div>
      </PageState>
    </Card>
  );
}

function TimeTab({
  woId,
  employees,
}: {
  woId: string;
  employees: Employee[];
}) {
  const qc = useQueryClient();
  const list = useList<
    { id: string; hours: number; date: string; notes?: string | null; employee?: Employee }[]
  >(`/work-orders/${woId}/time-entries`);
  const [employeeId, setEmployeeId] = useState("");
  const [hours, setHours] = useState(1);
  const [notes, setNotes] = useState("");

  const refresh = () =>
    qc.invalidateQueries({
      predicate: (q) => String(q.queryKey[0]).includes(`/work-orders/${woId}`),
    });

  const add = useApiMutation(
    (body: { employeeId: string; hours: number; notes: string }) =>
      api.post(`/work-orders/${woId}/time-entries`, body),
    []
  );
  const techs = employees.filter((e) =>
    ["TECHNICIAN", "SENIOR_TECHNICIAN"].includes(e.role)
  );

  return (
    <Card className="p-5">
      <h3 className="mb-3 font-semibold">Timesheets</h3>
      <div className="mb-4 grid grid-cols-1 gap-2 sm:grid-cols-4">
        <select
          className={inputCls}
          value={employeeId}
          onChange={(e) => setEmployeeId(e.target.value)}
        >
          <option value="">Technician…</option>
          {techs.map((t) => (
            <option key={t.id} value={t.id}>
              {t.firstName} {t.lastName}
            </option>
          ))}
        </select>
        <input
          type="number"
          step="0.25"
          className={inputCls}
          value={hours}
          onChange={(e) => setHours(Number(e.target.value))}
          placeholder="Hours"
        />
        <input
          className={inputCls}
          value={notes}
          onChange={(e) => setNotes(e.target.value)}
          placeholder="Notes"
        />
        <Button
          disabled={!employeeId || hours <= 0 || add.isPending}
          onClick={() =>
            add.mutate(
              { employeeId, hours, notes },
              {
                onSuccess: () => {
                  setNotes("");
                  refresh();
                },
              }
            )
          }
        >
          Log time
        </Button>
      </div>
      <PageState
        loading={list.isLoading}
        error={list.error}
        empty={list.data?.length === 0}
        emptyLabel="No time logged. Logged hours drive actual labour cost."
      >
        <div className="divide-y divide-slate-100">
          {(list.data ?? []).map((t) => (
            <div key={t.id} className="flex justify-between py-2 text-sm">
              <span>
                {t.employee
                  ? `${t.employee.firstName} ${t.employee.lastName}`
                  : "—"}{" "}
                · {t.hours}h
              </span>
              <span className="text-slate-500">
                {date(t.date)} {t.notes ? `· ${t.notes}` : ""}
              </span>
            </div>
          ))}
        </div>
      </PageState>
    </Card>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex justify-between gap-4">
      <span className="text-slate-500">{label}</span>
      <span className="text-right font-medium">{value}</span>
    </div>
  );
}

function Stat({ label, value, danger }: { label: string; value: string; danger?: boolean }) {
  return (
    <div className="rounded-lg bg-slate-50 p-3 text-center">
      <div className="text-xs uppercase text-slate-500">{label}</div>
      <div className={`mt-1 text-lg font-semibold ${danger ? "text-red-600" : "text-slate-900"}`}>
        {value}
      </div>
    </div>
  );
}
