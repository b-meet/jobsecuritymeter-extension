import { API, STORAGE_KEYS } from "@/shared/config";
import { clearSession, getAccessToken } from "./auth";
import type { Vault, VaultData } from "@/shared/vault";

/**
 * The only place that talks to jobsecuritymeter.com.
 *
 * Runs in the service worker, so requests carry the extension's own origin and
 * hit the EXTENSION_ORIGINS allowlist on the API. A content script cannot do
 * this: its fetches carry the PAGE's origin (greenhouse.io), which we will
 * never allowlist.
 */

export class AuthError extends Error {
  constructor() {
    super("Not connected");
    this.name = "AuthError";
  }
}

async function authed(url: string, init: RequestInit = {}): Promise<globalThis.Response> {
  const token = await getAccessToken();
  if (!token) throw new AuthError();

  const response = await fetch(url, {
    ...init,
    headers: {
      ...init.headers,
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    },
    // Belt and braces: the API never sets allow-credentials, and we never want
    // ambient cookies on these calls anyway.
    credentials: "omit",
  });

  if (response.status === 401) {
    // The token verified locally but the server rejected it - the account is
    // gone, or the session was revoked. Same handling as a dead refresh token.
    await clearSession();
    throw new AuthError();
  }

  return response;
}

export async function fetchVault(): Promise<Vault & { completion: { filled: number; total: number } }> {
  const response = await authed(API.vault);
  if (!response.ok) throw new Error(`Vault request failed (${response.status})`);
  return response.json();
}

export async function saveVault(data: VaultData): Promise<void> {
  const response = await authed(API.vault, { method: "PATCH", body: JSON.stringify({ data }) });
  if (!response.ok) throw new Error(`Vault save failed (${response.status})`);
}

/**
 * Per-ATS selector overrides, served from our API and cached with an ETag.
 *
 * This is the difference between fixing a broken Greenhouse selector in a
 * Vercel deploy (minutes) and in a Chrome Web Store review (days). The bundled
 * heuristics in content/detect.ts are the fallback when this is unavailable, so
 * a failure here degrades autofill rather than breaking it.
 *
 * Unauthenticated on purpose: it is public configuration, not user data, and
 * requiring a token would stop us fetching it before the user connects.
 */
export async function fetchFieldMap(): Promise<unknown | null> {
  try {
    const cached = await chrome.storage.local.get([STORAGE_KEYS.fieldMap, STORAGE_KEYS.fieldMapEtag]);
    const etag = cached[STORAGE_KEYS.fieldMapEtag] as string | undefined;

    const response = await fetch(API.fieldMap, {
      headers: etag ? { "If-None-Match": etag } : {},
      credentials: "omit",
    });

    if (response.status === 304) return cached[STORAGE_KEYS.fieldMap] ?? null;
    if (!response.ok) return cached[STORAGE_KEYS.fieldMap] ?? null;

    const map = await response.json();
    await chrome.storage.local.set({
      [STORAGE_KEYS.fieldMap]: map,
      [STORAGE_KEYS.fieldMapEtag]: response.headers.get("etag") ?? "",
    });
    return map;
  } catch {
    const cached = await chrome.storage.local.get(STORAGE_KEYS.fieldMap);
    return cached[STORAGE_KEYS.fieldMap] ?? null;
  }
}
