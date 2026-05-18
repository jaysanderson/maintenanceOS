import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { useList, useApiMutation } from "../lib/hooks";
import { api } from "../lib/api";
import { Account } from "../lib/types";
import {
  PageState,
  DataTable,
  Badge,
  Button,
  Modal,
  Field,
  inputCls,
} from "../components/ui";

const TYPES = [
  "HOMEOWNER",
  "REAL_ESTATE",
  "BODY_CORPORATE",
  "SCHOOL",
  "AGED_CARE",
  "COUNCIL",
  "COMMERCIAL",
];

const blank = {
  name: "",
  type: "REAL_ESTATE",
  primaryContactName: "",
  email: "",
  phone: "",
  accountManager: "",
  paymentTerms: "NET_30",
};

export default function Accounts() {
  const nav = useNavigate();
  const [typeFilter, setTypeFilter] = useState("");
  const [open, setOpen] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const query = useList<Account[]>(
    `/accounts${typeFilter ? `?type=${typeFilter}` : ""}`
  );
  const [form, setForm] = useState({ ...blank });

  const save = useApiMutation(
    (body: typeof blank) =>
      editingId
        ? api.put(`/accounts/${editingId}`, body)
        : api.post("/accounts", body),
    ["/accounts"]
  );

  const startNew = () => {
    setEditingId(null);
    setForm({ ...blank });
    save.reset();
    setOpen(true);
  };
  const startEdit = (a: Account) => {
    setEditingId(a.id);
    setForm({
      name: a.name,
      type: a.type,
      primaryContactName: a.primaryContactName ?? "",
      email: a.email ?? "",
      phone: a.phone ?? "",
      accountManager: a.accountManager ?? "",
      paymentTerms: a.paymentTerms ?? "NET_30",
    });
    save.reset();
    setOpen(true);
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <select
          className={`${inputCls} max-w-xs`}
          value={typeFilter}
          onChange={(e) => setTypeFilter(e.target.value)}
        >
          <option value="">All account types</option>
          {TYPES.map((t) => (
            <option key={t} value={t}>
              {t.replace(/_/g, " ")}
            </option>
          ))}
        </select>
        <Button onClick={startNew}>+ New Account</Button>
      </div>

      <PageState
        loading={query.isLoading}
        error={query.error}
        empty={query.data?.length === 0}
        emptyLabel="No accounts match this filter."
      >
        {query.data && (
          <DataTable
            rows={query.data}
            rowKey={(a) => a.id}
            onRowClick={(a) => nav(`/accounts/${a.id}`)}
            columns={[
              { header: "Name", cell: (a) => <span className="font-medium">{a.name}</span> },
              { header: "Type", cell: (a) => <Badge value={a.type} /> },
              { header: "Contact", cell: (a) => a.primaryContactName ?? "—" },
              { header: "Account Manager", cell: (a) => a.accountManager ?? "—" },
              { header: "Terms", cell: (a) => a.paymentTerms ?? "—" },
              { header: "Sites", cell: (a) => a._count?.sites ?? 0 },
              { header: "Work Orders", cell: (a) => a._count?.workOrders ?? 0 },
              {
                header: "",
                cell: (a) => (
                  <button
                    className="text-sm font-medium text-brand-600 hover:underline"
                    onClick={(ev) => {
                      ev.stopPropagation();
                      startEdit(a);
                    }}
                  >
                    Edit
                  </button>
                ),
              },
            ]}
          />
        )}
      </PageState>

      <Modal
        open={open}
        onClose={() => setOpen(false)}
        title={editingId ? "Edit Account" : "New Account"}
      >
        <div className="space-y-3">
          <Field label="Name">
            <input
              className={inputCls}
              value={form.name}
              onChange={(e) => setForm({ ...form, name: e.target.value })}
            />
          </Field>
          <Field label="Type">
            <select
              className={inputCls}
              value={form.type}
              onChange={(e) => setForm({ ...form, type: e.target.value })}
            >
              {TYPES.map((t) => (
                <option key={t} value={t}>
                  {t.replace(/_/g, " ")}
                </option>
              ))}
            </select>
          </Field>
          <Field label="Primary Contact">
            <input
              className={inputCls}
              value={form.primaryContactName}
              onChange={(e) =>
                setForm({ ...form, primaryContactName: e.target.value })
              }
            />
          </Field>
          <div className="grid grid-cols-2 gap-3">
            <Field label="Email">
              <input
                className={inputCls}
                value={form.email}
                onChange={(e) => setForm({ ...form, email: e.target.value })}
              />
            </Field>
            <Field label="Phone">
              <input
                className={inputCls}
                value={form.phone}
                onChange={(e) => setForm({ ...form, phone: e.target.value })}
              />
            </Field>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <Field label="Account Manager">
              <input
                className={inputCls}
                value={form.accountManager}
                onChange={(e) =>
                  setForm({ ...form, accountManager: e.target.value })
                }
              />
            </Field>
            <Field label="Payment Terms">
              <input
                className={inputCls}
                value={form.paymentTerms}
                onChange={(e) =>
                  setForm({ ...form, paymentTerms: e.target.value })
                }
              />
            </Field>
          </div>
          {save.isError && (
            <p className="text-sm text-red-600">
              {(save.error as Error).message}
            </p>
          )}
          <div className="flex justify-end gap-2 pt-2">
            <Button variant="secondary" onClick={() => setOpen(false)}>
              Cancel
            </Button>
            <Button
              disabled={!form.name || save.isPending}
              onClick={() =>
                save.mutate(form, { onSuccess: () => setOpen(false) })
              }
            >
              {save.isPending
                ? "Saving…"
                : editingId
                  ? "Save Changes"
                  : "Create Account"}
            </Button>
          </div>
        </div>
      </Modal>
    </div>
  );
}
