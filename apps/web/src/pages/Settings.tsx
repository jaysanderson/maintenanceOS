import { useEffect, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { Card, Button, Field, inputCls } from "../components/ui";
import { api } from "../lib/api";
import { useAuth } from "../lib/auth";

interface CompanyConfig {
  companyName: string;
  abn: string;
  email: string;
  phone: string;
  address: string;
  gstRate: number;
  marginRiskThreshold: number;
  defaultPaymentTerms: string;
}

type Counts = Record<string, number>;

export default function Settings() {
  const qc = useQueryClient();
  const { user } = useAuth();
  const canEdit = user?.role === "ADMIN" || user?.role === "MANAGER";

  const [cfg, setCfg] = useState<CompanyConfig | null>(null);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [cfgError, setCfgError] = useState<string | null>(null);

  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<Counts | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    api
      .get<CompanyConfig>("/settings")
      .then(setCfg)
      .catch((e) => setCfgError((e as Error).message));
  }, []);

  const saveCfg = async () => {
    if (!cfg) return;
    setSaving(true);
    setSaved(false);
    setCfgError(null);
    try {
      const updated = await api.put<CompanyConfig>("/settings", cfg);
      setCfg(updated);
      setSaved(true);
    } catch (e) {
      setCfgError((e as Error).message);
    } finally {
      setSaving(false);
    }
  };

  const reset = async () => {
    if (
      !window.confirm(
        "Reset the demo environment? This wipes ALL current data and restores the original seeded demo dataset."
      )
    )
      return;
    setBusy(true);
    setError(null);
    setResult(null);
    try {
      const res = await api.post<{ ok: boolean; counts: Counts }>(
        "/system/reset",
        { confirm: true }
      );
      setResult(res.counts);
      await qc.invalidateQueries();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const set = (k: keyof CompanyConfig, v: string | number) =>
    setCfg((c) => (c ? { ...c, [k]: v } : c));

  return (
    <div className="max-w-2xl space-y-4">
      <Card className="p-6">
        <h2 className="font-semibold">Company &amp; Finance</h2>
        <p className="mt-1 text-sm text-slate-500">
          These drive document branding and tax. GST and the margin-risk
          threshold are applied to quotes, invoices and job costing.
          {!canEdit && " Read-only for your role."}
        </p>
        {cfgError && <p className="mt-2 text-sm text-red-600">{cfgError}</p>}
        {!cfg ? (
          <p className="mt-4 text-sm text-slate-400">Loading…</p>
        ) : (
          <div className="mt-4 space-y-3">
            <div className="grid grid-cols-2 gap-3">
              <Field label="Company name">
                <input
                  className={inputCls}
                  disabled={!canEdit}
                  value={cfg.companyName}
                  onChange={(e) => set("companyName", e.target.value)}
                />
              </Field>
              <Field label="ABN">
                <input
                  className={inputCls}
                  disabled={!canEdit}
                  value={cfg.abn}
                  onChange={(e) => set("abn", e.target.value)}
                />
              </Field>
              <Field label="Email">
                <input
                  className={inputCls}
                  disabled={!canEdit}
                  value={cfg.email}
                  onChange={(e) => set("email", e.target.value)}
                />
              </Field>
              <Field label="Phone">
                <input
                  className={inputCls}
                  disabled={!canEdit}
                  value={cfg.phone}
                  onChange={(e) => set("phone", e.target.value)}
                />
              </Field>
            </div>
            <Field label="Address">
              <input
                className={inputCls}
                disabled={!canEdit}
                value={cfg.address}
                onChange={(e) => set("address", e.target.value)}
              />
            </Field>
            <div className="grid grid-cols-3 gap-3">
              <Field label="GST rate (e.g. 0.1)">
                <input
                  type="number"
                  step="0.01"
                  className={inputCls}
                  disabled={!canEdit}
                  value={cfg.gstRate}
                  onChange={(e) => set("gstRate", Number(e.target.value))}
                />
              </Field>
              <Field label="Margin risk (e.g. 0.25)">
                <input
                  type="number"
                  step="0.01"
                  className={inputCls}
                  disabled={!canEdit}
                  value={cfg.marginRiskThreshold}
                  onChange={(e) =>
                    set("marginRiskThreshold", Number(e.target.value))
                  }
                />
              </Field>
              <Field label="Default terms">
                <input
                  className={inputCls}
                  disabled={!canEdit}
                  value={cfg.defaultPaymentTerms}
                  onChange={(e) =>
                    set("defaultPaymentTerms", e.target.value)
                  }
                />
              </Field>
            </div>
            {canEdit && (
              <div className="flex items-center gap-3 pt-1">
                <Button disabled={saving} onClick={saveCfg}>
                  {saving ? "Saving…" : "Save settings"}
                </Button>
                {saved && (
                  <span className="text-sm text-emerald-600">Saved.</span>
                )}
              </div>
            )}
          </div>
        )}
      </Card>

      {canEdit && (
        <Card className="border-amber-200 p-6">
          <h3 className="font-semibold">Demo Environment</h3>
          <p className="mt-1 text-sm text-slate-500">
            Restore the database to the original seeded demo dataset. This{" "}
            <strong>permanently deletes all current data</strong> and
            regenerates the demo records (including the demo login accounts).
          </p>
          <div className="mt-4 flex items-center gap-3">
            <Button variant="danger" disabled={busy} onClick={reset}>
              {busy ? "Resetting…" : "Reset demo data"}
            </Button>
            {busy && (
              <span className="text-sm text-slate-500">
                Re-seeding — this can take a few seconds…
              </span>
            )}
          </div>
          {error && (
            <p className="mt-3 text-sm text-red-600">Reset failed: {error}</p>
          )}
          {result && (
            <div className="mt-4 rounded-lg bg-emerald-50 p-4 text-sm text-emerald-800">
              <div className="mb-2 font-medium">Demo data restored.</div>
              <dl className="grid grid-cols-2 gap-x-6 gap-y-1">
                {Object.entries(result).map(([k, v]) => (
                  <div key={k} className="flex justify-between">
                    <dt className="capitalize text-emerald-700">
                      {k.replace(/([A-Z])/g, " $1")}
                    </dt>
                    <dd className="font-medium">{v}</dd>
                  </div>
                ))}
              </dl>
            </div>
          )}
        </Card>
      )}

      {canEdit && <BackupsCard />}
    </div>
  );
}

function BackupsCard() {
  const [list, setList] = useState<
    { file: string; size: number; createdAt: string }[]
  >([]);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);

  const load = () =>
    api
      .get<{ file: string; size: number; createdAt: string }[]>(
        "/system/backups"
      )
      .then(setList)
      .catch(() => {});

  useEffect(() => {
    load();
  }, []);

  const backup = async () => {
    setBusy(true);
    setMsg(null);
    try {
      const r = await api.post<{ file: string }>("/system/backup");
      setMsg(`Backup created: ${r.file}`);
      await load();
    } catch (e) {
      setMsg((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Card className="p-6">
      <div className="flex items-center justify-between">
        <div>
          <h3 className="font-semibold">Database Backups</h3>
          <p className="mt-1 text-sm text-slate-500">
            Snapshot the SQLite database. For production, move to managed
            Postgres with automated backups (see DEPLOYMENT.md).
          </p>
        </div>
        <Button variant="secondary" disabled={busy} onClick={backup}>
          {busy ? "Backing up…" : "Create backup"}
        </Button>
      </div>
      {msg && <p className="mt-2 text-sm text-slate-600">{msg}</p>}
      <div className="mt-4 divide-y divide-slate-100 text-sm">
        {list.length === 0 && (
          <p className="text-slate-400">No backups yet.</p>
        )}
        {list.map((b) => (
          <div key={b.file} className="flex justify-between py-2">
            <span className="font-mono text-xs">{b.file}</span>
            <span className="text-slate-500">
              {(b.size / 1024).toFixed(0)} KB ·{" "}
              {new Date(b.createdAt).toLocaleString("en-AU")}
            </span>
          </div>
        ))}
      </div>
    </Card>
  );
}
