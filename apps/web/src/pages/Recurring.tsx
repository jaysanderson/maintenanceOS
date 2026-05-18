import { useState } from "react";
import { useList, useApiMutation } from "../lib/hooks";
import { api, date } from "../lib/api";
import { Account, Site } from "../lib/types";
import {
  PageState,
  DataTable,
  Card,
  Button,
  Modal,
  Field,
  inputCls,
  Badge,
} from "../components/ui";

interface Plan {
  id: string;
  title: string;
  intervalDays: number;
  nextRunAt: string;
  lastGeneratedAt: string | null;
  active: boolean;
  account?: Account;
  site?: Site;
}

export default function Recurring() {
  const plans = useList<Plan[]>("/recurring");
  const accounts = useList<Account[]>("/accounts");
  const sites = useList<Site[]>("/sites");
  const [open, setOpen] = useState(false);
  const [runResult, setRunResult] = useState<string | null>(null);
  const [form, setForm] = useState({
    accountId: "",
    siteId: "",
    title: "Quarterly property maintenance",
    intervalDays: 90,
  });

  const create = useApiMutation(
    (b: typeof form) => api.post("/recurring", b),
    ["/recurring"]
  );
  const run = useApiMutation(
    () => api.post<{ generated: number }>("/recurring/run"),
    ["/recurring", "/work-orders", "/dashboard", "/notifications"]
  );

  const siteOpts = (sites.data ?? []).filter(
    (s) => !form.accountId || s.accountId === form.accountId
  );

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <p className="text-sm text-slate-500">
          Contract / recurring maintenance templates. “Run due now” generates
          work orders for any plan whose next run date has passed.
        </p>
        <div className="flex gap-2">
          <Button
            variant="secondary"
            disabled={run.isPending}
            onClick={() =>
              run.mutate(undefined, {
                onSuccess: (r) =>
                  setRunResult(`${r.generated} work order(s) generated`),
              })
            }
          >
            {run.isPending ? "Running…" : "Run due now"}
          </Button>
          <Button onClick={() => setOpen(true)}>+ New Plan</Button>
        </div>
      </div>
      {runResult && (
        <Card className="bg-emerald-50 p-3 text-sm text-emerald-700">
          {runResult}
        </Card>
      )}

      <PageState
        loading={plans.isLoading}
        error={plans.error}
        empty={plans.data?.length === 0}
        emptyLabel="No recurring plans yet."
      >
        {plans.data && (
          <DataTable
            rows={plans.data}
            rowKey={(p) => p.id}
            columns={[
              { header: "Title", cell: (p) => <span className="font-medium">{p.title}</span> },
              { header: "Account", cell: (p) => p.account?.name ?? "—" },
              { header: "Site", cell: (p) => p.site?.name ?? "—" },
              { header: "Every", cell: (p) => `${p.intervalDays} days` },
              { header: "Next run", cell: (p) => date(p.nextRunAt) },
              { header: "Last generated", cell: (p) => date(p.lastGeneratedAt) },
              {
                header: "Active",
                cell: (p) =>
                  p.active ? <Badge value="AVAILABLE" /> : <Badge value="RETIRED" />,
              },
            ]}
          />
        )}
      </PageState>

      <Modal open={open} onClose={() => setOpen(false)} title="New Recurring Plan">
        <div className="space-y-3">
          <Field label="Account">
            <select
              className={inputCls}
              value={form.accountId}
              onChange={(e) =>
                setForm({ ...form, accountId: e.target.value, siteId: "" })
              }
            >
              <option value="">Select account…</option>
              {(accounts.data ?? []).map((a) => (
                <option key={a.id} value={a.id}>
                  {a.name}
                </option>
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
              {siteOpts.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.name} — {s.suburb}
                </option>
              ))}
            </select>
          </Field>
          <Field label="Title">
            <input
              className={inputCls}
              value={form.title}
              onChange={(e) => setForm({ ...form, title: e.target.value })}
            />
          </Field>
          <Field label="Interval (days)">
            <input
              type="number"
              className={inputCls}
              value={form.intervalDays}
              onChange={(e) =>
                setForm({ ...form, intervalDays: Number(e.target.value) })
              }
            />
          </Field>
          {create.isError && (
            <p className="text-sm text-red-600">
              {(create.error as Error).message}
            </p>
          )}
          <div className="flex justify-end gap-2 pt-2">
            <Button variant="secondary" onClick={() => setOpen(false)}>
              Cancel
            </Button>
            <Button
              disabled={
                !form.accountId || !form.siteId || !form.title || create.isPending
              }
              onClick={() =>
                create.mutate(form, { onSuccess: () => setOpen(false) })
              }
            >
              {create.isPending ? "Creating…" : "Create Plan"}
            </Button>
          </div>
        </div>
      </Modal>
    </div>
  );
}
