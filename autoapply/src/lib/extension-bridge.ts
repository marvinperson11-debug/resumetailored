// Client-side helpers for talking to the AutoApply browser extension from the
// dashboard page. Communication goes page → (window.postMessage) → the
// extension's dashboard content script → background service worker.

const SOURCE = "autoapply-dashboard";

export interface ApplyTrigger {
  jobId: string;
  jobUrl: string;
  apiBase: string;
}

/** Fire an APPLY message the extension's dashboard bridge listens for. */
export function triggerExtensionApply(payload: ApplyTrigger) {
  window.postMessage({ source: SOURCE, type: "APPLY", ...payload }, window.location.origin);
}

/**
 * Detect the extension. Its dashboard content script sets a marker attribute
 * on <html> and answers a PING. We resolve true on either signal.
 */
export function isExtensionInstalled(timeoutMs = 400): Promise<boolean> {
  return new Promise((resolve) => {
    if (document.documentElement.getAttribute("data-autoapply-ext") === "1") {
      resolve(true);
      return;
    }
    let settled = false;
    const done = (v: boolean) => {
      if (settled) return;
      settled = true;
      window.removeEventListener("message", onMsg);
      resolve(v);
    };
    const onMsg = (e: MessageEvent) => {
      if (e.source === window && e.data?.source === "autoapply-extension" && e.data?.type === "PONG") {
        done(true);
      }
    };
    window.addEventListener("message", onMsg);
    window.postMessage({ source: SOURCE, type: "PING" }, window.location.origin);
    setTimeout(() => done(false), timeoutMs);
  });
}
