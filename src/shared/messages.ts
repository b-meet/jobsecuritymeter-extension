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
  | { type: "GET_VAULT" }
  | { type: "GET_FIELD_MAP" }
  | { type: "SIGN_OUT" }
  | { type: "FILL_ACTIVE_TAB" };

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
