// Background service worker. Owns the "assignment" lifecycle: when the
// dashboard fires APPLY, open the job URL in a new tab and remember which job
// that tab is filling, keyed by tab id in session storage (survives the worker
// being suspended, cleared when the browser closes).

import type { BackgroundMessage, Assignment, AssignmentResponse } from "../lib/messages";

const key = (tabId: number) => `assignment:${tabId}`;

async function setAssignment(tabId: number, a: Assignment) {
  await chrome.storage.session.set({ [key(tabId)]: a });
}
async function getAssignment(tabId: number): Promise<Assignment | null> {
  const stored = await chrome.storage.session.get(key(tabId));
  return (stored[key(tabId)] as Assignment) ?? null;
}
async function clearAssignment(tabId: number) {
  await chrome.storage.session.remove(key(tabId));
}

chrome.runtime.onMessage.addListener(
  (msg: BackgroundMessage, sender, sendResponse) => {
    if (msg.type === "APPLY") {
      chrome.tabs.create({ url: msg.jobUrl }, (tab) => {
        if (tab.id != null) {
          void setAssignment(tab.id, { jobId: msg.jobId, jobUrl: msg.jobUrl, apiBase: msg.apiBase });
        }
      });
      sendResponse({ ok: true });
      return true;
    }

    if (msg.type === "GET_ASSIGNMENT") {
      const tabId = sender.tab?.id;
      if (tabId == null) {
        sendResponse({ assignment: null } satisfies AssignmentResponse);
        return true;
      }
      void getAssignment(tabId).then((assignment) =>
        sendResponse({ assignment } satisfies AssignmentResponse)
      );
      return true; // async
    }

    if (msg.type === "CLEAR_ASSIGNMENT") {
      const tabId = sender.tab?.id;
      if (tabId != null) void clearAssignment(tabId);
      sendResponse({ ok: true });
      return true;
    }

    return false;
  }
);

// Tidy up when a tab closes.
chrome.tabs.onRemoved.addListener((tabId) => void clearAssignment(tabId));
