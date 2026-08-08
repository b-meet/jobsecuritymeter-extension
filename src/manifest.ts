import { defineManifest } from "@crxjs/vite-plugin";

/**
 * Applicant tracking systems the content script is injected into.
 *
 * DELIBERATELY A CURATED LIST, NOT `<all_urls>`. Broad host permissions send a
 * Chrome Web Store submission into a much deeper review that can add a week or
 * more, and they ask every user to trust us with every site they visit. We can
 * widen this in a later version once the listing has a review history.
 *
 * `boards.greenhouse.io` and `jobs.lever.co` cover the hosted boards, but both
 * are also embedded as cross-origin iframes on company career pages - which is
 * why `all_frames` is on below.
 */
const ATS_MATCHES = [
  // The hosted boards we started with.
  "https://boards.greenhouse.io/*",
  "https://job-boards.greenhouse.io/*",
  "https://*.greenhouse.io/*",
  "https://jobs.lever.co/*",
  "https://jobs.ashbyhq.com/*",
  "https://*.ashbyhq.com/*",
  "https://jobs.smartrecruiters.com/*",
  "https://*.myworkdayjobs.com/*",

  /**
   * The rest of the market.
   *
   * The original list covered the ATSs a US-centric startup sees and nothing
   * else, so a Keka or Zoho form - which is most of the Indian market - fell
   * through to "doesn't run on this page yet". Every entry below is an applicant
   * tracking system that hosts the application form itself on a per-company
   * subdomain, which is why the wildcards are safe: `*.keka.com` reaches
   * careers pages, not somebody's bank.
   *
   * This is still an allowlist, not `<all_urls>`. It grows by adding a name we
   * recognise, and anything genuinely unknown is covered by `activeTab` and the
   * per-site grant instead.
   */
  "https://*.keka.com/*",
  "https://*.darwinbox.com/*",
  "https://*.darwinbox.in/*",
  "https://*.zohorecruit.com/*",
  "https://*.zohorecruit.in/*",
  "https://*.freshteam.com/*",
  "https://*.workable.com/*",
  "https://*.bamboohr.com/*",
  "https://*.icims.com/*",
  "https://*.taleo.net/*",
  "https://*.successfactors.com/*",
  "https://*.successfactors.eu/*",
  "https://*.jobvite.com/*",
  "https://*.recruitee.com/*",
  "https://*.personio.de/*",
  "https://*.personio.com/*",
  "https://*.teamtailor.com/*",
  "https://*.breezy.hr/*",
  "https://*.applytojob.com/*",
  "https://*.pinpointhq.com/*",
  "https://*.avature.net/*",
  "https://*.eightfold.ai/*",
  "https://*.phenompeople.com/*",
  "https://*.join.com/*",
];

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

    action: {
      default_popup: "src/popup/index.html",
      default_title: "Job Autofill",
    },

    // No remote code: everything is bundled. Required for the store listing and
    // enforced here so a future dependency cannot quietly add a CDN script.
    content_security_policy: {
      extension_pages: "script-src 'self'; object-src 'self'",
    },
  };
});
