import { API, isTrustedOrigin, SITE_ORIGIN } from "@/shared/config";
import { adoptSession, clearSession, currentEmail } from "./auth";
import { AuthError, fetchFieldMap, fetchVault, forgetVault } from "./api";
import { injectNow, patternFor, registerSite, syncGrantedSites } from "./inject";
import type {
  ContentMessage,
  ExternalRequest,
  Request,
  Response,
  SiteAccess,
  Status,
} from "@/shared/messages";

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
    const vault = await fetchVault({ fresh: true });
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

      /**
       * Storage-only connection check, deliberately separate from GET_STATUS.
       *
       * The on-page UI asks this on every application form it mounts on, in
       * every frame. GET_STATUS fetches the vault to build its completion
       * meter, so answering with it would put a network round-trip on page
       * load for a question we can settle from chrome.storage.
       */
      case "GET_CONNECTED":
        return { ok: true, data: (await currentEmail()) !== null };

      case "OPEN_PAGE": {
        // They are on their way to edit the profile or reconnect, so anything
        // held now is about to be wrong.
        forgetVault();
        const url = request.page === "account" ? `${SITE_ORIGIN}/account#autofill` : API.connect;
        await chrome.tabs.create({ url });
        return { ok: true, data: null };
      }

      case "GET_VAULT":
        return { ok: true, data: await fetchVault() };

      case "GET_FIELD_MAP":
        return { ok: true, data: await fetchFieldMap() };

      case "SIGN_OUT":
        await clearSession();
        forgetVault();
        return { ok: true, data: null };

      case "GET_SITE_ACCESS": {
        // The content script knows its own URL; the popup has to look up the
        // active tab. Asking the caller avoids a tabs.query that would be wrong
        // for a frame that is not the active tab's top document.
        let url = request.url;
        if (!url) {
          const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
          url = tab?.url;
        }
        const pattern = url ? patternFor(url) : null;

        if (!pattern) return { ok: true, data: { pattern: null, host: null, granted: false } };

        const manifestMatches = chrome.runtime.getManifest().content_scripts?.[0]?.matches ?? [];
        const granted =
          manifestMatches.includes(pattern) ||
          (await chrome.permissions.contains({ origins: [pattern] }).catch(() => false));

        const host = new URL(url!).hostname;
        return { ok: true, data: { pattern, host, granted } satisfies SiteAccess };
      }

      case "REGISTER_SITE":
        await registerSite(request.pattern);
        return { ok: true, data: null };

      /**
       * Hand off from the on-page handle to the popup.
       *
       * `chrome.action.openPopup()` needs a recent user gesture, and one made
       * in a content script does not always carry across the message boundary.
       * A failure is not an error worth shouting about - the handle falls back
       * to telling the user to click the toolbar icon, which is the same two
       * clicks by a different route.
       */
      case "OPEN_POPUP":
        try {
          await chrome.action.openPopup();
          return { ok: true, data: null };
        } catch {
          return { ok: false, error: "Open Job Autofill from the toolbar to allow this site." };
        }

      case "FILL_ACTIVE_TAB": {
        const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
        if (!tab?.id) return { ok: false, error: "No active tab." };

        const vault = await fetchVault();
        // Values cross into the content script only here, for one fill, and are
        // never persisted on the page side.
        const message: ContentMessage = { type: "FILL_NOW", data: vault.data };
        let report = await chrome.tabs.sendMessage(tab.id, message).catch(() => null);

        if (!report) {
          // No content script here, because this host is not in the manifest -
          // a company careers page rather than a listed ATS. `activeTab` is
          // granted by the click that opened the popup, so we may put one there
          // for this visit without asking for anything.
          const injected = await injectNow(tab.id);
          if (injected) {
            report = await chrome.tabs.sendMessage(tab.id, message).catch(() => null);
          }
        }

        if (!report) {
          return { ok: false, error: "Job Autofill can't run on this page." };
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
    if (!isTrustedOrigin(sender.origin)) {
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
chrome.runtime.onInstalled.addListener(() => {
  void fetchFieldMap();
  void syncGrantedSites();
});
chrome.runtime.onStartup.addListener(() => {
  void fetchFieldMap();
  void syncGrantedSites();
});

// The user can grant or revoke a site from chrome://extensions without ever
// opening our popup, so the permission list - not our own bookkeeping - is the
// source of truth for which sites we run on.
chrome.permissions.onAdded.addListener(() => void syncGrantedSites());
chrome.permissions.onRemoved.addListener(() => void syncGrantedSites());
