import type { VaultData } from "./vault";

/**
 * The message protocol between the three contexts.
 *
 * ONE RULE ABOVE ALL: the access token never leaves the background worker.
 * Content scripts share a DOM with whatever the page is running, so anything
 * they can read is effectively public to that page. They ask for VALUES, and
 * only when a fill is actually happening.
 */

/** Content script or popup -> background. */
export type Request =
  | { type: "GET_STATUS" }
  | { type: "GET_CONNECTED" }
  | { type: "GET_VAULT" }
  | { type: "GET_FIELD_MAP" }
  | { type: "SIGN_OUT" }
  | { type: "FILL_ACTIVE_TAB" }
  | { type: "OPEN_PAGE"; page: SitePage }
  /** Where the popup is pointed, so it can offer to run here permanently. */
  | { type: "GET_SITE_ACCESS"; url?: string }
  /**
   * Register the content script for an origin the user just granted.
   *
   * The `chrome.permissions.request()` call itself has to happen in the popup:
   * it needs a user gesture, and a service worker has none.
   */
  | { type: "REGISTER_SITE"; pattern: string }
  /**
   * Open the toolbar popup from the on-page handle.
   *
   * The handle cannot ask for a permission itself - `chrome.permissions.request`
   * is not exposed to content scripts, and the popup is the only surface with a
   * user gesture Chrome will accept. So the handle hands off to it.
   */
  | { type: "OPEN_POPUP" };

export type SiteAccess = {
  /** Match pattern for the active tab, or null if it is not an http(s) page. */
  pattern: string | null;
  /** Hostname, for showing the user what they are about to allow. */
  host: string | null;
  /** Already covered - by the manifest, or by a grant made earlier. */
  granted: boolean;
};

/**
 * Pages the on-page UI can ask for.
 *
 * Content scripts have no `chrome.tabs`, so every navigation they offer has to
 * be routed through the worker. Naming the page rather than passing a URL keeps
 * the destination list here rather than letting a compromised content script
 * open anything it likes.
 */
export type SitePage = "connect" | "account";

/** The website's /extension/connect page -> background, via externally_connectable. */
export type ExternalRequest = {
  type: "CONNECT_SESSION";
  accessToken: string;
  refreshToken: string;
  expiresAt: number | null;
  email: string | null;
};

export type Status = {
  connected: boolean;
  email: string | null;
  /** Populated only when connected; drives the popup's completeness meter. */
  completion: { filled: number; total: number } | null;
};

export type Response<T> = { ok: true; data: T } | { ok: false; error: string };

/** Background -> content script. */
export type ContentMessage = { type: "FILL_NOW"; data: VaultData };

export type FillReport = {
  filled: { key: string; label: string }[];
  /** Fields we found but were not confident enough to fill. */
  skipped: { label: string; reason: string }[];
};
