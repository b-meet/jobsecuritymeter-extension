import { API } from "@/shared/config";
import type { Request, Response, SiteAccess, Status, FillReport } from "@/shared/messages";

/**
 * Popup. Renders status and triggers a fill; it never touches the session or
 * the API directly, only messages the background worker.
 */

function send<T>(request: Request): Promise<Response<T>> {
  return chrome.runtime.sendMessage(request);
}

const sub = document.getElementById("sub")!;
const body = document.getElementById("body")!;

function disconnected(): void {
  sub.textContent = "Not connected yet.";
  body.innerHTML = `<button id="connect">Connect my account</button>`;
  document.getElementById("connect")!.addEventListener("click", () => {
    chrome.tabs.create({ url: API.connect });
    window.close();
  });
}

/**
 * Offer to run on this site permanently.
 *
 * "Fill this page" already works everywhere via `activeTab`, so this is purely
 * about not having to open the popup again on a site somebody applies through
 * repeatedly - which is the toolbar problem this whole feature exists to avoid.
 *
 * `chrome.permissions.request()` HAS TO BE CALLED FROM HERE. It needs a user
 * gesture, and a service worker never has one; asking from the background would
 * simply be rejected. The popup is the only place with a real click behind it.
 */
async function offerSiteAccess(): Promise<void> {
  const slot = document.getElementById("site");
  if (!slot) return;

  const result = await send<SiteAccess>({ type: "GET_SITE_ACCESS" });
  if (!result.ok || !result.data.pattern || result.data.granted) return;

  const { pattern, host } = result.data;

  // Built rather than interpolated: `host` comes from the page the user is on.
  // A parsed hostname cannot hold HTML metacharacters, so this is belt and
  // braces - but page-derived text reaching innerHTML is not a habit worth
  // starting in a privileged surface.
  const button = document.createElement("button");
  button.className = "ghost";
  button.type = "button";
  button.textContent = `Always run on ${host}`;

  const note = document.createElement("p");
  note.className = "msg";

  slot.replaceChildren(button, note);

  button.addEventListener("click", async () => {
    let allowed = false;
    try {
      allowed = await chrome.permissions.request({ origins: [pattern] });
    } catch {
      allowed = false;
    }

    if (!allowed) {
      note.textContent = "Not allowed - you can still use Fill this page.";
      return;
    }

    await send({ type: "REGISTER_SITE", pattern });
    button.remove();
    note.textContent = `Job Autofill will open itself on ${host} from now on. Reload the page to see it.`;
  });
}

function connected(status: Status): void {
  sub.textContent = status.email ?? "Connected";

  const { filled = 0, total = 0 } = status.completion ?? {};
  const percent = total > 0 ? Math.round((filled / total) * 100) : 0;

  body.innerHTML = `
    ${
      status.completion
        ? `<div class="meter"><div style="width:${percent}%"></div></div>
           <p class="sub">${filled} of ${total} profile fields saved</p>`
        : ""
    }
    <button id="fill">Fill this page</button>
    <button class="ghost" id="edit">Edit my profile</button>
    <button class="ghost" id="out">Disconnect</button>
    <p class="msg" id="msg"></p>
    <div id="site"></div>
  `;

  const msg = document.getElementById("msg")!;
  const fill = document.getElementById("fill") as HTMLButtonElement;

  void offerSiteAccess();

  fill.addEventListener("click", async () => {
    fill.disabled = true;
    msg.textContent = "Filling…";

    const result = await send<FillReport>({ type: "FILL_ACTIVE_TAB" });
    fill.disabled = false;

    if (!result.ok) {
      msg.textContent = result.error;
      return;
    }

    const { filled: done, skipped } = result.data;
    msg.textContent = done.length
      ? `Filled ${done.length} field${done.length === 1 ? "" : "s"}.${skipped.length ? ` ${skipped.length} left for you.` : ""}`
      : "Nothing here matched your profile.";
  });

  document.getElementById("edit")!.addEventListener("click", () => {
    chrome.tabs.create({ url: `${API.connect.replace("/extension/connect", "/account")}#autofill` });
    window.close();
  });

  document.getElementById("out")!.addEventListener("click", async () => {
    await send({ type: "SIGN_OUT" });
    disconnected();
  });
}

async function init(): Promise<void> {
  const result = await send<Status>({ type: "GET_STATUS" });

  if (!result.ok || !result.data.connected) {
    disconnected();
    return;
  }
  connected(result.data);
}

void init();
