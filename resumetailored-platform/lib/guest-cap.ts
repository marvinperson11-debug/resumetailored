/**
 * What the signed-out free tier says when it declines a request (see lib/guest.ts and the guest
 * gate in the API routes). Pure and dependency-free so the UI and its tests share one reading of
 * the payload.
 *
 *   402 { error: 'guest_quota',       tool, limit, resets: 'tomorrow', guest: true, message }
 *   503 { error: 'guest_capacity',    guest: true, message }   today's anonymous budget is spent
 *   503 { error: 'guest_unavailable', guest: true, message }   the quota store is down (fails closed)
 *
 * Every guest decline carries `guest: true`; nothing a signed-in user receives does.
 */
export type GuestCapKind = "quota" | "capacity" | "unavailable";

export interface GuestCap {
  kind: GuestCapKind;
  /** The server's tool key (`tailor`, `ats-scan`, …) — null for capacity/unavailable. */
  tool: string | null;
  limit: number | null;
  /** The server's English message; the UI prefers its own localized copy and falls back to this. */
  message: string | null;
}

export function parseGuestCap(status: number, data: unknown): GuestCap | null {
  if (!data || typeof data !== "object") return null;
  const d = data as Record<string, unknown>;
  if (d.guest !== true) return null;
  const message = typeof d.message === "string" ? d.message : null;
  if (status === 402 && d.error === "guest_quota") {
    return { kind: "quota", tool: typeof d.tool === "string" ? d.tool : null, limit: typeof d.limit === "number" ? d.limit : null, message };
  }
  if (status === 503 && d.error === "guest_capacity") return { kind: "capacity", tool: null, limit: null, message };
  if (status === 503 && d.error === "guest_unavailable") return { kind: "unavailable", tool: null, limit: null, message };
  return null;
}

/** The guest tool keys (lib/guest.ts GUEST_TOOLS) — each has a localized label under `guestNudge.tools`. */
export const GUEST_TOOL_KEYS = [
  "tailor",
  "cover-letter",
  "ats-scan",
  "extract-text",
  "fetch-job-url",
  "linkedin-scrape",
  "linkedin-import",
  "linkedin-analyze",
  "interview-questions",
  "interview-feedback",
  "jobs-search",
  "jobs-cover-letter",
  "jobs-apply-package",
  "career-insights",
  "career-skill-gap",
  "career-roadmap",
  "decoder-decode",
] as const;

export function isGuestToolKey(tool: string | null): tool is (typeof GUEST_TOOL_KEYS)[number] {
  return !!tool && (GUEST_TOOL_KEYS as readonly string[]).includes(tool);
}
