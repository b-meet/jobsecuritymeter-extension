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
    // gone, or the session was revoked. Same handling as a dead refresh token,
    // and the cached values go with it: they belong to a session that is over.
    await clearSession();
    forgetVault();
    throw new AuthError();
  }

  return response;
}

type VaultResponse = Vault & { completion: { filled: number; total: number } };

/**
 * Short-lived vault cache, held ONLY in the worker.
 *
 * WHY THIS EXISTS. The on-page "Fill" chip fetched the vault on every press,
 * because the content script deliberately caches nothing (see shared/messages).
 * That put a full network round-trip between the click and the value appearing -
 * a few hundred milliseconds of nothing, which reads as "the button did not
 * work", and the fill then landing just as the user clicks away looks like it
 * was the blur that did it.
 *
 * Caching HERE rather than in the content script is what keeps the rule intact.
 * The worker already holds the access token; values sitting beside it for a
 * minute are not a new exposure. The same values in the content script would be
 * in the same process as whatever the page is running, which is the thing the
 * rule is about.
 *
 * MV3 tears the worker down when idle, so this is doubly bounded: by the TTL,
 * and by the worker's own lifetime.
 */
let cached: { at: number; value: VaultResponse } | null = null;
const VAULT_TTL_MS = 60_000;

export async function fetchVault(options?: { fresh?: boolean }): Promise<VaultResponse> {
  if (!options?.fresh && cached && Date.now() - cached.at < VAULT_TTL_MS) {
    return cached.value;
  }

  const response = await authed(API.vault);
  if (!response.ok) throw new Error(`Vault request failed (${response.status})`);

  const value = (await response.json()) as VaultResponse;
  cached = { at: Date.now(), value };
  return value;
}

/**
 * Drop the cache.
 *
 * Called on sign-out and whenever the profile is edited, so a stale copy cannot
 * outlive the session it belongs to or fill a value the user just changed.
 */
export function forgetVault(): void {
  cached = null;
}

export async function saveVault(data: VaultData): Promise<void> {
  const response = await authed(API.vault, { method: "PATCH", body: JSON.stringify({ data }) });
  if (!response.ok) throw new Error(`Vault save failed (${response.status})`);
  // Whatever we hold is now behind the write.
  forgetVault();
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
