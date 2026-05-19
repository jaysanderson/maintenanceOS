import type { ApiClient } from "./dispatch.js";

/**
 * Read-only MCP resources. These give agents lightweight context they can
 * "attach" without having to call a tool — the live OpenAPI spec, the
 * dashboard snapshot, and parameterised resource templates for a single
 * work order or account.
 */

export interface ResourceFixed {
  uri: string;
  name: string;
  description: string;
  mimeType: string;
}

export interface ResourceTemplate {
  uriTemplate: string;
  name: string;
  description: string;
  mimeType: string;
}

export const FIXED_RESOURCES: ResourceFixed[] = [
  {
    uri: "maintenanceos://openapi",
    name: "MaintenanceOS OpenAPI spec",
    description:
      "The full OpenAPI 3 document describing every REST endpoint, request schema, and response shape.",
    mimeType: "application/json",
  },
  {
    uri: "maintenanceos://dashboard",
    name: "Operational dashboard",
    description:
      "Live KPI snapshot: open work orders, unassigned jobs, SLA breaches, revenue, gross margin, low stock, outstanding invoices, worst-margin jobs.",
    mimeType: "application/json",
  },
];

export const RESOURCE_TEMPLATES: ResourceTemplate[] = [
  {
    uriTemplate: "maintenanceos://work-order/{id}",
    name: "Work order detail",
    description:
      "A single work order with account, site, assigned technician, required skills, quotes, invoices, attachments and time entries.",
    mimeType: "application/json",
  },
  {
    uriTemplate: "maintenanceos://account/{id}",
    name: "Account detail",
    description:
      "An account with all its sites, work orders, and invoices.",
    mimeType: "application/json",
  },
];

/** Resolve a resource URI to an API request. */
export async function readResource(
  uri: string,
  apiClient: ApiClient,
  bearerToken?: string
): Promise<{ uri: string; mimeType: string; text: string }> {
  const headers: Record<string, string> = {};
  if (bearerToken) headers["authorization"] = `Bearer ${bearerToken}`;

  let apiPath: string;
  if (uri === "maintenanceos://openapi") apiPath = "/docs/json";
  else if (uri === "maintenanceos://dashboard")
    apiPath = "/api/dashboard/summary";
  else {
    const wo = uri.match(/^maintenanceos:\/\/work-order\/(.+)$/);
    if (wo) apiPath = `/api/work-orders/${encodeURIComponent(wo[1])}`;
    else {
      const acc = uri.match(/^maintenanceos:\/\/account\/(.+)$/);
      if (acc) apiPath = `/api/accounts/${encodeURIComponent(acc[1])}`;
      else throw new Error(`Unknown resource URI: ${uri}`);
    }
  }

  const res = await apiClient({
    method: "GET",
    url: apiPath,
    headers,
  });
  if (res.status >= 400) {
    throw new Error(`Resource read failed (${res.status}): ${res.text}`);
  }
  return {
    uri,
    mimeType: "application/json",
    text: res.text,
  };
}
