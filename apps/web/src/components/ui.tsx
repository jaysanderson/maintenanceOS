import { ReactNode, useState } from "react";

export function Card({
  children,
  className = "",
}: {
  children: ReactNode;
  className?: string;
}) {
  return (
    <div
      className={`rounded-xl border border-slate-200 bg-white shadow-sm ${className}`}
    >
      {children}
    </div>
  );
}

export function KpiCard({
  label,
  value,
  sub,
  tone = "default",
}: {
  label: string;
  value: ReactNode;
  sub?: ReactNode;
  tone?: "default" | "warn" | "danger" | "good";
}) {
  const toneMap = {
    default: "text-slate-900",
    warn: "text-amber-600",
    danger: "text-red-600",
    good: "text-emerald-600",
  };
  return (
    <Card className="p-4">
      <div className="text-xs font-medium uppercase tracking-wide text-slate-500">
        {label}
      </div>
      <div className={`mt-2 text-2xl font-semibold ${toneMap[tone]}`}>
        {value}
      </div>
      {sub != null && (
        <div className="mt-1 text-xs text-slate-500">{sub}</div>
      )}
    </Card>
  );
}

const BADGE_COLORS: Record<string, string> = {
  // statuses
  NEW: "bg-slate-100 text-slate-700",
  TRIAGE: "bg-slate-100 text-slate-700",
  QUOTE_REQUIRED: "bg-violet-100 text-violet-700",
  AWAITING_APPROVAL: "bg-amber-100 text-amber-700",
  APPROVED: "bg-blue-100 text-blue-700",
  SCHEDULED: "bg-indigo-100 text-indigo-700",
  DISPATCHED: "bg-cyan-100 text-cyan-700",
  IN_PROGRESS: "bg-sky-100 text-sky-700",
  WAITING_ON_PARTS: "bg-orange-100 text-orange-700",
  COMPLETED: "bg-emerald-100 text-emerald-700",
  INVOICED: "bg-teal-100 text-teal-700",
  CLOSED: "bg-slate-200 text-slate-600",
  CANCELLED: "bg-red-100 text-red-700",
  // priority
  LOW: "bg-slate-100 text-slate-600",
  NORMAL: "bg-blue-100 text-blue-700",
  HIGH: "bg-amber-100 text-amber-700",
  URGENT: "bg-red-100 text-red-700",
  // quote / invoice / po
  DRAFT: "bg-slate-100 text-slate-700",
  SENT: "bg-blue-100 text-blue-700",
  REJECTED: "bg-red-100 text-red-700",
  EXPIRED: "bg-slate-200 text-slate-600",
  PAID: "bg-emerald-100 text-emerald-700",
  OVERDUE: "bg-red-100 text-red-700",
  VOID: "bg-slate-200 text-slate-600",
  PART_RECEIVED: "bg-amber-100 text-amber-700",
  RECEIVED: "bg-emerald-100 text-emerald-700",
  AVAILABLE: "bg-emerald-100 text-emerald-700",
  ASSIGNED: "bg-blue-100 text-blue-700",
  UNDER_REPAIR: "bg-amber-100 text-amber-700",
  RETIRED: "bg-slate-200 text-slate-600",
};

export function Badge({ value }: { value: string }) {
  const cls = BADGE_COLORS[value] ?? "bg-slate-100 text-slate-700";
  return (
    <span
      className={`inline-block whitespace-nowrap rounded-full px-2 py-0.5 text-xs font-medium ${cls}`}
    >
      {value.replace(/_/g, " ")}
    </span>
  );
}

export function Button({
  children,
  variant = "primary",
  ...props
}: React.ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: "primary" | "secondary" | "danger" | "ghost";
}) {
  const variants = {
    primary: "bg-brand-600 text-white hover:bg-brand-700",
    secondary: "bg-white border border-slate-300 text-slate-700 hover:bg-slate-50",
    danger: "bg-red-600 text-white hover:bg-red-700",
    ghost: "text-slate-600 hover:bg-slate-100",
  };
  return (
    <button
      {...props}
      className={`inline-flex items-center justify-center rounded-lg px-3 py-2 text-sm font-medium transition disabled:opacity-50 ${variants[variant]} ${props.className ?? ""}`}
    >
      {children}
    </button>
  );
}

