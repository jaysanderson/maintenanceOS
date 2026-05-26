import { randomBytes, createHash } from "node:crypto";
import { prisma } from "../prisma.js";

/**
 * Long-lived "Personal Access Tokens" — used for MCP / API integrations
 * where the 12-hour session JWT would expire mid-conversation. Stored
 * only as a sha256 hash; the raw value is shown to the user once and
 * never persisted.
 *
 * Format: `mos_<43 base64url chars>` (32 bytes of entropy, ~256 bits).
 * The literal prefix lets RESTful clients tell tokens apart from JWTs
 * at a glance, and lets us route auth based on the leading bytes.
 */

const TOKEN_PREFIX = "mos_";

export interface MintedToken {
  id: string;
  /** The raw token string — returned to the caller ONCE on creation. */
  token: string;
  prefix: string;
  name: string;
  expiresAt: Date | null;
  createdAt: Date;
}

/** Hex-encoded sha256 of a token string. Cheap & deterministic for lookup. */
function hashToken(raw: string): string {
  return createHash("sha256").update(raw, "utf8").digest("hex");
}

/** Cheap structural check before we touch the DB. */
export function looksLikeAccessToken(s: string): boolean {
  return s.startsWith(TOKEN_PREFIX) && s.length >= TOKEN_PREFIX.length + 32;
}

/**
 * Mint a new access token for the given user.
 * The raw token is only returned here and never reconstructable.
 */
export async function createAccessToken(opts: {
  userId: string;
  name: string;
  expiresInDays?: number | null;
}): Promise<MintedToken> {
  const raw = TOKEN_PREFIX + randomBytes(32).toString("base64url");
  const tokenHash = hashToken(raw);
  const prefix = raw.slice(0, 12); // e.g. "mos_3a7K8w" — safe to display
  const expiresAt =
    opts.expiresInDays && opts.expiresInDays > 0
      ? new Date(Date.now() + opts.expiresInDays * 86400_000)
      : null;
  const row = await prisma.accessToken.create({
    data: {
      userId: opts.userId,
      name: opts.name.trim().slice(0, 80) || "Untitled token",
      prefix,
      tokenHash,
      expiresAt,
    },
  });
  return {
    id: row.id,
    token: raw,
    prefix: row.prefix,
    name: row.name,
    expiresAt: row.expiresAt,
    createdAt: row.createdAt,
  };
}

export interface AccessTokenSummary {
  id: string;
  name: string;
  prefix: string;
  createdAt: Date;
  lastUsedAt: Date | null;
  expiresAt: Date | null;
  revokedAt: Date | null;
}

export async function listAccessTokens(
  userId: string
): Promise<AccessTokenSummary[]> {
  const rows = await prisma.accessToken.findMany({
    where: { userId },
    orderBy: { createdAt: "desc" },
    select: {
      id: true,
      name: true,
      prefix: true,
      createdAt: true,
      lastUsedAt: true,
      expiresAt: true,
      revokedAt: true,
    },
  });
  return rows;
}

export async function revokeAccessToken(opts: {
  userId: string;
  tokenId: string;
}): Promise<boolean> {
  const r = await prisma.accessToken.updateMany({
    where: { id: opts.tokenId, userId: opts.userId, revokedAt: null },
    data: { revokedAt: new Date() },
  });
  return r.count > 0;
}

export interface VerifiedAccessToken {
  id: string;
  userId: string;
}

/**
 * Verify a raw access token. Returns the (userId, id) on success, null
 * on any of: not a token shape / not found / revoked / expired.
 *
 * The caller is responsible for then loading the user row and rejecting
 * inactive accounts — same flow as the JWT path.
 */
export async function verifyAccessToken(
  raw: string
): Promise<VerifiedAccessToken | null> {
  if (!looksLikeAccessToken(raw)) return null;
  const tokenHash = hashToken(raw);
  const row = await prisma.accessToken.findUnique({
    where: { tokenHash },
    select: {
      id: true,
      userId: true,
      revokedAt: true,
      expiresAt: true,
    },
  });
  if (!row) return null;
  if (row.revokedAt) return null;
  if (row.expiresAt && row.expiresAt.getTime() < Date.now()) return null;
  // Best-effort: bump lastUsedAt without blocking the request. We don't
  // await this — a token failing to record its last-use shouldn't 500
  // the API call that's already passed auth.
  prisma.accessToken
    .update({ where: { id: row.id }, data: { lastUsedAt: new Date() } })
    .catch(() => {});
  return { id: row.id, userId: row.userId };
}
