/**
 * Build-time configuration.
 *
 * No secrets live here and none ever should. This repository is public, and a
 * browser extension bundle is readable by anyone who installs it - `unzip` on
 * the .crx is all it takes. The Supabase publishable key below is designed to
 * be public (it is already shipped in the website's JS bundle); the service
 * role key must NEVER appear in this repo.
 */

export const PROD_ORIGIN = "https://jobsecuritymeter.com";

/**
 * Where the extension looks for the site.
 *
 * Overridable so a dev build can point at a local Next server:
 *   VITE_SITE_ORIGIN=http://localhost:3000 npm run dev
 *
 * Without this the extension would talk to production while you are testing
 * against localhost, which looks like the extension is broken when in fact it
 * is reading a different database.
 */
export const SITE_ORIGIN = import.meta.env.VITE_SITE_ORIGIN ?? PROD_ORIGIN;

/**
 * True only in a `vite build`-for-development or `vite dev` bundle.
 *
 * Every localhost allowance in this codebase hangs off this flag. A PRODUCTION
 * BUILD MUST NEVER TRUST LOCALHOST: `externally_connectable` is what decides
 * who may hand this extension a session, and a published extension that
 * accepted `http://localhost` would take one from any dev server on the user's
 * machine - including one served by a malicious page's local helper.
 */
export const IS_DEV = import.meta.env.DEV;

/** Loopback hosts a dev build will accept a session from. */
const DEV_HOSTS = new Set(["localhost", "127.0.0.1"]);

/**
 * Is this origin allowed to hand us a Supabase session?
 *
 * Production is an exact string match. Dev additionally accepts loopback on any
 * port, because the Next dev server's port moves around and match patterns
 * ignore ports anyway.
 */
export function isTrustedOrigin(origin: string | undefined): boolean {
  if (!origin) return false;
  if (origin === SITE_ORIGIN || origin === PROD_ORIGIN) return true;
  if (!IS_DEV) return false;

  try {
    return DEV_HOSTS.has(new URL(origin).hostname);
  } catch {
    return false;
  }
}

export const API = {
  vault: `${SITE_ORIGIN}/api/vault`,
  fieldMap: `${SITE_ORIGIN}/api/vault/field-map`,
  connect: `${SITE_ORIGIN}/extension/connect`,
} as const;

/**
 * Supabase project, used only to refresh the access token we were handed.
 * The extension never signs anyone in itself - see background/auth.ts.
 */
export const SUPABASE_URL = "https://qrmcrzpfaicilfiijdkj.supabase.co";
export const SUPABASE_PUBLISHABLE_KEY = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY ?? "";

export const STORAGE_KEYS = {
  session: "jsm.session",
  fieldMap: "jsm.fieldMap",
  fieldMapEtag: "jsm.fieldMapEtag",
  /** Where the user last parked the on-page handle. See content/ui/dock.ts. */
  dock: "jsm.dock",
  /** Origins where the handle is collapsed to an edge tab rather than shown. */
  tuckedOrigins: "jsm.tuckedOrigins",
} as const;