export function PageState({
  loading,
  error,
  empty,
  emptyLabel = "No records yet.",
  children,
}: {
  loading: boolean;
  error: unknown;
  empty?: boolean;
  emptyLabel?: string;
  children: ReactNode;
}) {
  if (loading)
    return (
      <div className="flex items-center justify-center py-20 text-slate-400">
        <div className="h-6 w-6 animate-spin rounded-full border-2 border-slate-300 border-t-brand-600" />
        <span className="ml-3 text-sm">Loading…</span>
      </div>
    );
  if (error)
    return (
      <Card className="p-6 text-sm text-red-600">
        Something went wrong: {(error as Error).message}
      </Card>
    );
  if (empty)
    return (
      <Card className="p-10 text-center text-sm text-slate-500">
        {emptyLabel}
      </Card>
    );
  return <>{children}</>;
}

export interface Column<T> {
  header: string;
  cell: (row: T) => ReactNode;
  className?: string;
}

export function DataTable<T>({
  columns,
  rows,
  onRowClick,
  rowKey,
}: {
  columns: Column<T>[];
  rows: T[];
  onRowClick?: (row: T) => void;
  rowKey: (row: T) => string;
}) {
  return (
    <Card className="overflow-hidden">
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-slate-200 bg-slate-50 text-left text-xs uppercase tracking-wide text-slate-500">
              {columns.map((c) => (
                <th key={c.header} className="px-4 py-3 font-medium">
                  {c.header}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <tr
                key={rowKey(row)}
                onClick={() => onRowClick?.(row)}
                className={`border-b border-slate-100 last:border-0 ${
                  onRowClick ? "cursor-pointer hover:bg-slate-50" : ""
                }`}
              >
                {columns.map((c) => (
                  <td key={c.header} className={`px-4 py-3 ${c.className ?? ""}`}>
                    {c.cell(row)}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </Card>
  );
}

export function Field({
  label,
  children,
}: {
  label: string;
  children: ReactNode;
}) {
  return (
    <label className="block">
      <span className="mb-1 block text-xs font-medium text-slate-600">
        {label}
      </span>
      {children}
    </label>
  );
}

export const inputCls =
  "w-full rounded-lg border border-slate-300 px-3 py-2 text-sm outline-none focus:border-brand-500 focus:ring-1 focus:ring-brand-500";

export function Modal({
  open,
  onClose,
  title,
  children,
}: {
  open: boolean;
  onClose: () => void;
  title: string;
  children: ReactNode;
}) {
  if (!open) return null;
  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center bg-slate-900/40 p-4 pt-20">
      <Card className="w-full max-w-lg">
        <div className="flex items-center justify-between border-b border-slate-200 px-5 py-3">
          <h3 className="font-semibold">{title}</h3>
          <button
            onClick={onClose}
            className="text-slate-400 hover:text-slate-700"
          >
            ✕
          </button>
        </div>
        <div className="max-h-[70vh] overflow-y-auto p-5">{children}</div>
      </Card>
    </div>
  );
}

export function Tabs({
  tabs,
}: {
  tabs: { label: string; content: ReactNode }[];
}) {
  const [active, setActive] = useState(0);
  return (
    <div>
      <div className="mb-4 flex gap-1 border-b border-slate-200">
        {tabs.map((t, i) => (
          <button
            key={t.label}
            onClick={() => setActive(i)}
            className={`px-4 py-2 text-sm font-medium ${
              active === i
                ? "border-b-2 border-brand-600 text-brand-700"
                : "text-slate-500 hover:text-slate-800"
            }`}
          >
            {t.label}
          </button>
        ))}
      </div>
      <div>{tabs[active]?.content}</div>
    </div>
  );
}
