import { useState } from "react";
import { useList, useApiMutation } from "../lib/hooks";
import { api } from "../lib/api";
import { Supplier } from "../lib/types";
import { PageState, DataTable, Button, Modal, Field, inputCls } from "../components/ui";

const blank = {
  name: "",
  contactName: "",
  email: "",
  phone: "",
  address: "",
  paymentTerms: "NET_30",
};

export default function Suppliers() {
  const query = useList<Supplier[]>("/suppliers");
  const [open, setOpen] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [form, setForm] = useState({ ...blank });

  const save = useApiMutation(
    (b: typeof blank) =>
      editingId
        ? api.put(`/suppliers/${editingId}`, b)
        : api.post("/suppliers", b),
    ["/suppliers"]
  );

  const startNew = () => {
    setEditingId(null);
    setForm({ ...blank });
    save.reset();
    setOpen(true);
  };
  const startEdit = (s: Supplier) => {
    setEditingId(s.id);
    setForm({
      name: s.name,
      contactName: s.contactName ?? "",
      email: s.email ?? "",
      phone: s.phone ?? "",
      address: s.address ?? "",
      paymentTerms: s.paymentTerms ?? "NET_30",
    });
    save.reset();
    setOpen(true);
  };

  return (
    <div className="space-y-4">
      <div className="flex justify-end">
        <Button onClick={startNew}>+ New Supplier</Button>
      </div>
      <PageState loading={query.isLoading} error={query.error} empty={query.data?.length === 0}>
        {query.data && (
          <DataTable
            rows={query.data}
            rowKey={(s) => s.id}
            columns={[
              { header: "Name", cell: (s) => <span className="font-medium">{s.name}</span> },
              { header: "Contact", cell: (s) => s.contactName ?? "—" },
              { header: "Email", cell: (s) => s.email ?? "—" },
              { header: "Phone", cell: (s) => s.phone ?? "—" },
              { header: "Terms", cell: (s) => s.paymentTerms ?? "—" },
              { header: "POs", cell: (s) => s._count?.purchaseOrders ?? 0 },
              {
                header: "",
                cell: (s) => (
                  <button
                    className="text-sm font-medium text-brand-600 hover:underline"
                    onClick={() => startEdit(s)}
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
        title={editingId ? "Edit Supplier" : "New Supplier"}
      >
        <div className="space-y-3">
          <Field label="Name">
            <input className={inputCls} value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />
          </Field>
          <div className="grid grid-cols-2 gap-3">
            <Field label="Contact Name">
              <input className={inputCls} value={form.contactName} onChange={(e) => setForm({ ...form, contactName: e.target.value })} />
            </Field>
            <Field label="Payment Terms">
              <input className={inputCls} value={form.paymentTerms} onChange={(e) => setForm({ ...form, paymentTerms: e.target.value })} />
            </Field>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <Field label="Email">
              <input className={inputCls} value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} />
            </Field>
            <Field label="Phone">
              <input className={inputCls} value={form.phone} onChange={(e) => setForm({ ...form, phone: e.target.value })} />
            </Field>
          </div>
          <Field label="Address">
            <input className={inputCls} value={form.address} onChange={(e) => setForm({ ...form, address: e.target.value })} />
          </Field>
          {save.isError && <p className="text-sm text-red-600">{(save.error as Error).message}</p>}
          <div className="flex justify-end gap-2 pt-2">
            <Button variant="secondary" onClick={() => setOpen(false)}>Cancel</Button>
            <Button
              disabled={!form.name || save.isPending}
              onClick={() => save.mutate(form, { onSuccess: () => setOpen(false) })}
            >
              {save.isPending
                ? "Saving…"
                : editingId
                  ? "Save Changes"
                  : "Create Supplier"}
            </Button>
          </div>
        </div>
      </Modal>
    </div>
  );
}
