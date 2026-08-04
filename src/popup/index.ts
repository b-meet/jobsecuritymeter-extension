import { API } from "@/shared/config";
import type { Request, Response, Status, FillReport } from "@/shared/messages";

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
  `;

  const msg = document.getElementById("msg")!;
  const fill = document.getElementById("fill") as HTMLButtonElement;

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
