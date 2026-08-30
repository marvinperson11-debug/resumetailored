// main-app-queue.ts — server-side client for the main ResumeTailored app's
// /api/apply-queue (the source of truth for the user's apply queue).
//
// The two apps share no session store; they share the user's EMAIL. This module
// authenticates as a trusted first-party service using a shared secret
// (RT_SERVICE_TOKEN) held only on the server, never exposed to the browser or
// the extension. Pure mapping/normalization lives in ./queue-sync.js.
//
// Env:
//   RT_MAIN_APP_URL   e.g. https://resumetailored.com  (or http://localhost:3000 in dev)
//   RT_SERVICE_TOKEN  the shared secret; must match the main app's RT_SERVICE_TOKEN

// @ts-ignore — pure JS helper module (allowJs), no type declarations needed.
import * as sync from "./queue-sync.js";

export interface MainQueueItem {
  mainId: string;
  jobUrl: string;
  roleTitle: string;
  companyName: string;
  jobBoard: string;
  mainStatus: string;
  status: "NEW" | "PREPARED" | "APPLIED";
  updatedAt: string | null;
}

export type LocalStatus = "NEW" | "PREPARED" | "APPLIED";

function baseUrl(): string {
  return process.env.RT_MAIN_APP_URL || "";
}
function serviceToken(): string {
  return process.env.RT_SERVICE_TOKEN || "";
}

/** True when RT_MAIN_APP_URL + RT_SERVICE_TOKEN are both set. */
export function bridgeConfigured(): boolean {
  return sync.isBridgeConfigured(baseUrl(), serviceToken());
}

function headers(email: string): Record<string, string> {
  return sync.mainQueueHeaders(serviceToken(), email);
}

/** Fetch the user's queue from the main app. Returns [] when unconfigured. */
export async function fetchMainQueue(email: string): Promise<MainQueueItem[]> {
  if (!bridgeConfigured()) return [];
  const res = await fetch(sync.joinUrl(baseUrl(), "/api/apply-queue"), {
    method: "GET",
    headers: headers(email),
    cache: "no-store",
  });
  if (!res.ok) throw new Error(`main queue fetch failed: HTTP ${res.status}`);
  const data = await res.json().catch(() => ({}));
  const items = Array.isArray(data.items) ? data.items : [];
  return items.map((i: unknown) => sync.normalizeMainItem(i) as MainQueueItem);
}

/** Queue counts { count, queued } from the main app. Zeroed when unconfigured. */
export async function mainQueueCount(email: string): Promise<{ count: number; queued: number }> {
  if (!bridgeConfigured()) return { count: 0, queued: 0 };
  const res = await fetch(sync.joinUrl(baseUrl(), "/api/apply-queue/count"), {
    method: "GET",
    headers: headers(email),
    cache: "no-store",
  });
  if (!res.ok) throw new Error(`main queue count failed: HTTP ${res.status}`);
  const data = await res.json().catch(() => ({}));
  return { count: Number(data.count) || 0, queued: Number(data.queued) || 0 };
}

/** Add a job to the main app's queue. Returns the created/normalized item. */
export async function addToMainQueue(
  email: string,
  job: { jobUrl: string; jobTitle?: string; companyName?: string; jobBoard?: string }
): Promise<MainQueueItem | null> {
  if (!bridgeConfigured()) return null;
  const res = await fetch(sync.joinUrl(baseUrl(), "/api/apply-queue"), {
    method: "POST",
    headers: headers(email),
    body: JSON.stringify({
      job_url: job.jobUrl,
      job_title: job.jobTitle || "",
      company_name: job.companyName || "",
      job_board: job.jobBoard || "",
    }),
  });
  if (!res.ok) throw new Error(`main queue add failed: HTTP ${res.status}`);
  const data = await res.json().catch(() => ({}));
  return data.item ? (sync.normalizeMainItem(data.item) as MainQueueItem) : null;
}

/**
 * Write a local status change back to the main app. `localStatus` is mapped to
 * the main enum (NEW→queued, PREPARED→auto_filled, APPLIED→submitted; anything
 * else → manual_needed). No-op (returns false) when unconfigured or no mainId.
 */
export async function updateMainStatus(
  email: string,
  mainId: string | null | undefined,
  localStatus: LocalStatus | string
): Promise<boolean> {
  if (!bridgeConfigured() || !mainId) return false;
  const status = sync.localToMainStatus(localStatus);
  const res = await fetch(sync.joinUrl(baseUrl(), `/api/apply-queue/${mainId}`), {
    method: "PATCH",
    headers: headers(email),
    body: JSON.stringify({ status }),
  });
  return res.ok;
}
