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
  /** Min ARAG retrieval score (0–1) to trust an AI answer/generation. */
  aiConfidenceThreshold: number;
  /**
   * When true, the /mcp endpoint will accept requests with no bearer token
   * and act as `mcpPublicUserId` (typically a low-privilege account). Used
   * for demos and quick testing. Off by default for safety.
   */
  mcpPublicAccess: boolean;
  /** Which user anonymous /mcp requests impersonate when public mode is on. */
  mcpPublicUserId: string | null;
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
  // Secondary guard (0–1). The primary low-confidence signal is ARAG's
  // "not enough data" sentinel; this score gate adds a tunable backstop.
  aiConfidenceThreshold: 0.05,
  mcpPublicAccess: false,
  mcpPublicUserId: null,
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
    aiConfidenceThreshold: num(
      s["ai.confidenceThreshold"],
      DEFAULTS.aiConfidenceThreshold
    ),
    mcpPublicAccess: s["mcp.publicAccess"] === "true",
    mcpPublicUserId: s["mcp.publicUserId"] ?? null,
  };
}

/**
 * Public-MCP settings — read together because the /mcp request hot-path
 * reads both flags on every anonymous call.
 */
export async function getMcpPublicAccess(): Promise<{
  enabled: boolean;
  userId: string | null;
}> {
  const [enabled, userId] = await Promise.all([
    getSetting("mcp.publicAccess"),
    getSetting("mcp.publicUserId"),
  ]);
  // Env default makes public mode survive deploys (the DB setting resets when
  // the demo DB reseeds). The /mcp handler resolves a fallback admin user when
  // the stored publicUserId is absent or stale (user ids change on reseed).
  const envDefault = process.env.MCP_PUBLIC_ACCESS === "true";
  return { enabled: enabled === "true" || envDefault, userId: userId ?? null };
}

export async function getGstRate(): Promise<number> {
  return num(await getSetting("finance.gstRate"), DEFAULTS.gstRate);
}

/** Min ARAG retrieval score (0–1) below which AI output is treated as
 *  low-confidence and suppressed in favour of a friendly message. */
export async function getAiConfidenceThreshold(): Promise<number> {
  return num(
    await getSetting("ai.confidenceThreshold"),
    DEFAULTS.aiConfidenceThreshold
  );
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
