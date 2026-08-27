// Runs on the AutoApply dashboard origin. Bridges window.postMessage from the
// page (which cannot talk to the extension directly) to the background worker.

import type { ApplyMessage } from "../lib/messages";

// Announce presence so the dashboard can show "Extension connected".
document.documentElement.setAttribute("data-autoapply-ext", "1");

window.addEventListener("message", (event: MessageEvent) => {
  if (event.source !== window) return;
  const msg = event.data;
  if (!msg || msg.source !== "autoapply-dashboard") return;

  if (msg.type === "PING") {
    window.postMessage({ source: "autoapply-extension", type: "PONG" }, window.location.origin);
    return;
  }

  if (msg.type === "APPLY") {
    const apply: ApplyMessage = {
      type: "APPLY",
      jobId: String(msg.jobId),
      jobUrl: String(msg.jobUrl),
      apiBase: String(msg.apiBase),
    };
    chrome.runtime.sendMessage(apply);
  }
});
