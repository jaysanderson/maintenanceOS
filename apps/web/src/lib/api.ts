const BASE = "/api";
const TOKEN_KEY = "mos.token";

export const tokenStore = {
  get: () => localStorage.getItem(TOKEN_KEY),
  set: (t: string) => localStorage.setItem(TOKEN_KEY, t),
  clear: () => localStorage.removeItem(TOKEN_KEY),
};

export class ApiError extends Error {
  status: number;
  details?: unknown;
  constructor(status: number, message: string, details?: unknown) {
    super(message);
    this.status = status;
    this.details = details;
  }
}

async function request<T>(
  path: string,
  options: RequestInit = {}
): Promise<T> {
  const token = tokenStore.get();
  const res = await fetch(`${BASE}${path}`, {
    headers: {
      "Content-Type": "application/json",
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    ...options,
  });
  if (
    res.status === 401 &&
    !path.startsWith("/auth/login")
  ) {
    tokenStore.clear();
    if (!location.pathname.startsWith("/login")) {
      location.assign("/login");
    }
  }
  if (res.status === 204) return undefined as T;
  const text = await res.text();
  const body = text ? JSON.parse(text) : undefined;
  if (!res.ok) {
    throw new ApiError(
      res.status,
      body?.error ?? `Request failed (${res.status})`,
      body?.details
    );
  }
  return body as T;
}

/** Fetch a binary endpoint with auth and open it in a new tab (PDF, file). */
export async function openAuthed(path: string): Promise<void> {
  const token = tokenStore.get();
  const res = await fetch(`${BASE}${path}`, {
    headers: token ? { Authorization: `Bearer ${token}` } : {},
  });
  if (!res.ok) {
    throw new ApiError(res.status, `Download failed (${res.status})`);
  }
  const blob = await res.blob();
  const url = URL.createObjectURL(blob);
  window.open(url, "_blank");
  setTimeout(() => URL.revokeObjectURL(url), 60000);
}

/** Upload a single file via multipart with auth. */
export async function uploadAuthed<T>(
  path: string,
  file: File
): Promise<T> {
  const token = tokenStore.get();
  const form = new FormData();
  form.append("file", file);
  const res = await fetch(`${BASE}${path}`, {
    method: "POST",
    headers: token ? { Authorization: `Bearer ${token}` } : {},
    body: form,
  });
  const text = await res.text();
  const body = text ? JSON.parse(text) : undefined;
  if (!res.ok) {
    throw new ApiError(res.status, body?.error ?? `Upload failed (${res.status})`);
  }
  return body as T;
}

export const api = {
  get: <T>(path: string) => request<T>(path),
  post: <T>(path: string, data?: unknown) =>
    request<T>(path, { method: "POST", body: JSON.stringify(data ?? {}) }),
  put: <T>(path: string, data?: unknown) =>
    request<T>(path, { method: "PUT", body: JSON.stringify(data ?? {}) }),
  patch: <T>(path: string, data?: unknown) =>
    request<T>(path, { method: "PATCH", body: JSON.stringify(data ?? {}) }),
  del: <T>(path: string) => request<T>(path, { method: "DELETE" }),
};

export const currency = (n: number | null | undefined) =>
  n == null
    ? "—"
    : new Intl.NumberFormat("en-AU", {
        style: "currency",
        currency: "AUD",
        maximumFractionDigits: 0,
      }).format(n);

export const currencyExact = (n: number | null | undefined) =>
  n == null
    ? "—"
    : new Intl.NumberFormat("en-AU", {
        style: "currency",
        currency: "AUD",
      }).format(n);

export const date = (d: string | Date | null | undefined) =>
  d
    ? new Date(d).toLocaleDateString("en-AU", {
        day: "2-digit",
        month: "short",
        year: "numeric",
      })
    : "—";

export const dateTime = (d: string | Date | null | undefined) =>
  d
    ? new Date(d).toLocaleString("en-AU", {
        day: "2-digit",
        month: "short",
        hour: "2-digit",
        minute: "2-digit",
      })
    : "—";
