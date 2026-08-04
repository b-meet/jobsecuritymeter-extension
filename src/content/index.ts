import { detectFields } from "./detect";
import { fillField } from "./fill";
import { VAULT_FIELDS } from "@/shared/vault";
import type { ContentMessage, FillReport } from "@/shared/messages";

/**
 * Content script.
 *
 * Holds no token and stores nothing. It receives values for exactly one fill,
 * writes them, and forgets them - see shared/messages for why.
 *
 * Runs in every frame (`all_frames`), because Greenhouse and Lever boards are
 * usually embedded as cross-origin iframes on company career pages, and the
 * form is inside the iframe rather than the top document.
 */

function runFill(data: Record<string, string | boolean>): FillReport {
  const report: FillReport = { filled: [], skipped: [] };

  for (const match of detectFields(document)) {
    const value = data[match.key];

    if (value === undefined || value === "") {
      // Nothing saved for this field - not worth reporting as a failure, the
      // user simply has not filled that part of their profile.
      continue;
    }

    const outcome = fillField(match.element, value);
    if (outcome.ok) {
      report.filled.push({ key: match.key, label: VAULT_FIELDS.get(match.key)?.label ?? match.key });
    } else {
      report.skipped.push({ label: match.label, reason: outcome.reason });
    }
  }

  return report;
}

chrome.runtime.onMessage.addListener((message: ContentMessage, _sender, sendResponse) => {
  if (message?.type !== "FILL_NOW") return false;

  const report = runFill(message.data);
  showToast(report);
  sendResponse(report);
  return false;
});

/**
 * Result overlay.
 *
 * Rendered inside a shadow root so the page's stylesheet cannot restyle it and
 * ours cannot leak onto the application form - which would be a very visible
 * way to break someone's job application.
 */
function showToast(report: FillReport): void {
  const host = document.createElement("div");
  host.style.cssText = "position:fixed;bottom:20px;right:20px;z-index:2147483647;";
  const shadow = host.attachShadow({ mode: "closed" });

  const skipped = report.skipped.length;
  shadow.innerHTML = `
    <style>
      .card {
        font: 500 13px/1.45 system-ui, -apple-system, sans-serif;
        background: #1d2a25; color: #fff;
        border-radius: 14px; padding: 14px 16px;
        max-width: 300px; box-shadow: 0 12px 32px rgba(0,0,0,.28);
      }
      .count { font-weight: 700; }
      .muted { color: rgba(255,255,255,.6); margin-top: 4px; font-size: 12px; }
    </style>
    <div class="card">
      <div class="count">${report.filled.length} field${report.filled.length === 1 ? "" : "s"} filled</div>
      ${skipped ? `<div class="muted">${skipped} left for you - check before submitting.</div>` : ""}
    </div>
  `;

  document.body.appendChild(host);
  setTimeout(() => host.remove(), 5000);
}
