import { useState } from "react";
import { useList, useApiMutation } from "../lib/hooks";
import { api, currency, date } from "../lib/api";
import { PurchaseOrder, InventoryLocation } from "../lib/types";
import { PageState, Card, Badge, Button, inputCls } from "../components/ui";

export default function PurchaseOrders() {
  const query = useList<PurchaseOrder[]>("/purchase-orders");
  const locations = useList<InventoryLocation[]>("/inventory/locations");
  const [loc, setLoc] = useState("");

  const receive = useApiMutation(
    (id: string) => api.post(`/purchase-orders/${id}/receive`, { toLocationId: loc }),
    ["/purchase-orders", "/inventory", "/dashboard"]
  );

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-3">
        <span className="text-sm text-slate-500">Receive into:</span>
        <select className={`${inputCls} max-w-xs`} value={loc} onChange={(e) => setLoc(e.target.value)}>
          <option value="">Select location…</option>
          {(locations.data ?? []).map((l) => (
            <option key={l.id} value={l.id}>{l.name}</option>
          ))}
        </select>
      </div>

      <PageState loading={query.isLoading} error={query.error} empty={query.data?.length === 0}>
        <div className="space-y-3">
          {(query.data ?? []).map((po) => (
            <Card key={po.id} className="p-4">
              <div className="flex items-center justify-between">
                <div>
                  <span className="font-medium text-brand-600">{po.poNumber}</span>
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
        <p className="text-sm text-red-600">{(receive.error as Error).message}</p>
      )}
    </div>
  );
}
