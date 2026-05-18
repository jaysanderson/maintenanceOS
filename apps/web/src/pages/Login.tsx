import { useState } from "react";
import { useAuth } from "../lib/auth";
import { Card, Button, Field, inputCls } from "../components/ui";

export default function Login() {
  const { login } = useAuth();
  const [email, setEmail] = useState("admin@maintenanceos.com.au");
  const [password, setPassword] = useState("demo1234");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await login(email, password);
      location.assign("/");
    } catch (err) {
      setError((err as Error).message);
      setBusy(false);
    }
  };

  return (
    <div className="flex min-h-screen items-center justify-center bg-slate-100 p-4">
      <div className="w-full max-w-sm">
        <div className="mb-6 flex items-center gap-3">
          <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-brand-600 text-lg font-bold text-white">
            M
          </div>
          <div>
            <div className="text-lg font-semibold">MaintenanceOS</div>
            <div className="text-xs uppercase tracking-wide text-slate-400">
              Operations Platform
            </div>
          </div>
        </div>
        <Card className="p-6">
          <h1 className="mb-1 text-lg font-semibold">Sign in</h1>
          <p className="mb-4 text-sm text-slate-500">
            Use a demo account below (password <code>demo1234</code>).
          </p>
          <form onSubmit={submit} className="space-y-3">
            <Field label="Email">
              <input
                className={inputCls}
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                autoFocus
              />
            </Field>
            <Field label="Password">
              <input
                className={inputCls}
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
              />
            </Field>
            {error && <p className="text-sm text-red-600">{error}</p>}
            <Button type="submit" disabled={busy} className="w-full">
              {busy ? "Signing in…" : "Sign in"}
            </Button>
          </form>
          <div className="mt-4 border-t border-slate-100 pt-3 text-xs text-slate-500">
            <div className="mb-1 font-medium">Demo logins</div>
            <ul className="space-y-0.5">
              <li>admin@maintenanceos.com.au — full access</li>
              <li>dispatch@maintenanceos.com.au — dispatcher</li>
              <li>tech@maintenanceos.com.au — technician</li>
            </ul>
          </div>
        </Card>
      </div>
    </div>
  );
}
