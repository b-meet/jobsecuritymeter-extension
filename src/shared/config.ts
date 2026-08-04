/**
 * Build-time configuration.
 *
 * No secrets live here and none ever should. This repository is public, and a
 * browser extension bundle is readable by anyone who installs it - `unzip` on
 * the .crx is all it takes. The Supabase publishable key below is designed to
 * be public (it is already shipped in the website's JS bundle); the service
 * role key must NEVER appear in this repo.
 */

export const SITE_ORIGIN = "https://jobsecuritymeter.com";

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
} as const;
