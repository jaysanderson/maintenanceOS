import { useList } from "../lib/hooks";
import { dateTime } from "../lib/api";
import { PageState, DataTable, Badge } from "../components/ui";

interface AuditEntry {
  id: string;
  at: string;
  userEmail: string | null;
  action: string;
  entity: string | null;
  entityId: string | null;
  summary: string;
}

export default function Audit() {
  const query = useList<{ data: AuditEntry[]; total: number }>(
    "/audit?pageSize=100"
  );

  return (
    <div className="space-y-4">
      <p className="text-sm text-slate-500">
        Append-only record of significant actions (logins, status changes,
        approvals, invoicing, deletes, settings, demo resets).
      </p>
      <PageState
        loading={query.isLoading}
        error={query.error}
        empty={query.data?.data.length === 0}
        emptyLabel="No audit entries yet."
      >
        {query.data && (
          <DataTable
            rows={query.data.data}
            rowKey={(r) => r.id}
            columns={[
              { header: "When", cell: (r) => dateTime(r.at) },
              { header: "User", cell: (r) => r.userEmail ?? "—" },
              { header: "Action", cell: (r) => <Badge value={r.action} /> },
              { header: "Entity", cell: (r) => r.entity ?? "—" },
              { header: "Summary", cell: (r) => r.summary },
            ]}
          />
        )}
      </PageState>
    </div>
  );
}
