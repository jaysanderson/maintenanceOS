import bcrypt from "bcryptjs";

export const ROLES = [
  "ADMIN",
  "MANAGER",
  "SUPERVISOR",
  "DISPATCHER",
  "TECHNICIAN",
] as const;
export type Role = (typeof ROLES)[number];

/** Roles allowed to mutate operational data. */
export const WRITE_ROLES: Role[] = [
  "ADMIN",
  "MANAGER",
  "SUPERVISOR",
  "DISPATCHER",
];

/** Roles allowed destructive actions (hard delete, demo reset). */
export const ADMIN_ROLES: Role[] = ["ADMIN", "MANAGER"];

export interface AuthUser {
  id: string;
  email: string;
  name: string;
  role: Role;
}

export function hashPassword(plain: string): Promise<string> {
  return bcrypt.hash(plain, 10);
}

export function verifyPassword(
  plain: string,
  hash: string
): Promise<boolean> {
  return bcrypt.compare(plain, hash);
}

export const JWT_SECRET =
  process.env.JWT_SECRET ?? "maintenanceos-dev-secret-change-me";
