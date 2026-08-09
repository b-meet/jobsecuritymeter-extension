/**
 * Host lists and resource exposure for the manifest.
 *
 * Split out of manifest.ts because that file imports the bundler's
 * `defineManifest`, which drags in esbuild and cannot be loaded by the test
 * runner. These are the two settings most likely to break something silently
 * and least likely to be noticed, so they need to be assertable.
 */

/**
 * Applicant tracking systems the content script is injected into.
 *
 * DELIBERATELY AN ALLOWLIST, NOT `<all_urls>`. Broad host permissions send a
 * Chrome Web Store submission into a much deeper review, and they ask every
 * user to trust us with every site they visit. Anything not listed here is
 * reached through `activeTab` on a click, or a per-site grant the user makes.
 *
 * The wildcards are safe because every entry is an ATS that hosts the
 * application form on a per-company subdomain: `*.keka.com` reaches careers
 * pages, not somebody's bank.
 */
export const ATS_MATCHES = [
  // The hosted boards we started with.
  "https://boards.greenhouse.io/*",
  "https://job-boards.greenhouse.io/*",
  "https://*.greenhouse.io/*",
  "https://jobs.lever.co/*",
  "https://jobs.ashbyhq.com/*",
  "https://*.ashbyhq.com/*",
  "https://jobs.smartrecruiters.com/*",
  "https://*.myworkdayjobs.com/*",

  // The rest of the market. The original list covered the ATSs a US-centric
  // startup sees and nothing else, so Keka and Zoho - most of the Indian
  // market - fell through to "doesn't run on this page yet".
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

/**
 * THE CONTENT SCRIPT IS A LOADER, AND THIS IS WHAT LETS IT LOAD.
 *
 * The bundler emits the `content_scripts` entry as a stub that runs
 * `await import(chrome.runtime.getURL("assets/index.ts-<hash>.js"))`. That
 * dynamic import is fetched with the PAGE as initiator, so it is governed by
 * this key - not by host_permissions, and not by the fact that we injected the
 * stub ourselves a moment earlier.
 *
 * The bundler generates its own entry scoped to `content_scripts.matches`,
 * i.e. the ATS list above. Correct for the declared path, useless for the
 * injected one: on a company careers page `chrome.scripting.executeScript`
 * ran the stub, the stub asked for the real module, and Chrome answered
 * "Denying load of chrome-extension://... Resources must be listed in the
 * web_accessible_resources manifest key". executeScript reported success
 * throughout, so nothing upstream noticed - the script simply never ran.
 *
 * `<all_urls>` HERE GRANTS NO ACCESS TO ANY SITE. It only states which pages
 * may load a file we deliberately put there. Host access is host_permissions,
 * which stays a curated list.
 *
 * KNOWN COST: a fixed resource URL lets a page detect that this extension is
 * installed, which is why theme.ts keeps its icon inline rather than shipping
 * one. `use_dynamic_url: true` rotates the URL per session and is the proper
 * answer, but it interacts with `getURL()` inside the loader in ways this
 * build has not been verified against - shipping it blind into the path that
 * is already broken is the wrong trade. Deliberate follow-up, to test in a
 * browser.
 */
export const WEB_ACCESSIBLE_RESOURCES: {
  resources: string[];
  matches: string[];
  use_dynamic_url: boolean;
}[] = [
  {
    resources: ["assets/*", "src/content/*"],
    matches: ["<all_urls>"],
    use_dynamic_url: false,
  },
];
