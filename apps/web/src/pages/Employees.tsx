import { useState } from "react";
import { useList, useApiMutation } from "../lib/hooks";
import { api, currency } from "../lib/api";
import { Employee } from "../lib/types";
import { PageState, DataTable, Badge, Button, Modal, Field, inputCls } from "../components/ui";

const ROLES = ["TECHNICIAN", "SENIOR_TECHNICIAN", "DISPATCHER", "SUPERVISOR", "ADMIN", "MANAGER"];
const EMP_TYPES = ["FULL_TIME", "PART_TIME", "CASUAL", "SUBCONTRACTOR"];

const blank = {
  firstName: "",
  lastName: "",
  role: "TECHNICIAN",
  email: "",
  phone: "",
  hourlyCost: 45,
  employmentType: "FULL_TIME",
  territory: "Bendigo",
  active: true,
};

export default function Employees() {
  const [role, setRole] = useState("");
  const query = useList<Employee[]>(`/employees${role ? `?role=${role}` : ""}`);
  const [open, setOpen] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [form, setForm] = useState({ ...blank });

  const save = useApiMutation(
    (b: typeof blank) =>
      editingId
        ? api.put(`/employees/${editingId}`, b)
        : api.post("/employees", b),
    ["/employees"]
  );

  const startNew = () => {
    setEditingId(null);
    setForm({ ...blank });
    save.reset();
    setOpen(true);
  };
  const startEdit = (e: Employee) => {
    setEditingId(e.id);
    setForm({
      firstName: e.firstName,
      lastName: e.lastName,
      role: e.role,
      email: e.email ?? "",
      phone: e.phone ?? "",
      hourlyCost: e.hourlyCost,
      employmentType: e.employmentType,
      territory: e.territory ?? "",
      active: e.active,
    });
    save.reset();
    setOpen(true);
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <select className={`${inputCls} max-w-xs`} value={role} onChange={(e) => setRole(e.target.value)}>
          <option value="">All roles</option>
          {ROLES.map((r) => <option key={r} value={r}>{r.replace(/_/g, " ")}</option>)}
        </select>
        <Button onClick={startNew}>+ New Employee</Button>
      </div>

      <PageState loading={query.isLoading} error={query.error} empty={query.data?.length === 0}>
        {query.data && (
          <DataTable
            rows={query.data}
            rowKey={(e) => e.id}
            columns={[
              { header: "Name", cell: (e) => <span className="font-medium">{e.firstName} {e.lastName}</span> },
              { header: "Role", cell: (e) => <Badge value={e.role} /> },
              { header: "Type", cell: (e) => e.employmentType.replace(/_/g, " ") },
              { header: "Territory", cell: (e) => e.territory ?? "—" },
              { header: "Hourly Cost", cell: (e) => currency(e.hourlyCost) },
              {
                header: "Skills",
                cell: (e) =>
                  (e.skills ?? []).slice(0, 3).map((s) => s.skill.name).join(", ") +
                  ((e.skills?.length ?? 0) > 3 ? "…" : "") || "—",
              },
              { header: "Jobs", cell: (e) => e._count?.workOrders ?? 0 },
              { header: "Active", cell: (e) => (e.active ? <Badge value="AVAILABLE" /> : <Badge value="RETIRED" />) },
              {
                header: "",
                cell: (e) => (
                  <button
                    className="text-sm font-medium text-brand-600 hover:underline"
                    onClick={() => startEdit(e)}
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
        title={editingId ? "Edit Employee" : "New Employee"}
      >
        <div className="space-y-3">
          <div className="grid grid-cols-2 gap-3">
            <Field label="First Name">
              <input className={inputCls} value={form.firstName} onChange={(e) => setForm({ ...form, firstName: e.target.value })} />
            </Field>
            <Field label="Last Name">
              <input className={inputCls} value={form.lastName} onChange={(e) => setForm({ ...form, lastName: e.target.value })} />
            </Field>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <Field label="Role">
              <select className={inputCls} value={form.role} onChange={(e) => setForm({ ...form, role: e.target.value })}>
                {ROLES.map((r) => <option key={r} value={r}>{r.replace(/_/g, " ")}</option>)}
              </select>
            </Field>
            <Field label="Employment Type">
              <select className={inputCls} value={form.employmentType} onChange={(e) => setForm({ ...form, employmentType: e.target.value })}>
                {EMP_TYPES.map((t) => <option key={t} value={t}>{t.replace(/_/g, " ")}</option>)}
              </select>
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
          <div className="grid grid-cols-2 gap-3">
            <Field label="Hourly Cost">
              <input type="number" className={inputCls} value={form.hourlyCost} onChange={(e) => setForm({ ...form, hourlyCost: Number(e.target.value) })} />
            </Field>
            <Field label="Territory">
              <input className={inputCls} value={form.territory} onChange={(e) => setForm({ ...form, territory: e.target.value })} />
            </Field>
          </div>
          {save.isError && <p className="text-sm text-red-600">{(save.error as Error).message}</p>}
          <div className="flex justify-end gap-2 pt-2">
            <Button variant="secondary" onClick={() => setOpen(false)}>Cancel</Button>
            <Button
              disabled={!form.firstName || !form.lastName || save.isPending}
              onClick={() => save.mutate(form, { onSuccess: () => setOpen(false) })}
            >
              {save.isPending
                ? "Saving…"
                : editingId
                  ? "Save Changes"
                  : "Create Employee"}
            </Button>
          </div>
        </div>
      </Modal>
    </div>
  );
}
