import type { Adapter } from "./adapters/types";
import { linkedinAdapter } from "./adapters/linkedin";
import { greenhouseAdapter } from "./adapters/greenhouse";
import { leverAdapter } from "./adapters/lever";
import { workdayAdapter } from "./adapters/workday";
import { fetchApplyData, syncApplied, type ApplyData } from "../lib/api";
import { getSettings } from "../lib/storage";
import { getCount, resetCount } from "../lib/filler";
import { mountOverlay } from "../lib/overlay";
import type { Assignment, AssignmentResponse } from "../lib/messages";

const ADAPTERS: Adapter[] = [linkedinAdapter, greenhouseAdapter, leverAdapter, workdayAdapter];

function pickAdapter(url: string): Adapter | null {
  return ADAPTERS.find((a) => a.matches(url)) ?? null;
}

async function getAssignment(): Promise<Assignment | null> {
  const res = (await chrome.runtime.sendMessage({ type: "GET_ASSIGNMENT" })) as AssignmentResponse;
  return res?.assignment ?? null;
}

let ran = false;

async function main() {
  const adapter = pickAdapter(location.href);
  if (!adapter) return;

  const assignment = await getAssignment();
  if (!assignment) return; // page opened without an Apply trigger — do nothing

  const settings = await getSettings();
  if (!settings.token) {
    console.warn("[AutoApply] No token set. Open the extension popup and paste your token.");
    return;
  }

  let data: ApplyData;
  try {
    data = await fetchApplyData(assignment.apiBase, assignment.jobId, settings.token);
  } catch (err) {
    console.error("[AutoApply] Failed to load apply data:", err);
    return;
  }

  resetCount();
  runFill(adapter, data);
  ran = true;

  const overlay = mountOverlay({
    company: data.company,
    role: data.role,
    filledCount: getCount(),
    handlers: {
      onSync: () => syncApplied(assignment.apiBase, assignment.jobId, settings.token!),
      onDismiss: () => observer.disconnect(),
    },
  });

  // ATS pages are SPAs: fields mount lazily (Workday) or per step (LinkedIn
  // Easy Apply). Re-run fill on DOM mutations, debounced, and keep the overlay
  // count fresh.
  let timer: number | undefined;
  const observer = new MutationObserver(() => {
    window.clearTimeout(timer);
    timer = window.setTimeout(() => {
      runFill(adapter, data);
      overlay.setStatus(`Auto-filled ${getCount()} fields — review and submit.`);
    }, 500);
  });
  observer.observe(document.body, { childList: true, subtree: true });

  // Stop observing after 2 minutes to avoid running forever.
  setTimeout(() => observer.disconnect(), 120_000);
}

function runFill(adapter: Adapter, data: ApplyData) {
  try {
    adapter.fill(data);
  } catch (err) {
    console.error("[AutoApply] fill error:", err);
  }
}

if (!ran) main();
