import { SITE_ORIGIN } from "@/shared/config";
import { adoptSession, clearSession, currentEmail } from "./auth";
import { AuthError, fetchFieldMap, fetchVault } from "./api";
import type { ContentMessage, ExternalRequest, Request, Response, Status } from "@/shared/messages";

/**
 * Service worker. Owns the session and every network call; see shared/messages
 * for why the content script is kept away from both.
 *
 * MV3 tears this down whenever it is idle, so there is no module-level state
 * worth keeping - everything reads from chrome.storage on demand.
 */

async function status(): Promise<Status> {
  const email = await currentEmail();
  if (!email) return { connected: false, email: null, completion: null };

  try {
    const vault = await fetchVault();
    return { connected: true, email, completion: vault.completion };
  } catch (error) {
    if (error instanceof AuthError) return { connected: false, email: null, completion: null };
    // Network trouble is not disconnection - stay connected and let the popup
    // show a completion of null rather than bouncing the user to sign in again.
    return { connected: true, email, completion: null };
  }
}

async function handle(request: Request): Promise<Response<unknown>> {
  try {
    switch (request.type) {
      case "GET_STATUS":
        return { ok: true, data: await status() };

      case "GET_VAULT":
        return { ok: true, data: await fetchVault() };

      case "GET_FIELD_MAP":
        return { ok: true, data: await fetchFieldMap() };

      case "SIGN_OUT":
        await clearSession();
        return { ok: true, data: null };

      case "FILL_ACTIVE_TAB": {
        const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
        if (!tab?.id) return { ok: false, error: "No active tab." };

        const vault = await fetchVault();
        // Values cross into the content script only here, for one fill, and are
        // never persisted on the page side.
        const message: ContentMessage = { type: "FILL_NOW", data: vault.data };
        const report = await chrome.tabs.sendMessage(tab.id, message).catch(() => null);

        if (!report) {
          return { ok: false, error: "Job Autofill doesn't run on this page yet." };
        }
        return { ok: true, data: report };
      }

      default:
        return { ok: false, error: "Unknown request." };
    }
  } catch (error) {
    if (error instanceof AuthError) return { ok: false, error: "Please reconnect your account." };
    console.error("[background]", error);
    return { ok: false, error: "Something went wrong." };
  }
}

chrome.runtime.onMessage.addListener((request: Request, _sender, sendResponse) => {
  handle(request).then(sendResponse);
  // Keeps the message channel open for the async handler above.
  return true;
});

/**
 * The sign-in handshake, from jobsecuritymeter.com/extension/connect.
 *
 * The origin check is the entire security boundary here: `externally_connectable`
 * already limits which pages may send, but it is matched on patterns, so this
 * re-checks the exact origin before adopting anything as a session.
 */
chrome.runtime.onMessageExternal.addListener(
  (request: ExternalRequest, sender, sendResponse) => {
    if (sender.origin !== SITE_ORIGIN) {
      sendResponse({ ok: false, error: "Unauthorized origin." });
      return false;
    }

    if (request?.type !== "CONNECT_SESSION" || !request.accessToken || !request.refreshToken) {
      sendResponse({ ok: false, error: "Malformed session." });
      return false;
    }

    adoptSession({
      accessToken: request.accessToken,
      refreshToken: request.refreshToken,
      expiresAt: request.expiresAt ?? null,
      email: request.email ?? null,
    })
      .then(() => sendResponse({ ok: true }))
      .catch(() => sendResponse({ ok: false, error: "Could not save the session." }));

    return true;
  },
);

// Warm the field map on install and on browser start, so the first application
// form a user opens is not waiting on a network round-trip.
chrome.runtime.onInstalled.addListener(() => void fetchFieldMap());
chrome.runtime.onStartup.addListener(() => void fetchFieldMap());
