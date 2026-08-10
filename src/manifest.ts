import { defineManifest } from "@crxjs/vite-plugin";
import { ATS_MATCHES, ICONS, WEB_ACCESSIBLE_RESOURCES } from "./manifest-hosts";

const SITE = process.env.VITE_SITE_ORIGIN ?? "https://jobsecuritymeter.com";

/**
 * Loopback origins, added ONLY to a development build.
 *
 * Match patterns ignore ports, so `http://localhost/*` covers :3000 and
 * friends. This must never reach a published build: `externally_connectable`
 * decides who may hand the extension a session, and trusting localhost in the
 * store build would accept one from any dev server on the user's machine.
 */
const DEV_MATCHES = ["http://localhost/*", "http://127.0.0.1/*"];

export default defineManifest((env) => {
  const isDev = env.mode === "development";
  const siteMatches = isDev ? [`${SITE}/*`, ...DEV_MATCHES] : [`${SITE}/*`];

  return {
    manifest_version: 3,
    name: "Job Autofill by Job Security Meter",
    version: "0.1.0",
    description:
      "Fill job applications from your saved profile. One click across Greenhouse, Lever, Ashby and more.",

    permissions: [
      // chrome.storage.local: the session and the cached field map.
      "storage",
      // Lets the popup's "Fill this page" button reach a tab the content script
      // did not auto-inject into. Narrower than "tabs", which would expose every
      // tab's URL to us.
      "activeTab",
      "scripting",
    ],

    host_permissions: [...siteMatches, ...ATS_MATCHES],

    /**
     * Sites the user can add themselves, one origin at a time.
     *
     * Most applications are NOT on the curated list above: companies run their
     * own careers pages, and the long tail of smaller ATSs is not something we
     * will ever finish enumerating. Without this the honest answer on those
     * pages was "doesn't run here yet", which is a dead end.
     *
     * OPTIONAL, not granted at install. Nothing here appears on the store
     * listing's permission warning, nothing is held until somebody asks for it,
     * and every grant is revocable from chrome://extensions. That is the whole
     * difference between this and shipping `<all_urls>` - which would put the
     * submission into a much deeper review and ask every user to trust us with
     * their banking tabs to fill in a job application.
     *
     * The popup's one-off "Fill this page" needs none of this; it rides
     * `activeTab`. This is only for "run here automatically from now on".
     */
    optional_host_permissions: ["https://*/*", "http://*/*"],

    /**
     * The sign-in handshake. jobsecuritymeter.com/extension/connect is already
     * cookie-authenticated, so it can hand us a Supabase session directly via
     * chrome.runtime.sendMessage - no second OAuth client, no password ever
     * touching the extension. Only our own origin may do this - plus loopback
     * in a dev build, never in a published one.
     */
    externally_connectable: { matches: siteMatches },

    background: { service_worker: "src/background/index.ts", type: "module" },

    content_scripts: [
      {
        matches: ATS_MATCHES,
        js: ["src/content/index.ts"],
        // Greenhouse and Lever are embedded as iframes on company career sites,
        // so the top frame alone would miss most real application forms.
        all_frames: true,
        run_at: "document_idle",
      },
    ],

    // See manifest-hosts.ts for why these are not optional.
    icons: ICONS,

    action: {
      default_popup: "src/popup/index.html",
      default_title: "Job Autofill",
      default_icon: ICONS,
    },

    /**
     * See manifest-hosts.ts: the content script is a loader whose dynamic
     * import is governed by this key, and the bundler's own entry only covers
     * the declared ATS hosts - never the sites we inject into.
     */
    web_accessible_resources: WEB_ACCESSIBLE_RESOURCES,

    // No remote code: everything is bundled. Required for the store listing and
    // enforced here so a future dependency cannot quietly add a CDN script.
    content_security_policy: {
      extension_pages: "script-src 'self'; object-src 'self'",
    },
  };
});
