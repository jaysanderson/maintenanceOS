/**
 * Typed accessors for configurable business settings, with sensible defaults.
 * Replaces the previously hardcoded GST_RATE / MARGIN_RISK_THRESHOLD so a
 * customer can set their own company profile and tax rate.
 */
import { getSetting, getAllSettings, setSettings } from "./settings.js";
import { GST_RATE, MARGIN_RISK_THRESHOLD } from "./enums.js";

export interface CompanyConfig {
  companyName: string;
  abn: string;
  email: string;
  phone: string;
  address: string;
  gstRate: number; // fraction, e.g. 0.1
  marginRiskThreshold: number; // fraction, e.g. 0.25
  defaultPaymentTerms: string;
}

const DEFAULTS: CompanyConfig = {
  companyName: "MaintenanceOS Demo Co",
  abn: "00 000 000 000",
  email: "office@maintenanceos.example",
  phone: "03 5000 0000",
  address: "1 Depot Lane, Bendigo VIC 3550",
  gstRate: GST_RATE,
  marginRiskThreshold: MARGIN_RISK_THRESHOLD,
  defaultPaymentTerms: "NET_30",
};

const num = (v: string | undefined, d: number) => {
  const n = v == null ? NaN : Number(v);
  return Number.isFinite(n) ? n : d;
};

export async function getCompanyConfig(): Promise<CompanyConfig> {
  const s = await getAllSettings();
  return {
    companyName: s["company.name"] ?? DEFAULTS.companyName,
    abn: s["company.abn"] ?? DEFAULTS.abn,
    email: s["company.email"] ?? DEFAULTS.email,
    phone: s["company.phone"] ?? DEFAULTS.phone,
    address: s["company.address"] ?? DEFAULTS.address,
    gstRate: num(s["finance.gstRate"], DEFAULTS.gstRate),
    marginRiskThreshold: num(
      s["finance.marginRiskThreshold"],
      DEFAULTS.marginRiskThreshold
    ),
    defaultPaymentTerms:
      s["finance.defaultPaymentTerms"] ?? DEFAULTS.defaultPaymentTerms,
  };
}

export async function getGstRate(): Promise<number> {
  return num(await getSetting("finance.gstRate"), DEFAULTS.gstRate);
}

export async function getMarginRiskThreshold(): Promise<number> {
  return num(
    await getSetting("finance.marginRiskThreshold"),
    DEFAULTS.marginRiskThreshold
  );
}

export async function updateCompanyConfig(
  patch: Partial<Record<string, string>>
): Promise<void> {
  await setSettings(patch);
}

export const CONFIG_DEFAULTS = DEFAULTS;
