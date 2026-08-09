/**
 * Reaching pages the manifest never listed.
 *
 * THE PROBLEM THIS SOLVES. `content_scripts` in the manifest only covers the
 * curated ATS hosts, because asking for `<all_urls>` up front sends a Chrome
 * Web Store submission into a much deeper review and asks every user to trust
 * us with every site they visit. But most applications are not on those hosts:
 * companies run their own careers pages, and smaller ATSs are a long tail we
 * will never finish enumerating. On all of those the extension simply said
 * "doesn't run on this page yet", which is a dead end from the user's side.
 *
 * There are two ways past it, and we use both because they answer different
 * questions.
 *
 *   ON DEMAND (`injectNow`). `activeTab` grants host access to the current tab
 *   at the moment the user invokes the extension - opening the popup and
 *   pressing a button is exactly that gesture. So we can inject the content
 *   script into any page, for that one visit, with NO permission prompt and no
 *   standing access. This is the default and it covers everything.
 *
 *   STANDING (`grantSite` / `syncGrantedSites`). If somebody applies through
 *   the same careers page repeatedly, having to open the popup every time is
 *   the toolbar problem all over again. `optional_host_permissions` lets them
 *   grant one origin, at which point the handle auto-appears there like it does
 *   on Greenhouse. The user asks for it explicitly, sees Chrome's own prompt,
 *   and can revoke it in chrome://extensions - which is the difference between
 *   this and shipping `<all_urls>`.
 */

/**
 * Built paths of the content script, read from the manifest at runtime.
 *
 * NOT hardcoded: the bundler emits content-hashed filenames, so a literal path
 * here would break on the next build with nothing to catch it.
 */
function contentScriptFiles(): string[] {
  return chrome.runtime.getManifest().content_scripts?.[0]?.js ?? [];
}

/**
 * Put the content script into a tab that has none.
 *
 * Tries every frame first, because an embedded board lives in an iframe and the
 * top document alone would miss the form. `activeTab` does not always extend to
 * cross-origin frames, so a rejection there is expected rather than exceptional
 * - we fall back to the top frame, which is the right answer for a careers page
 * that hosts its own form.
 */
export async function injectNow(tabId: number): Promise<boolean> {
  const files = contentScriptFiles();
  if (files.length === 0) return false;

  try {
    await chrome.scripting.executeScript({ target: { tabId, allFrames: true }, files });
    return true;
  } catch {
    try {
      await chrome.scripting.executeScript({ target: { tabId }, files });
      return true;
    } catch {
      // Chrome's own pages, the web store, and PDF viewers refuse injection no
      // matter what is granted. Nothing to do but say so honestly.
      return false;
    }
  }
}

/** Match pattern covering one origin, e.g. https://careers.acme.com/* */
export function patternFor(url: string): string | null {
  try {
    const { protocol, hostname } = new URL(url);
    // http and https only. A pattern over file:// or chrome-extension:// is
    // either useless or dangerous, and no job application lives there.
    if (protocol !== "https:" && protocol !== "http:") return null;
    return `${protocol}//${hostname}/*`;
  } catch {
    return null;
  }
}

/** Stable, collision-free id for a dynamically registered script. */
function scriptIdFor(pattern: string): string {
  return `jsm-site-${pattern.replace(/[^a-z0-9]/gi, "-")}`;
}

/**
 * Register the content script for an origin the user has granted.
 *
 * `persistAcrossSessions` is what makes this survive a browser restart, so the
 * grant behaves like the manifest entry it stands in for rather than something
 * that quietly lapses.
 */
export async function registerSite(pattern: string): Promise<void> {
  const files = contentScriptFiles();
  if (files.length === 0) return;

  const script = {
    id: scriptIdFor(pattern),
    matches: [pattern],
    js: files,
    allFrames: true,
    runAt: "document_idle" as const,
    persistAcrossSessions: true,
  };

  try {
    await chrome.scripting.registerContentScripts([script]);
  } catch {
    // Almost always "id already registered". Updating is the right repair, and
    // it also picks up new build filenames after an extension update.
    await chrome.scripting.updateContentScripts([script]).catch(() => {});
  }
}

async function unregisterSite(pattern: string): Promise<void> {
  await chrome.scripting.unregisterContentScripts({ ids: [scriptIdFor(pattern)] }).catch(() => {});
}

/**
 * Make the registered scripts match the permissions we actually hold.
 *
 * Runs on install, on startup, and whenever a permission is added or removed.
 * The user can revoke a site in chrome://extensions without telling us, and a
 * script still registered for a revoked origin would fail to inject on every
 * page load there - so the permission list is the source of truth and this
 * reconciles to it in both directions.
 */
export async function syncGrantedSites(): Promise<void> {
  const granted = await chrome.permissions.getAll();
  const origins = granted.origins ?? [];

  // Anything already in the manifest is handled by the static content_scripts
  // entry; registering it again would run the script twice on those hosts.
  const manifestMatches = new Set(chrome.runtime.getManifest().content_scripts?.[0]?.matches ?? []);
  const wanted = origins.filter((origin) => !manifestMatches.has(origin));

  const existing = await chrome.scripting.getRegisteredContentScripts().catch(() => []);
  const existingIds = new Set(existing.map((script) => script.id));
  const wantedIds = new Set(wanted.map(scriptIdFor));

  for (const pattern of wanted) {
    if (!existingIds.has(scriptIdFor(pattern))) await registerSite(pattern);
  }

  for (const script of existing) {
    if (script.id.startsWith("jsm-site-") && !wantedIds.has(script.id)) {
      await chrome.scripting.unregisterContentScripts({ ids: [script.id] }).catch(() => {});
    }
  }
}

export { unregisterSite };
