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
  "https://boards.greenhouse.io/*",
  "https://job-boards.greenhouse.io/*",
  "https://*.greenhouse.io/*",
  "https://jobs.lever.co/*",
  "https://jobs.ashbyhq.com/*",
  "https://*.ashbyhq.com/*",
  "https://jobs.smartrecruiters.com/*",
  "https://*.myworkdayjobs.com/*",
];

const SITE = "https://jobsecuritymeter.com";

export default defineManifest({
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

  host_permissions: [`${SITE}/*`, ...ATS_MATCHES],

  /**
   * The sign-in handshake. jobsecuritymeter.com/extension/connect is already
   * cookie-authenticated, so it can hand us a Supabase session directly via
   * chrome.runtime.sendMessage - no second OAuth client, no password ever
   * touching the extension. Only our own origin may do this.
   */
  externally_connectable: { matches: [`${SITE}/*`] },

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
});
