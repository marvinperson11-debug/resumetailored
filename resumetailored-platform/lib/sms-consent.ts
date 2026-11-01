import { createClient, type SupabaseClient } from "@supabase/supabase-js";

/**
 * SMS consent (`messaging_consents`, migration 0087) + the opt-out
 * suppression list (`sms_opt_outs`, migration 0088, migration 0087).
 *
 * Consent is captured ONCE, at application time, via a checkbox next to a
 * versioned disclosure (`DISCLOSURE_VERSION`/`DISCLOSURE_TEXT` below) — see
 * app/api/public/jobs/[jobId]/apply/route.ts. It applies to NEW candidates
 * only: the existing applicant pool has no consent row and stays
 * unreachable by SMS (email remains their channel) — there is deliberately
 * no backfill script and no opt-in email campaign in this build.
 *
 * The suppression list is GLOBAL (keyed only on the phone number, not on
 * employer+phone): a STOP replied to any org's number suppresses that
 * number from every org on the platform, which is the conservative reading
 * of "maintain our own suppression list keyed on E.164 phone" and is also
 * what makes "opt-out survives record merges" trivially true — a merge of
 * two applicant records for the same person never touches this table at
 * all, because it was never keyed on an applicant/record id to begin with.
 */
let cached: SupabaseClient | null = null;
function db(): SupabaseClient | null {
  if (cached) return cached;
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SERVICE_KEY;
  if (!url || !key) return null;
  cached = createClient(url, key, { auth: { persistSession: false } });
  return cached;
}

export const DISCLOSURE_VERSION = "2026-11-v1";
export const DISCLOSURE_TEXT =
  "By checking this box, you agree to receive text messages about your application from the employer via ResumeTailored. Message frequency varies. Message and data rates may apply. Reply STOP to opt out at any time, HELP for help.";

export type ConsentStatus = "opted_in" | "opted_out";

export interface ConsentRow {
  id: string;
  employerId: string;
  applicantId: number;
  phoneNormalized: string;
  status: ConsentStatus;
  disclosureVersion: string;
  consentedAt: string;
}

function mapRow(r: Record<string, unknown>): ConsentRow {
  return {
    id: r.id as string,
    employerId: (r.employer_id as string) || "",
    applicantId: Number(r.applicant_id),
    phoneNormalized: (r.phone_normalized as string) || "",
    status: (r.status as ConsentStatus) || "opted_out",
    disclosureVersion: (r.disclosure_version as string) || "",
    consentedAt: (r.consented_at as string) || "",
  };
}

/** Record consent captured at application time. Best-effort: never throws,
 *  returns false (and logs) when the store is unavailable — the caller
 *  (the apply route) must not fail the whole application over this. */
export async function recordConsent(v: { employerId: string; applicantId: number; phoneNormalized: string; source?: string }): Promise<boolean> {
  const c = db();
  if (!c || !v.employerId || !v.applicantId || !v.phoneNormalized) return false;
  try {
    const { error } = await c.from("messaging_consents").insert({
      employer_id: v.employerId,
      applicant_id: v.applicantId,
      phone_normalized: v.phoneNormalized,
      status: "opted_in",
      disclosure_version: DISCLOSURE_VERSION,
      source: v.source || "application",
    });
    if (error) {
      console.error("[sms-consent] recordConsent failed", error);
      return false;
    }
    return true;
  } catch (e) {
    console.error("[sms-consent] recordConsent threw", e);
    return false;
  }
}

/** The most recent consent decision for this applicant, or null if none was
 *  ever captured (the "no consent row -> no send" case for every pre-build
 *  applicant). */
export async function getLatestConsent(applicantId: number): Promise<ConsentRow | null> {
  const c = db();
  if (!c || !Number.isFinite(applicantId)) return null;
  try {
    const { data, error } = await c
      .from("messaging_consents")
      .select("*")
      .eq("applicant_id", applicantId)
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    if (error || !data) return null;
    return mapRow(data as Record<string, unknown>);
  } catch {
    return null;
  }
}

export async function isOptedIn(applicantId: number): Promise<boolean> {
  const row = await getLatestConsent(applicantId);
  return !!row && row.status === "opted_in";
}

/** True when `phoneNormalized` is on the global suppression list — checked
 *  on EVERY send, not just the first message in a thread. */
export async function isSuppressed(phoneNormalized: string): Promise<boolean> {
  const c = db();
  if (!c || !phoneNormalized) return true; // fail closed: an unreachable store must never silently allow a send
  try {
    const { data, error } = await c.from("sms_opt_outs").select("phone_normalized").eq("phone_normalized", phoneNormalized).maybeSingle();
    if (error) {
      console.error("[sms-consent] isSuppressed query failed — failing closed", error);
      return true;
    }
    return !!data;
  } catch (e) {
    console.error("[sms-consent] isSuppressed threw — failing closed", e);
    return true;
  }
}

/** STOP (and its carrier-recognized synonyms) — permanent, global, until a
 *  matching START. Idempotent: a second STOP for an already-suppressed
 *  number is a no-op, not a duplicate-key error. */
export async function recordOptOut(phoneNormalized: string, source = "stop_keyword"): Promise<void> {
  const c = db();
  if (!c || !phoneNormalized) return;
  try {
    await c.from("sms_opt_outs").upsert({ phone_normalized: phoneNormalized, source, opted_out_at: new Date().toISOString() }, { onConflict: "phone_normalized" });
  } catch (e) {
    console.error("[sms-consent] recordOptOut threw", e);
  }
}

/** START — removes the suppression. Does NOT create a new opted_in consent
 *  row: the original application-time consent (if any) still stands;
 *  START only lifts the STOP, it isn't a fresh opt-in grant. */
export async function recordOptIn(phoneNormalized: string): Promise<void> {
  const c = db();
  if (!c || !phoneNormalized) return;
  try {
    await c.from("sms_opt_outs").delete().eq("phone_normalized", phoneNormalized);
  } catch (e) {
    console.error("[sms-consent] recordOptIn threw", e);
  }
}

export type OptOutKeyword = "stop" | "start" | "help";

const STOP_WORDS = new Set(["stop", "stopall", "unsubscribe", "cancel", "end", "quit"]);
const START_WORDS = new Set(["start", "yes", "unstop"]);
const HELP_WORDS = new Set(["help", "info"]);

/** Classify an inbound body as one of Twilio's Advanced Opt-Out keywords, or
 *  null for an ordinary reply. Case/whitespace-insensitive, exact match only
 *  (a body that merely contains "stop" mid-sentence is NOT a keyword). */
export function classifyKeyword(body: string): OptOutKeyword | null {
  const w = body.trim().toLowerCase();
  if (STOP_WORDS.has(w)) return "stop";
  if (START_WORDS.has(w)) return "start";
  if (HELP_WORDS.has(w)) return "help";
  return null;
}
