import { useState } from "react";
import { useList, useApiMutation } from "../lib/hooks";
import { api, currency, date } from "../lib/api";
import {
  PurchaseOrder,
  InventoryLocation,
  Supplier,
  InventoryItem,
} from "../lib/types";
import {
  PageState,
  Card,
  Badge,
  Button,
  Modal,
  Field,
  inputCls,
} from "../components/ui";

interface DraftLine {
  inventoryItemId: string;
  quantity: number;
  unitCost: number;
}

export default function PurchaseOrders() {
  const query = useList<PurchaseOrder[]>("/purchase-orders");
  const locations = useList<InventoryLocation[]>("/inventory/locations");
  const suppliers = useList<Supplier[]>("/suppliers");
  const items = useList<InventoryItem[]>("/inventory/items");
  const [loc, setLoc] = useState("");
  const [open, setOpen] = useState(false);
  const [supplierId, setSupplierId] = useState("");
  const [expectedDate, setExpectedDate] = useState("");
  const [notes, setNotes] = useState("");
  const [lines, setLines] = useState<DraftLine[]>([
    { inventoryItemId: "", quantity: 1, unitCost: 0 },
  ]);

  const receive = useApiMutation(
    (id: string) =>
      api.post(`/purchase-orders/${id}/receive`, { toLocationId: loc }),
    ["/purchase-orders", "/inventory", "/dashboard"]
  );

  const create = useApiMutation(
    (body: unknown) => api.post("/purchase-orders", body),
    ["/purchase-orders"]
  );

  const resetForm = () => {
    setSupplierId("");
    setExpectedDate("");
    setNotes("");
    setLines([{ inventoryItemId: "", quantity: 1, unitCost: 0 }]);
    create.reset();
  };

  const setLine = (i: number, patch: Partial<DraftLine>) =>
    setLines((ls) => ls.map((l, idx) => (idx === i ? { ...l, ...patch } : l)));

  const validLines = lines.filter(
    (l) => l.inventoryItemId && l.quantity > 0
  );
  const draftTotal = validLines.reduce(
    (s, l) => s + l.quantity * l.unitCost,
    0
  );

  const submit = () =>
    create.mutate(
      {
        supplierId,
        expectedDate: expectedDate
          ? new Date(expectedDate).toISOString()
          : undefined,
        notes: notes || undefined,
        lines: validLines,
      },
      {
        onSuccess: () => {
          setOpen(false);
          resetForm();
        },
      }
    );

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <span className="text-sm text-slate-500">Receive into:</span>
          <select
            className={`${inputCls} max-w-xs`}
            value={loc}
            onChange={(e) => setLoc(e.target.value)}
          >
            <option value="">Select location…</option>
            {(locations.data ?? []).map((l) => (
              <option key={l.id} value={l.id}>
                {l.name}
              </option>
            ))}
          </select>
        </div>
        <Button
          onClick={() => {
            resetForm();
            setOpen(true);
          }}
        >
          + New Purchase Order
        </Button>
      </div>

      <PageState
        loading={query.isLoading}
        error={query.error}
        empty={query.data?.length === 0}
        emptyLabel="No purchase orders yet. Create one to order stock."
      >
        <div className="space-y-3">
          {(query.data ?? []).map((po) => (
            <Card key={po.id} className="p-4">
              <div className="flex items-center justify-between">
                <div>
                  <span className="font-medium text-brand-600">
                    {po.poNumber}
                  </span>
                  <span className="ml-2 text-sm text-slate-500">
                    {po.supplier?.name} · expected {date(po.expectedDate)}
                  </span>
                </div>
                <div className="flex items-center gap-3">
                  <Badge value={po.status} />
                  {po.status !== "RECEIVED" && po.status !== "CANCELLED" && (
                    <Button
                      variant="secondary"
                      disabled={!loc || receive.isPending}
                      onClick={() => receive.mutate(po.id)}
                    >
                      Receive Stock
                    </Button>
                  )}
                </div>
              </div>
              <table className="mt-3 w-full text-sm">
                <thead>
                  <tr className="text-left text-xs uppercase text-slate-400">
                    <th className="py-1">Item</th>
                    <th className="py-1">Qty</th>
                    <th className="py-1">Received</th>
                    <th className="py-1">Unit Cost</th>
                    <th className="py-1">Total</th>
                  </tr>
                </thead>
                <tbody>
                  {(po.lines ?? []).map((l) => (
                    <tr key={l.id} className="border-t border-slate-100">
                      <td className="py-1">{l.inventoryItem?.name}</td>
                      <td className="py-1">{l.quantity}</td>
                      <td className="py-1">{l.receivedQty}</td>
                      <td className="py-1">{currency(l.unitCost)}</td>
                      <td className="py-1">{currency(l.total)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </Card>
          ))}
        </div>
      </PageState>
      {receive.isError && (
        <p className="text-sm text-red-600">
          {(receive.error as Error).message}
        </p>
      )}

      <Modal
        open={open}
        onClose={() => setOpen(false)}
        title="New Purchase Order"
      >
        <div className="space-y-3">
          <Field label="Supplier">
            <select
              className={inputCls}
              value={supplierId}
              onChange={(e) => setSupplierId(e.target.value)}
            >
              <option value="">Select supplier…</option>
              {(suppliers.data ?? []).map((s) => (
                <option key={s.id} value={s.id}>
                  {s.name}
                </option>
              ))}
            </select>
          </Field>
          <div className="grid grid-cols-2 gap-3">
            <Field label="Expected date">
              <input
                type="date"
                className={inputCls}
                value={expectedDate}
                onChange={(e) => setExpectedDate(e.target.value)}
              />
            </Field>
            <Field label="Notes">
              <input
                className={inputCls}
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
              />
            </Field>
          </div>

          <div>
            <div className="mb-1 flex items-center justify-between">
              <span className="text-xs font-medium text-slate-600">
                Line items
              </span>
              <button
                className="text-xs font-medium text-brand-600 hover:underline"
                onClick={() =>
                  setLines((ls) => [
                    ...ls,
                    { inventoryItemId: "", quantity: 1, unitCost: 0 },
                  ])
                }
              >
                + Add line
              </button>
            </div>
            <div className="space-y-2">
              {lines.map((l, i) => (
                <div key={i} className="flex items-center gap-2">
                  <select
                    className={`${inputCls} flex-1`}
                    value={l.inventoryItemId}
                    onChange={(e) => {
                      const it = (items.data ?? []).find(
                        (x) => x.id === e.target.value
                      );
                      setLine(i, {
                        inventoryItemId: e.target.value,
                        unitCost: it ? it.unitCost : l.unitCost,
                      });
                    }}
                  >
                    <option value="">Item…</option>
                    {(items.data ?? []).map((it) => (
                      <option key={it.id} value={it.id}>
                        {it.sku} — {it.name}
                      </option>
                    ))}
                  </select>
                  <input
                    type="number"
                    className={`${inputCls} w-20`}
                    value={l.quantity}
                    min={1}
                    onChange={(e) =>
                      setLine(i, { quantity: Number(e.target.value) })
                    }
                  />
                  <input
                    type="number"
                    className={`${inputCls} w-24`}
                    value={l.unitCost}
                    min={0}
                    step="0.01"
                    onChange={(e) =>
                      setLine(i, { unitCost: Number(e.target.value) })
                    }
                  />
                  {lines.length > 1 && (
                    <button
                      className="text-xs text-red-600 hover:underline"
                      onClick={() =>
                        setLines((ls) => ls.filter((_, idx) => idx !== i))
                      }
                    >
                      ✕
                    </button>
                  )}
                </div>
              ))}
            </div>
            <div className="mt-2 text-right text-sm text-slate-500">
              Estimated total: {currency(draftTotal)}
            </div>
          </div>

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
                !supplierId || validLines.length === 0 || create.isPending
              }
              onClick={submit}
            >
              {create.isPending ? "Creating…" : "Create Purchase Order"}
            </Button>
          </div>
        </div>
      </Modal>
    </div>
  );
}
