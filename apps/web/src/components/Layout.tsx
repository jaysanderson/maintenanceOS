import { ReactNode, useState } from "react";
import { NavLink, useLocation } from "react-router-dom";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useAuth } from "../lib/auth";
import { api, dateTime } from "../lib/api";

interface NotifList {
  items: { id: string; type: string; message: string; createdAt: string; read: boolean }[];
  unread: number;
}

function NotificationBell() {
  const qc = useQueryClient();
  const [open, setOpen] = useState(false);
  const { data } = useQuery<NotifList>({
    queryKey: ["/notifications"],
    queryFn: () => api.get<NotifList>("/notifications"),
    refetchInterval: 30000,
  });
  const markAll = async () => {
    await api.post("/notifications/read-all");
    qc.invalidateQueries({ queryKey: ["/notifications"] });
  };
  return (
    <div className="relative">
      <button
        onClick={() => setOpen((o) => !o)}
        className="relative rounded-lg border border-slate-300 px-3 py-1.5 text-xs font-medium text-slate-600 hover:bg-slate-50"
      >
        Notifications
        {data && data.unread > 0 && (
          <span className="ml-1 rounded-full bg-red-600 px-1.5 py-0.5 text-[10px] font-semibold text-white">
            {data.unread}
          </span>
        )}
      </button>
      {open && (
        <div className="absolute right-0 z-50 mt-2 w-80 rounded-xl border border-slate-200 bg-white shadow-lg">
          <div className="flex items-center justify-between border-b border-slate-100 px-4 py-2">
            <span className="text-sm font-semibold">Notifications</span>
            <button
              onClick={markAll}
              className="text-xs text-brand-600 hover:underline"
            >
              Mark all read
            </button>
          </div>
          <div className="max-h-80 overflow-y-auto">
            {(data?.items ?? []).length === 0 && (
              <div className="p-4 text-sm text-slate-500">Nothing yet.</div>
            )}
            {(data?.items ?? []).map((n) => (
              <div
                key={n.id}
                className={`border-b border-slate-50 px-4 py-2 text-sm ${
                  n.read ? "text-slate-500" : "text-slate-800"
                }`}
              >
                <div>{n.message}</div>
                <div className="text-[11px] text-slate-400">
                  {n.type} · {dateTime(n.createdAt)}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

const NAV = [
  { to: "/", label: "Dashboard", icon: "▣" },
  { to: "/work-orders", label: "Work Orders", icon: "✦" },
  { to: "/dispatch", label: "Dispatch Board", icon: "⇄" },
  { to: "/quotes", label: "Quotes", icon: "$" },
  { to: "/invoices", label: "Invoices", icon: "🧾" },
  { to: "/accounts", label: "Accounts", icon: "◉" },
  { to: "/sites", label: "Sites", icon: "⌂" },
  { to: "/employees", label: "Employees", icon: "☺" },
  { to: "/inventory", label: "Inventory", icon: "▦" },
  { to: "/suppliers", label: "Suppliers", icon: "⚒" },
  { to: "/purchase-orders", label: "Purchase Orders", icon: "⇩" },
  { to: "/fleet", label: "Fleet & Assets", icon: "⛟" },
  { to: "/recurring", label: "Recurring", icon: "↻" },
  { to: "/reports", label: "Reports", icon: "📈" },
  { to: "/audit", label: "Audit Log", icon: "≣", adminOnly: true },
  { to: "/settings", label: "Settings", icon: "⚙" },
];

const TITLES: Record<string, string> = Object.fromEntries(
  NAV.map((n) => [n.to, n.label])
);

export default function Layout({ children }: { children: ReactNode }) {
  const loc = useLocation();
  const { user, logout } = useAuth();
  const seg = "/" + (loc.pathname.split("/")[1] ?? "");
  const title = TITLES[seg === "/" ? "/" : seg] ?? "MaintenanceOS";
  const isAdmin = user?.role === "ADMIN" || user?.role === "MANAGER";
  const nav = NAV.filter((n) => !n.adminOnly || isAdmin);

  return (
    <div className="flex h-full">
      <aside className="flex w-60 shrink-0 flex-col border-r border-slate-200 bg-white">
        <div className="flex items-center gap-2 border-b border-slate-200 px-5 py-4">
          <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-brand-600 text-sm font-bold text-white">
            M
          </div>
          <div>
            <div className="text-sm font-semibold leading-tight">
              MaintenanceOS
            </div>
            <div className="text-[10px] uppercase tracking-wide text-slate-400">
              Operations Platform
            </div>
          </div>
        </div>
        <nav className="flex-1 overflow-y-auto px-3 py-3">
          {nav.map((n) => (
            <NavLink
              key={n.to}
              to={n.to}
              end={n.to === "/"}
              className={({ isActive }) =>
                `mb-0.5 flex items-center gap-3 rounded-lg px-3 py-2 text-sm font-medium ${
                  isActive
                    ? "bg-brand-50 text-brand-700"
                    : "text-slate-600 hover:bg-slate-100"
                }`
              }
            >
              <span className="w-4 text-center text-xs">{n.icon}</span>
              {n.label}
            </NavLink>
          ))}
        </nav>
        <div className="border-t border-slate-200 px-5 py-3 text-[11px] text-slate-400">
          API-first ERP · v1.0
        </div>
      </aside>

      <div className="flex flex-1 flex-col overflow-hidden">
        <header className="flex items-center justify-between border-b border-slate-200 bg-white px-6 py-4">
          <h1 className="text-lg font-semibold">{title}</h1>
          <div className="flex items-center gap-4">
            <a
              href="http://localhost:4000/docs"
              target="_blank"
              rel="noreferrer"
              className="text-xs font-medium text-brand-600 hover:underline"
            >
              API Docs ↗
            </a>
            {user && <NotificationBell />}
            {user && (
              <div className="flex items-center gap-3 border-l border-slate-200 pl-4">
                <div className="text-right">
                  <div className="text-sm font-medium leading-tight">
                    {user.name}
                  </div>
                  <div className="text-[10px] uppercase tracking-wide text-slate-400">
                    {user.role}
                  </div>
                </div>
                <button
                  onClick={logout}
                  className="rounded-lg border border-slate-300 px-3 py-1.5 text-xs font-medium text-slate-600 hover:bg-slate-50"
                >
                  Sign out
                </button>
              </div>
            )}
          </div>
        </header>
        <main className="flex-1 overflow-y-auto p-6">{children}</main>
      </div>
    </div>
  );
}
