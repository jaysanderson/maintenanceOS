import { z } from "zod";

export const ACCOUNT_TYPES = [
  "HOMEOWNER",
  "REAL_ESTATE",
  "BODY_CORPORATE",
  "SCHOOL",
  "AGED_CARE",
  "COUNCIL",
  "COMMERCIAL",
] as const;

export const EMPLOYEE_ROLES = [
  "TECHNICIAN",
  "SENIOR_TECHNICIAN",
  "DISPATCHER",
  "SUPERVISOR",
  "ADMIN",
  "MANAGER",
] as const;

export const EMPLOYMENT_TYPES = [
  "FULL_TIME",
  "PART_TIME",
  "CASUAL",
  "SUBCONTRACTOR",
] as const;

export const JOB_TYPES = [
  "REPAIR",
  "MAINTENANCE",
  "INSPECTION",
  "EMERGENCY",
  "QUOTE_ONLY",
  "RECURRING_SERVICE",
] as const;

export const PRIORITIES = ["LOW", "NORMAL", "HIGH", "URGENT"] as const;

export const WORK_ORDER_STATUSES = [
  "NEW",
  "TRIAGE",
  "QUOTE_REQUIRED",
  "AWAITING_APPROVAL",
  "APPROVED",
  "SCHEDULED",
  "DISPATCHED",
  "IN_PROGRESS",
  "WAITING_ON_PARTS",
  "COMPLETED",
  "INVOICED",
  "CLOSED",
  "CANCELLED",
] as const;

export const QUOTE_STATUSES = [
  "DRAFT",
  "SENT",
  "APPROVED",
  "REJECTED",
  "EXPIRED",
] as const;

export const LOCATION_TYPES = [
  "WAREHOUSE",
  "VAN",
  "TRAILER",
  "SITE",
  "DAMAGED",
] as const;

export const MOVEMENT_TYPES = [
  "PURCHASE_RECEIPT",
  "TRANSFER",
  "CONSUMED_ON_JOB",
  "ADJUSTMENT",
  "RETURN",
] as const;

export const PO_STATUSES = [
  "DRAFT",
  "SENT",
  "PART_RECEIVED",
  "RECEIVED",
  "CANCELLED",
] as const;

export const INVOICE_STATUSES = [
  "DRAFT",
  "SENT",
  "PAID",
  "OVERDUE",
  "VOID",
] as const;

export const ASSET_TYPES = [
  "TOOL",
  "TRAILER",
  "MACHINE",
  "SAFETY_EQUIPMENT",
] as const;

export const ASSET_STATUSES = [
  "AVAILABLE",
  "ASSIGNED",
  "UNDER_REPAIR",
  "RETIRED",
] as const;

export const PAYMENT_TERMS = ["NET_7", "NET_14", "NET_30", "NET_60", "COD"] as const;

export const zEnum = <T extends readonly [string, ...string[]]>(values: T) =>
  z.enum(values);

export const GST_RATE = 0.1;
export const MARGIN_RISK_THRESHOLD = 0.25;
