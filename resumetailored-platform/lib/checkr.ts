/**
 * Checkr background-check client. Server-only, raw REST over `fetch` — no
 * SDK, same convention as lib/docusign.ts / lib/twilio.ts.
 *
 * We never collect or store SSN/DOB: the candidate enters all PII on
 * Checkr's own hosted "invitation" flow (disclosure + authorization + PII
 * entry). This module only ever sends name/email/phone to create the
 * candidate shell, then stores back the Checkr-issued ids + status/result
 * summary — see lib/bgc-store.ts.
 *
 * Env: CHECKR_API_KEY (secret key, sent as HTTP Basic user with an empty
 * password per Checkr's API), CHECKR_WEBHOOK_SECRET (HMAC key for
 * `X-Checkr-Signature`), CHECKR_BASE_URL (default api.checkr.com).
 */
import crypto from "crypto";

const DEFAULT_BASE_URL = "https://api.checkr.com/v1";

function baseUrl(): string {
  return (process.env.CHECKR_BASE_URL || DEFAULT_BASE_URL).replace(/\/+$/, "");
}

export function isCheckrConfigured(): boolean {
  return !!process.env.CHECKR_API_KEY;
}

function authHeader(): string | null {
  const key = process.env.CHECKR_API_KEY;
  if (!key) return null;
  return `Basic ${Buffer.from(`${key}:`).toString("base64")}`;
}

async function checkrFetch<T>(path: string, init?: RequestInit): Promise<{ ok: boolean; data?: T; error?: string }> {
  const auth = authHeader();
  if (!auth) return { ok: false, error: "checkr_not_configured" };
  try {
    const res = await fetch(`${baseUrl()}${path}`, {
      ...init,
      headers: { Authorization: auth, "Content-Type": "application/json", ...(init?.headers || {}) },
    });
    const data = (await res.json().catch(() => ({}))) as T;
    if (!res.ok) return { ok: false, error: (data as Record<string, unknown>)?.error ? JSON.stringify((data as Record<string, unknown>).error) : `checkr_${res.status}` };
    return { ok: true, data };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "network_error" };
  }
}

export interface CheckrCandidate {
  id: string;
}

/** Create the candidate shell. No SSN/DOB here — the candidate supplies
 *  those directly to Checkr on the hosted invitation flow. */
export async function createCheckrCandidate(v: { firstName: string; lastName: string; email: string; phone?: string | null }): Promise<{ ok: boolean; candidateId?: string; error?: string }> {
  const r = await checkrFetch<CheckrCandidate>("/candidates", {
    method: "POST",
    body: JSON.stringify({ first_name: v.firstName, last_name: v.lastName, email: v.email, phone: v.phone || undefined }),
  });
  if (!r.ok || !r.data) return { ok: false, error: r.error };
  return { ok: true, candidateId: r.data.id };
}

export interface CheckrInvitation {
  id: string;
  invitation_url?: string;
  status?: string;
}

/** Send the hosted invitation (disclosure + authorization + PII entry +
 *  package) to the candidate's email. */
export async function createCheckrInvitation(v: { candidateId: string; packageSlug: string }): Promise<{ ok: boolean; invitationId?: string; invitationUrl?: string; error?: string }> {
  const r = await checkrFetch<CheckrInvitation>("/invitations", {
    method: "POST",
    body: JSON.stringify({ candidate_id: v.candidateId, package: v.packageSlug }),
  });
  if (!r.ok || !r.data) return { ok: false, error: r.error };
  return { ok: true, invitationId: r.data.id, invitationUrl: r.data.invitation_url };
}

export interface CheckrReport {
  id: string;
  status: string; // pending | clear | consider | suspended | complete | disputed
  result?: string | null; // clear | consider
  candidate_id: string;
}

export async function getCheckrReport(reportId: string): Promise<{ ok: boolean; report?: CheckrReport; error?: string }> {
  const r = await checkrFetch<CheckrReport>(`/reports/${reportId}`);
  if (!r.ok || !r.data) return { ok: false, error: r.error };
  return { ok: true, report: r.data };
}

/** Kick off Checkr's hosted adverse-action flow for a report. `kind`
 *  distinguishes the two FCRA steps; Checkr tracks its own sub-state once
 *  started — our own state machine (lib/adverse-action.ts) is what enforces
 *  the wait between them before `kind: "post"` may be called. */
export async function createCheckrAdverseAction(reportId: string, kind: "pre" | "post"): Promise<{ ok: boolean; id?: string; error?: string }> {
  const r = await checkrFetch<{ id: string }>("/adverse_items", {
    method: "POST",
    body: JSON.stringify({ report_id: reportId, action: kind === "pre" ? "pre_adverse_action" : "post_adverse_action" }),
  });
  if (!r.ok || !r.data) return { ok: false, error: r.error };
  return { ok: true, id: r.data.id };
}

/** Checkr signs webhooks as HMAC-SHA256(secret, rawBody), hex-encoded, in
 *  `X-Checkr-Signature`. Fails closed (false) with no secret configured. */
export function verifyCheckrSignature(rawBody: string, signatureHeader: string | null, secret: string): boolean {
  if (!signatureHeader || !secret) return false;
  try {
    const expected = crypto.createHmac("sha256", secret).update(rawBody, "utf8").digest("hex");
    const a = Buffer.from(expected);
    const b = Buffer.from(signatureHeader);
    return a.length === b.length && crypto.timingSafeEqual(a, b);
  } catch {
    return false;
  }
}

export interface CheckrWebhookEvent {
  id: string;
  type: string;
  data: { object: Record<string, unknown> };
}

export function parseCheckrWebhook(raw: string): CheckrWebhookEvent | null {
  try {
    const body = JSON.parse(raw) as Partial<CheckrWebhookEvent>;
    if (!body.id || !body.type || !body.data) return null;
    return body as CheckrWebhookEvent;
  } catch {
    return null;
  }
}

/** Map a Checkr report status (webhook `report.*` events) to our own
 *  order-status vocabulary (lib/bgc-store.ts). */
export function mapCheckrReportStatus(status: string): "invitation_sent" | "candidate_completed" | "report_pending" | "completed" | "suspended" | "disputed" {
  const s = status.toLowerCase();
  if (s === "pending") return "report_pending";
  if (s === "suspended") return "suspended";
  if (s === "disputed") return "disputed";
  if (s === "clear" || s === "consider" || s === "complete") return "completed";
  return "report_pending";
}
