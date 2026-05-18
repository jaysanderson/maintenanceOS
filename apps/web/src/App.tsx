import { Routes, Route, Navigate } from "react-router-dom";
import Layout from "./components/Layout";
import { useAuth } from "./lib/auth";
import Login from "./pages/Login";
import Dashboard from "./pages/Dashboard";
import Accounts from "./pages/Accounts";
import AccountDetail from "./pages/AccountDetail";
import Sites from "./pages/Sites";
import WorkOrders from "./pages/WorkOrders";
import WorkOrderDetail from "./pages/WorkOrderDetail";
import Dispatch from "./pages/Dispatch";
import Quotes from "./pages/Quotes";
import QuoteDetail from "./pages/QuoteDetail";
import Invoices from "./pages/Invoices";
import Inventory from "./pages/Inventory";
import Suppliers from "./pages/Suppliers";
import PurchaseOrders from "./pages/PurchaseOrders";
import Employees from "./pages/Employees";
import Fleet from "./pages/Fleet";
import Reports from "./pages/Reports";
import Settings from "./pages/Settings";
import Audit from "./pages/Audit";
import Recurring from "./pages/Recurring";

export default function App() {
  const { user, loading } = useAuth();

  if (loading) {
    return (
      <div className="flex h-screen items-center justify-center text-slate-400">
        <div className="h-6 w-6 animate-spin rounded-full border-2 border-slate-300 border-t-brand-600" />
      </div>
    );
  }

  if (!user) {
    return (
      <Routes>
        <Route path="/login" element={<Login />} />
        <Route path="*" element={<Navigate to="/login" replace />} />
      </Routes>
    );
  }

  const isAdmin = user.role === "ADMIN" || user.role === "MANAGER";

  return (
    <Layout>
      <Routes>
        <Route path="/login" element={<Navigate to="/" replace />} />
        <Route path="/" element={<Dashboard />} />
        <Route path="/accounts" element={<Accounts />} />
        <Route path="/accounts/:id" element={<AccountDetail />} />
        <Route path="/sites" element={<Sites />} />
        <Route path="/work-orders" element={<WorkOrders />} />
        <Route path="/work-orders/:id" element={<WorkOrderDetail />} />
        <Route path="/dispatch" element={<Dispatch />} />
        <Route path="/quotes" element={<Quotes />} />
        <Route path="/quotes/:id" element={<QuoteDetail />} />
        <Route path="/invoices" element={<Invoices />} />
        <Route path="/inventory" element={<Inventory />} />
        <Route path="/suppliers" element={<Suppliers />} />
        <Route path="/purchase-orders" element={<PurchaseOrders />} />
        <Route path="/employees" element={<Employees />} />
        <Route path="/fleet" element={<Fleet />} />
        <Route path="/recurring" element={<Recurring />} />
        <Route path="/reports" element={<Reports />} />
        <Route path="/settings" element={<Settings />} />
        <Route
          path="/audit"
          element={isAdmin ? <Audit /> : <Navigate to="/" replace />}
        />
        <Route
          path="*"
          element={<div className="text-slate-500">Page not found.</div>}
        />
      </Routes>
    </Layout>
  );
}
