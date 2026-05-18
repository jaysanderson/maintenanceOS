import { prisma } from "../prisma.js";
import type { AuthUser } from "./auth.js";

export interface AuditInput {
  action: string;
  entity?: string;
  entityId?: string;
  summary: string;
  meta?: unknown;
}

/**
 * Append a record to the audit log. Best-effort: a logging failure must never
 * break the underlying business operation.
 */
export async function audit(
  user: AuthUser | undefined,
  input: AuditInput
): Promise<void> {
  try {
    await prisma.auditLog.create({
      data: {
        userId: user?.id ?? null,
        userEmail: user?.email ?? null,
        action: input.action,
        entity: input.entity ?? null,
        entityId: input.entityId ?? null,
        summary: input.summary,
        meta: input.meta ? JSON.stringify(input.meta) : null,
      },
    });
  } catch (err) {
    console.error("audit log write failed", err);
  }
}
