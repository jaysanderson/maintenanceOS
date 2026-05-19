/**
 * Deterministic, predictable tool names from method + path + tag.
 *
 * Examples:
 *  GET  /api/accounts/                  Accounts  → accounts_list_accounts
 *  GET  /api/accounts/{id}              Accounts  → accounts_get_accounts
 *  POST /api/accounts/                  Accounts  → accounts_create_accounts
 *  PUT  /api/accounts/{id}              Accounts  → accounts_update_accounts
 *  PATCH /api/work-orders/{id}/status   Work Orders → work_orders_status
 *  POST  /api/quotes/{id}/approve       Quotes    → quotes_approve
 */

function snake(s: string): string {
  return s
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_|_$/g, "");
}

export function toolNameFor(
  method: string,
  path: string,
  tag?: string
): string {
  const segments = path.split("/").filter(Boolean); // drop leading/empty
  // strip "/api" prefix if present so it doesn't dominate every name
  if (segments[0] === "api") segments.shift();

  const last = segments[segments.length - 1] ?? "root";
  const prev = segments[segments.length - 2] ?? "";
  const lastIsAction =
    !last.startsWith("{") && prev.startsWith("{") && last.length > 0;

  const tagPart = tag ? snake(tag) : snake(segments[0] ?? "api");

  if (lastIsAction) {
    return `${tagPart}_${snake(last)}`;
  }

  const resource = segments
    .filter((s) => !s.startsWith("{"))
    .pop() ?? "root";

  const verb =
    method === "GET"
      ? last.startsWith("{")
        ? "get"
        : "list"
      : method === "POST"
        ? "create"
        : method === "PUT"
          ? "update"
          : method === "PATCH"
            ? "patch"
            : method.toLowerCase();

  return `${tagPart}_${verb}_${snake(resource)}`;
}
