import { useState } from "react";
import { useList, useApiMutation } from "../lib/hooks";
import { api, currency } from "../lib/api";
import { StockLevel, InventoryItem, InventoryLocation } from "../lib/types";
import {
  PageState,
  DataTable,
  Badge,
  Button,
  Modal,
  Field,
  inputCls,
  Tabs,
  Card,
} from "../components/ui";

const blank = {
  sku: "",
  name: "",
  category: "",
  unit: "EA",
  unitCost: 0,
  sellPrice: 0,
  reorderPoint: 5,
};

export default function Inventory() {
  const levels = useList<StockLevel[]>("/inventory/stock-levels");
  const locations = useList<InventoryLocation[]>("/inventory/locations");
  const [open, setOpen] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [form, setForm] = useState({ ...blank });

  const save = useApiMutation(
    (b: typeof blank) =>
      editingId
        ? api.put<InventoryItem>(`/inventory/items/${editingId}`, b)
        : api.post<InventoryItem>("/inventory/items", b),
    ["/inventory"]
  );

  const startNew = () => {
    setEditingId(null);
    setForm({ ...blank });
    save.reset();
    setOpen(true);
  };
  const startEdit = (r: StockLevel) => {
    setEditingId(r.itemId);
    setForm({
      sku: r.sku,
      name: r.name,
      category: r.category ?? "",
      unit: r.unit,
      unitCost: r.unitCost,
      sellPrice: r.sellPrice,
      reorderPoint: r.reorderPoint,
    });
    save.reset();
    setOpen(true);
  };

  const rows = levels.data ?? [];
  const lowCount = rows.filter((r) => r.lowStock).length;

  const stockTable = (data: StockLevel[]) => (
    <DataTable
      rows={data}
      rowKey={(r) => r.itemId}
      columns={[
        { header: "SKU", cell: (r) => r.sku },
        { header: "Name", cell: (r) => <span className="font-medium">{r.name}</span> },
        { header: "Category", cell: (r) => r.category ?? "—" },
        { header: "Unit Cost", cell: (r) => currency(r.unitCost) },
        { header: "Sell", cell: (r) => currency(r.sellPrice) },
        { header: "On Hand", cell: (r) => `${r.totalQuantity} ${r.unit}` },
        { header: "Reorder Pt", cell: (r) => r.reorderPoint },
        {
          header: "Status",
          cell: (r) =>
            r.lowStock ? <Badge value="LOW STOCK" /> : <Badge value="OK" />,
        },
        {
          header: "",
          cell: (r) => (
            <button
              className="text-sm font-medium text-brand-600 hover:underline"
              onClick={() => startEdit(r)}
            >
              Edit
            </button>
          ),
        },
      ]}
    />
  );

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <p className="text-sm text-slate-500">
          {rows.length} items · {lowCount} below reorder point
        </p>
        <Button onClick={startNew}>+ New Item</Button>
      </div>

      <PageState loading={levels.isLoading} error={levels.error} empty={rows.length === 0}>
        <Tabs
          tabs={[
            { label: `All Items (${rows.length})`, content: stockTable(rows) },
            {
              label: `Low Stock (${lowCount})`,
              content:
                lowCount === 0 ? (
                  <Card className="p-10 text-center text-sm text-slate-500">
                    All items above reorder point.
                  </Card>
                ) : (
                  stockTable(rows.filter((r) => r.lowStock))
                ),
            },
            {
              label: `Locations (${locations.data?.length ?? 0})`,
              content: (
                <Card className="divide-y divide-slate-100">
                  {(locations.data ?? []).map((l) => (
                    <div key={l.id} className="flex justify-between p-4 text-sm">
                      <span className="font-medium">{l.name}</span>
                      <Badge value={l.type} />
                    </div>
                  ))}
                </Card>
              ),
            },
          ]}
        />
      </PageState>

      <Modal
        open={open}
        onClose={() => setOpen(false)}
        title={editingId ? "Edit Inventory Item" : "New Inventory Item"}
      >
        <div className="space-y-3">
          <div className="grid grid-cols-2 gap-3">
            <Field label="SKU">
              <input className={inputCls} value={form.sku} onChange={(e) => setForm({ ...form, sku: e.target.value })} />
            </Field>
            <Field label="Unit">
              <input className={inputCls} value={form.unit} onChange={(e) => setForm({ ...form, unit: e.target.value })} />
            </Field>
          </div>
          <Field label="Name">
            <input className={inputCls} value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />
          </Field>
          <Field label="Category">
            <input className={inputCls} value={form.category} onChange={(e) => setForm({ ...form, category: e.target.value })} />
          </Field>
          <div className="grid grid-cols-3 gap-3">
            <Field label="Unit Cost">
              <input type="number" className={inputCls} value={form.unitCost} onChange={(e) => setForm({ ...form, unitCost: Number(e.target.value) })} />
            </Field>
            <Field label="Sell Price">
              <input type="number" className={inputCls} value={form.sellPrice} onChange={(e) => setForm({ ...form, sellPrice: Number(e.target.value) })} />
            </Field>
            <Field label="Reorder Point">
              <input type="number" className={inputCls} value={form.reorderPoint} onChange={(e) => setForm({ ...form, reorderPoint: Number(e.target.value) })} />
            </Field>
          </div>
          {save.isError && <p className="text-sm text-red-600">{(save.error as Error).message}</p>}
          <div className="flex justify-end gap-2 pt-2">
            <Button variant="secondary" onClick={() => setOpen(false)}>Cancel</Button>
            <Button
              disabled={!form.sku || !form.name || save.isPending}
              onClick={() => save.mutate(form, { onSuccess: () => setOpen(false) })}
            >
              {save.isPending
                ? "Saving…"
                : editingId
                  ? "Save Changes"
                  : "Create Item"}
            </Button>
          </div>
        </div>
      </Modal>
    </div>
  );
}
