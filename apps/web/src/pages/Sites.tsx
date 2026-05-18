import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { useList, useApiMutation } from "../lib/hooks";
import { api } from "../lib/api";
import { Site, Account } from "../lib/types";
import { PageState, DataTable, Button, Modal, Field, inputCls, Badge } from "../components/ui";

const blank = {
  accountId: "",
  name: "",
  address: "",
  suburb: "",
  state: "VIC",
  postcode: "",
  preferredVisitWindow: "08:00-12:00",
};

export default function Sites() {
  const nav = useNavigate();
  const query = useList<Site[]>("/sites");
  const accounts = useList<Account[]>("/accounts");
  const [open, setOpen] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [form, setForm] = useState({ ...blank });

  const save = useApiMutation(
    (b: typeof blank) =>
      editingId ? api.put(`/sites/${editingId}`, b) : api.post("/sites", b),
    ["/sites"]
  );

  const startNew = () => {
    setEditingId(null);
    setForm({ ...blank });
    save.reset();
    setOpen(true);
  };
  const startEdit = (s: Site) => {
    setEditingId(s.id);
    setForm({
      accountId: s.accountId,
      name: s.name,
      address: s.address,
      suburb: s.suburb,
      state: s.state,
      postcode: s.postcode,
      preferredVisitWindow: s.preferredVisitWindow ?? "",
    });
    save.reset();
    setOpen(true);
  };

  return (
    <div className="space-y-4">
      <div className="flex justify-end">
        <Button onClick={startNew}>+ New Site</Button>
      </div>
      <PageState loading={query.isLoading} error={query.error} empty={query.data?.length === 0}>
        {query.data && (
          <DataTable
            rows={query.data}
            rowKey={(s) => s.id}
            onRowClick={(s) => nav(`/accounts/${s.accountId}`)}
            columns={[
              { header: "Site", cell: (s) => <span className="font-medium">{s.name}</span> },
              { header: "Account", cell: (s) => s.account?.name ?? "—" },
              { header: "Address", cell: (s) => `${s.address}, ${s.suburb}` },
              { header: "State", cell: (s) => s.state },
              { header: "Postcode", cell: (s) => s.postcode },
              { header: "Pets", cell: (s) => (s.petsOnSite ? <Badge value="PETS" /> : "—") },
              { header: "Window", cell: (s) => s.preferredVisitWindow ?? "—" },
              { header: "Work Orders", cell: (s) => s._count?.workOrders ?? 0 },
              {
                header: "",
                cell: (s) => (
                  <button
                    className="text-sm font-medium text-brand-600 hover:underline"
                    onClick={(ev) => {
                      ev.stopPropagation();
                      startEdit(s);
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
        title={editingId ? "Edit Site" : "New Site"}
      >
        <div className="space-y-3">
          <Field label="Account">
            <select className={inputCls} value={form.accountId} onChange={(e) => setForm({ ...form, accountId: e.target.value })}>
              <option value="">Select account…</option>
              {(accounts.data ?? []).map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}
            </select>
          </Field>
          <Field label="Site Name">
            <input className={inputCls} value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />
          </Field>
          <Field label="Address">
            <input className={inputCls} value={form.address} onChange={(e) => setForm({ ...form, address: e.target.value })} />
          </Field>
          <div className="grid grid-cols-3 gap-3">
            <Field label="Suburb">
              <input className={inputCls} value={form.suburb} onChange={(e) => setForm({ ...form, suburb: e.target.value })} />
            </Field>
            <Field label="State">
              <input className={inputCls} value={form.state} onChange={(e) => setForm({ ...form, state: e.target.value })} />
            </Field>
            <Field label="Postcode">
              <input className={inputCls} value={form.postcode} onChange={(e) => setForm({ ...form, postcode: e.target.value })} />
            </Field>
          </div>
          {save.isError && <p className="text-sm text-red-600">{(save.error as Error).message}</p>}
          <div className="flex justify-end gap-2 pt-2">
            <Button variant="secondary" onClick={() => setOpen(false)}>Cancel</Button>
            <Button
              disabled={!form.accountId || !form.name || !form.address || !form.suburb || !form.postcode || save.isPending}
              onClick={() => save.mutate(form, { onSuccess: () => setOpen(false) })}
            >
              {save.isPending
                ? "Saving…"
                : editingId
                  ? "Save Changes"
                  : "Create Site"}
            </Button>
          </div>
        </div>
      </Modal>
    </div>
  );
}
