import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { STORAGE_KEYS, SUPABASE_PUBLISHABLE_KEY, SUPABASE_URL } from "@/shared/config";

/**
 * Session handling.
 *
 * WHY WE DO NOT SIGN ANYONE IN HERE. The website is already a working sign-in
 * surface with Google OAuth and email OTP. Rebuilding that inside the extension
 * would mean a second OAuth client, a second consent screen, and a second place
 * for it to break. Instead /extension/connect - which is cookie-authenticated
 * already - hands us the Supabase session it can see, and we adopt it.
 *
 * That also means REFRESH IS SUPABASE'S PROBLEM, not ours. supabase-js rotates
 * the access token off the refresh token on its own; we never write expiry
 * logic, revocation, or rotation.
 *
 * Storage note: the refresh token sits in chrome.storage.local, which is
 * readable by anyone with local filesystem access to the browser profile. That
 * is an accepted risk for a vault of contact details, and it is exactly why
 * lib/shared/vault.ts refuses to hold anything more sensitive.
 */

type StoredSession = {
  accessToken: string;
  refreshToken: string;
  expiresAt: number | null;
  email: string | null;
};

let client: SupabaseClient | null = null;

function supabase(): SupabaseClient {
  if (!client) {
    client = createClient(SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY, {
      auth: {
        // The service worker has no window and can be torn down at any moment,
        // so supabase-js must not try to own persistence or listen for URL
        // fragments. We persist explicitly in `store` below.
        persistSession: false,
        autoRefreshToken: false,
        detectSessionInUrl: false,
      },
    });
  }
  return client;
}

async function read(): Promise<StoredSession | null> {
  const stored = await chrome.storage.local.get(STORAGE_KEYS.session);
  return (stored[STORAGE_KEYS.session] as StoredSession | undefined) ?? null;
}

async function store(session: StoredSession): Promise<void> {
  await chrome.storage.local.set({ [STORAGE_KEYS.session]: session });
}

export async function clearSession(): Promise<void> {
  await chrome.storage.local.remove(STORAGE_KEYS.session);
}

/** Adopt the session handed over by the website's connect page. */
export async function adoptSession(session: StoredSession): Promise<void> {
  await store(session);
}

export async function currentEmail(): Promise<string | null> {
  return (await read())?.email ?? null;
}

/** A token that is valid right now, refreshing first if it is about to expire. */
export async function getAccessToken(): Promise<string | null> {
  const session = await read();
  if (!session) return null;

  // 60s of slack so a token cannot expire mid-flight between here and the API.
  const expiresSoon = session.expiresAt !== null && session.expiresAt * 1000 - Date.now() < 60_000;
  if (!expiresSoon) return session.accessToken;

  try {
    const { data, error } = await supabase().auth.refreshSession({
      refresh_token: session.refreshToken,
    });

    if (error || !data.session) {
      // A refresh token is only rejected when it has been revoked or rotated
      // out from under us - signing out elsewhere, or a password change. There
      // is no recovering without the user, so drop it and ask them to reconnect
      // rather than retrying a token that will never work again.
      await clearSession();
      return null;
    }

    await store({
      accessToken: data.session.access_token,
      refreshToken: data.session.refresh_token,
      expiresAt: data.session.expires_at ?? null,
      email: data.session.user?.email ?? session.email,
    });

    return data.session.access_token;
  } catch (error) {
    // A network failure is not proof the token is dead - keep it and let the
    // caller's request fail instead of logging the user out over a dropped
    // connection.
    console.error("[auth] refresh failed", error);
    return session.accessToken;
  }
}
