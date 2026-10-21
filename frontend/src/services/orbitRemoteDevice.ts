/**
 * Orbit Remote, phone side: API calls with the phone's device token (never the portal sign-in). The token lives
 * only in this browser tab (sessionStorage) and only works on the Orbit Remote device endpoints.
 */

const TOKEN_KEY = "orbit_remote_device";
const BASE = "/api/orbit-remote";

export function loadDeviceToken(): string | null {
  try {
    return sessionStorage.getItem(TOKEN_KEY);
  } catch {
    return null;
  }
}

export function saveDeviceToken(token: string): void {
  try {
    sessionStorage.setItem(TOKEN_KEY, token);
  } catch {
    // private mode: the connection lasts until the page is closed
  }
}

export function clearDeviceToken(): void {
  try {
    sessionStorage.removeItem(TOKEN_KEY);
  } catch {
    // ignore
  }
}

/** Errors carry the HTTP status, per-field messages and the server's reason (like services/api.ts). */
export interface DeviceApiError extends Error {
  status?: number;
  errors?: Record<string, string[]> | null;
  reason?: string | null;
}

async function call<T>(path: string, init: { method?: string; body?: unknown; token?: string | null } = {}): Promise<T> {
  let res: Response;
  try {
    res = await fetch(`${BASE}${path}`, {
      method: init.method ?? "GET",
      headers: {
        Accept: "application/json",
        ...(init.body !== undefined ? { "Content-Type": "application/json" } : {}),
        ...(init.token ? { Authorization: `Bearer ${init.token}` } : {}),
      },
      body: init.body !== undefined ? JSON.stringify(init.body) : undefined,
      cache: "no-store",
    });
  } catch {
    const err: DeviceApiError = new Error("No connection. Check your phone's internet and try again.");
    err.status = 0;
    throw err;
  }
  let data: any = null;
  try {
    data = await res.json();
  } catch {
    // empty body
  }
  if (!res.ok) {
    const first = data?.errors ? (Object.values(data.errors)[0] as string[] | undefined)?.[0] : null;
    const err: DeviceApiError = new Error(data?.message || first || `Request failed (${res.status}).`);
    err.status = res.status;
    err.errors = data?.errors ?? null;
    err.reason = data?.reason ?? null;
    throw err;
  }
  return data as T;
}

export interface DeviceSessionView {
  session: { id: string; status: string; device_label: string | null; desktop_label: string | null; expires_at: string | null; owner_first_name: string | null };
  desktop: { online: boolean; last_seen_at: string | null; state: any };
  commands: { id: number; kind: string; status: string; reason: string | null }[];
  limits: { max_text: number };
}

/** A code can be claimed once: a repeated call in the same page (e.g. a double mount) shares the first request's result. */
const claims = new Map<string, Promise<DeviceSessionView & { device_token: string }>>();

export const deviceApi = {
  claim: (code: string) => {
    let p = claims.get(code);
    if (!p) {
      p = call<DeviceSessionView & { device_token: string }>("/claim", { method: "POST", body: { code } });
      claims.set(code, p);
    }
    return p;
  },
  session: (token: string) => call<DeviceSessionView>("/device/session", { token }),
  command: (token: string, kind: "say" | "stop", text?: string) =>
    call<{ command: { id: number; kind: string; status: string } }>("/device/commands", { method: "POST", token, body: { kind, text } }),
  end: (token: string) => call<{ message: string }>("/device/end", { method: "POST", token, body: {} }),
};
