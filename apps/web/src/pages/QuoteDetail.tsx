import { useParams, Link } from "react-router-dom";
import { useOne, useApiMutation } from "../lib/hooks";
import { api, currency, date, openAuthed } from "../lib/api";
import { Quote } from "../lib/types";
import { PageState, Card, Badge, Button } from "../components/ui";

export default function QuoteDetail() {
  const { id } = useParams();
  const q = useOne<Quote>(`/quotes/${id}`);
  const inval = [`/quotes/${id}`, "/quotes", "/work-orders", "/dashboard"];
  const approve = useApiMutation(() => api.post(`/quotes/${id}/approve`), inval);
  const reject = useApiMutation(() => api.post(`/quotes/${id}/reject`), inval);

  return (
    <PageState loading={q.isLoading} error={q.error}>
      {q.data && (
        <div className="max-w-3xl space-y-4">
          <Card className="p-5">
            <div className="flex items-start justify-between">
              <div>
                <div className="text-sm font-medium text-brand-600">
                  {q.data.quoteNumber}
                </div>
                <h2 className="text-xl font-semibold">
                  {q.data.account?.name}
                </h2>
                {q.data.workOrder && (
                  <Link
                    to={`/work-orders/${q.data.workOrderId}`}
                    className="text-sm text-brand-600 hover:underline"
                  >
                    {q.data.workOrder.workOrderNumber} — {q.data.workOrder.title}
                  </Link>
                )}
              </div>
              <div className="flex flex-col items-end gap-2">
                <Badge value={q.data.status} />
                <Button
                  variant="secondary"
                  onClick={() => openAuthed(`/quotes/${q.data!.id}/pdf`)}
                >
                  Download PDF
                </Button>
              </div>
            </div>
          </Card>

          <Card className="p-5">
            <h3 className="mb-3 font-semibold">Cost Breakdown</h3>
            <table className="w-full text-sm">
              <tbody className="divide-y divide-slate-100">
                <LineRow label={`Labour (${q.data.labourHours}h @ ${currency(q.data.labourRate)})`} value={currency(q.data.labourHours * q.data.labourRate)} />
                <LineRow label="Materials" value={currency(q.data.materialCost)} />
                <LineRow label="Subcontractor" value={currency(q.data.subcontractorCost)} />
                <LineRow label="Equipment" value={currency(q.data.equipmentCost)} />
                <LineRow label="Travel" value={currency(q.data.travelCost)} />
                <LineRow label="Disposal" value={currency(q.data.disposalCost)} />
                <LineRow label={`Margin applied (${q.data.marginPercent}%)`} value="" />
                <LineRow label="Subtotal (ex GST)" value={currency(q.data.subtotal)} bold />
                <LineRow label="GST (10%)" value={currency(q.data.gst)} />
                <LineRow label="Total (inc GST)" value={currency(q.data.total)} bold />
              </tbody>
            </table>
            <p className="mt-3 text-xs text-slate-500">
              Valid until {date(q.data.validUntil)}. {q.data.notes}
            </p>
          </Card>

          {q.data.status !== "APPROVED" && q.data.status !== "REJECTED" && (
            <Card className="flex gap-2 p-5">
              <Button
                disabled={approve.isPending}
                onClick={() => approve.mutate(undefined)}
              >
                Approve Quote (sets Work Order → APPROVED)
              </Button>
              <Button
                variant="danger"
                disabled={reject.isPending}
                onClick={() => reject.mutate(undefined)}
              >
                Reject
              </Button>
            </Card>
          )}
        </div>
      )}
    </PageState>
  );
}

function LineRow({ label, value, bold }: { label: string; value: string; bold?: boolean }) {
  return (
    <tr className={bold ? "font-semibold" : ""}>
      <td className="py-2 text-slate-600">{label}</td>
      <td className="py-2 text-right">{value}</td>
    </tr>
  );
}
