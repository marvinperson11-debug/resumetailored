import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import {
  TALENT_POOL_VISIBLE_FIELDS,
  defaultVisibility,
  normalizeVisibility,
  projectVisibleFields,
  matchesSearch,
  isContactRequestStatus,
  validateContactStatusMove,
  canSendContactRequest,
  canResendAfterHistory,
  type TalentPoolField,
  type TalentPoolProfileData,
  type TalentPoolSearchFilters,
  type ContactRequestStatus,
} from "./talent-pool-core";

/**
 * Talent Pool persistence (migrations 0082/0083). Service-role client, same
 * shape as lib/tracker-store.ts: every query is scoped by the Clerk
 * candidate_id/employer_id the caller supplies — there is no RLS policy to
 * lean on (both tables are RLS-on/no-policies, service-role only), so this
 * module IS the access boundary.
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

export function talentPoolEnabled(): boolean {
  return db() !== null;
}

export interface TalentPoolProfile {
  id: string;
  candidateId: string;
  isDiscoverable: boolean;
  headline: string;
  skills: string[];
  location: string;
  desiredRoles: string[];
  yearsExperience: number | null;
  workAuthorization: string;
  bio: string;
  visibility: Record<TalentPoolField, boolean>;
  optedInAt: string | null;
  optedOutAt: string | null;
  createdAt: string;
  updatedAt: string;
}

/* eslint-disable @typescript-eslint/no-explicit-any */
function fromRow(r: any): TalentPoolProfile {
  return {
    id: r.id,
    candidateId: r.candidate_id,
    isDiscoverable: !!r.is_discoverable,
    headline: r.headline || "",
    skills: Array.isArray(r.skills) ? r.skills : [],
    location: r.location || "",
    desiredRoles: Array.isArray(r.desired_roles) ? r.desired_roles : [],
    yearsExperience: typeof r.years_experience === "number" ? r.years_experience : null,
    workAuthorization: r.work_authorization || "",
    bio: r.bio || "",
    visibility: normalizeVisibility(r.visibility),
    optedInAt: r.opted_in_at ?? null,
    optedOutAt: r.opted_out_at ?? null,
    createdAt: r.created_at,
    updatedAt: r.updated_at,
  };
}
/* eslint-enable @typescript-eslint/no-explicit-any */

const clean = (s?: string | null, max = 2000) => {
  const v = (s ?? "").toString().trim();
  return v ? v.slice(0, max) : "";
};
const cleanList = (v: unknown, max = 50): string[] =>
  Array.isArray(v)
    ? v
        .filter((x): x is string => typeof x === "string" && x.trim().length > 0)
        .map((x) => x.trim().slice(0, 100))
        .slice(0, max)
    : [];
const numOrNull = (v: unknown): number | null => (typeof v === "number" && Number.isFinite(v) && v >= 0 ? v : null);

export async function getTalentPoolProfile(candidateId: string): Promise<TalentPoolProfile | null> {
  const c = db();
  if (!c || !candidateId) return null;
  try {
    const { data, error } = await c.from("talent_pool_profiles").select("*").eq("candidate_id", candidateId).maybeSingle();
    if (error || !data) return null;
    return fromRow(data);
  } catch {
    return null;
  }
}

export interface UpsertTalentPoolProfileInput {
  headline?: string;
  skills?: unknown;
  location?: string;
  desiredRoles?: unknown;
  yearsExperience?: number | null;
  workAuthorization?: string;
  bio?: string;
  visibility?: unknown;
}

/** Plain field/visibility edit — never touches `is_discoverable`. Creates
 *  the row on first save (still not discoverable until setDiscoverable
 *  explicitly opts in) so a candidate can fill in their profile before ever
 *  flipping the switch. */
export async function upsertTalentPoolProfile(candidateId: string, input: UpsertTalentPoolProfileInput): Promise<TalentPoolProfile | null> {
  const c = db();
  if (!c || !candidateId) return null;
  try {
    const existing = await getTalentPoolProfile(candidateId);
    const row: Record<string, unknown> = { updated_at: new Date().toISOString() };
    if (input.headline !== undefined) row.headline = clean(input.headline, 200);
    if (input.skills !== undefined) row.skills = cleanList(input.skills);
    if (input.location !== undefined) row.location = clean(input.location, 200);
    if (input.desiredRoles !== undefined) row.desired_roles = cleanList(input.desiredRoles, 20);
    if (input.yearsExperience !== undefined) row.years_experience = numOrNull(input.yearsExperience);
    if (input.workAuthorization !== undefined) row.work_authorization = clean(input.workAuthorization, 200);
    if (input.bio !== undefined) row.bio = clean(input.bio, 4000);
    if (input.visibility !== undefined) row.visibility = normalizeVisibility(input.visibility, existing?.visibility ?? defaultVisibility());

    if (existing) {
      const { data, error } = await c.from("talent_pool_profiles").update(row).eq("candidate_id", candidateId).select("*").single();
      if (error || !data) return null;
      return fromRow(data);
    }
    const { data, error } = await c
      .from("talent_pool_profiles")
      .insert({ candidate_id: candidateId, is_discoverable: false, visibility: normalizeVisibility(input.visibility), ...row })
      .select("*")
      .single();
    if (error || !data) return null;
    return fromRow(data);
  } catch (e) {
    console.error("[talent-pool-store] upsertTalentPoolProfile threw", e);
    return null;
  }
}

/** The master opt-in/opt-out switch. Opting out takes effect immediately
 *  (Q4): `is_discoverable` flips to false, `opted_out_at` is stamped, and
 *  every still-pending INBOUND request to this candidate is auto-withdrawn
 *  in the same call — never left dangling for an employer to act on after
 *  the candidate is no longer discoverable. */
export async function setTalentPoolDiscoverable(candidateId: string, discoverable: boolean): Promise<TalentPoolProfile | null> {
  const c = db();
  if (!c || !candidateId) return null;
  try {
    const now = new Date().toISOString();
    const existing = await getTalentPoolProfile(candidateId);
    const row: Record<string, unknown> = { is_discoverable: discoverable, updated_at: now };
    if (discoverable) row.opted_in_at = now;
    else row.opted_out_at = now;

    let saved: TalentPoolProfile | null;
    if (existing) {
      const { data, error } = await c.from("talent_pool_profiles").update(row).eq("candidate_id", candidateId).select("*").single();
      if (error || !data) return null;
      saved = fromRow(data);
    } else {
      if (!discoverable) return null; // nothing to opt out of
      const { data, error } = await c
        .from("talent_pool_profiles")
        .insert({ candidate_id: candidateId, visibility: defaultVisibility(), ...row })
        .select("*")
        .single();
      if (error || !data) return null;
      saved = fromRow(data);
    }

    if (!discoverable && saved) {
      await withdrawPendingInboundRequests(candidateId);
    }
    return saved;
  } catch (e) {
    console.error("[talent-pool-store] setTalentPoolDiscoverable threw", e);
    return null;
  }
}

async function withdrawPendingInboundRequests(candidateId: string): Promise<void> {
  const c = db();
  if (!c) return;
  try {
    await c
      .from("talent_pool_contact_requests")
      .update({ status: "withdrawn", responded_at: new Date().toISOString() })
      .eq("candidate_id", candidateId)
      .eq("status", "pending");
  } catch (e) {
    console.error("[talent-pool-store] withdrawPendingInboundRequests threw", e);
  }
}

/** The candidate's own "this is what employers see" preview — the exact
 *  same projection an employer would get, built from the identity the
 *  caller supplies (so the route, which already has it from Clerk, doesn't
 *  make this module talk to Clerk too). */
export function previewForCandidate(
  profile: TalentPoolProfile,
  identity: { name: string | null; photoUrl: string | null }
): Partial<TalentPoolProfileData> {
  const data: TalentPoolProfileData = {
    name: identity.name,
    photoUrl: identity.photoUrl,
    headline: profile.headline,
    skills: profile.skills,
    location: profile.location,
    desiredRoles: profile.desiredRoles,
    yearsExperience: profile.yearsExperience,
    workAuthorization: profile.workAuthorization,
    bio: profile.bio,
  };
  return projectVisibleFields(data, profile.visibility);
}

// ── Candidate-side: incoming requests ───────────────────────────────────────

export interface TalentPoolContactRequest {
  id: string;
  poolProfileId: string;
  employerId: string;
  candidateId: string;
  message: string;
  status: ContactRequestStatus;
  createdAt: string;
  respondedAt: string | null;
}

/* eslint-disable @typescript-eslint/no-explicit-any */
function requestFromRow(r: any): TalentPoolContactRequest {
  return {
    id: r.id,
    poolProfileId: r.pool_profile_id,
    employerId: r.employer_id,
    candidateId: r.candidate_id,
    message: r.message || "",
    status: isContactRequestStatus(r.status) ? r.status : "pending",
    createdAt: r.created_at,
    respondedAt: r.responded_at ?? null,
  };
}
/* eslint-enable @typescript-eslint/no-explicit-any */

export async function listIncomingContactRequests(candidateId: string): Promise<TalentPoolContactRequest[]> {
  const c = db();
  if (!c || !candidateId) return [];
  try {
    const { data, error } = await c.from("talent_pool_contact_requests").select("*").eq("candidate_id", candidateId).order("created_at", { ascending: false }).limit(200);
    if (error || !data) return [];
    return (data as unknown[]).map(requestFromRow);
  } catch {
    return [];
  }
}

export async function getContactRequestForCandidate(candidateId: string, id: string): Promise<TalentPoolContactRequest | null> {
  const c = db();
  if (!c || !candidateId || !id) return null;
  try {
    const { data, error } = await c.from("talent_pool_contact_requests").select("*").eq("candidate_id", candidateId).eq("id", id).maybeSingle();
    if (error || !data) return null;
    return requestFromRow(data);
  } catch {
    return null;
  }
}

export interface RespondResult {
  ok: boolean;
  reason?: string;
  request?: TalentPoolContactRequest;
}

/** Candidate accepts/declines an incoming request. Validated through the
 *  pure lib/talent-pool-core.ts state machine first, same pattern as
 *  lib/tracker-store.ts's moveStage. */
export async function respondToContactRequest(candidateId: string, id: string, toStatus: unknown): Promise<RespondResult> {
  const existing = await getContactRequestForCandidate(candidateId, id);
  if (!existing) return { ok: false, reason: "not found" };
  const check = validateContactStatusMove(existing.status, toStatus);
  if (!check.ok) return { ok: false, reason: check.reason };
  const c = db();
  if (!c) return { ok: false, reason: "unavailable" };
  try {
    const { data, error } = await c
      .from("talent_pool_contact_requests")
      .update({ status: check.toStatus, responded_at: new Date().toISOString() })
      .eq("candidate_id", candidateId)
      .eq("id", id)
      .select("*")
      .single();
    if (error || !data) return { ok: false, reason: "save failed" };
    return { ok: true, request: requestFromRow(data) };
  } catch {
    return { ok: false, reason: "save failed" };
  }
}

// ── Employer-side: search, detail, contact ──────────────────────────────────

export interface TalentPoolSearchResult {
  id: string;
  profile: Partial<TalentPoolProfileData>;
}

/** Discoverable profiles matching the given filters, each already projected
 *  down to only what the candidate made visible — a result card can render
 *  the object directly with no further trimming. Fetches a bounded working
 *  set (500 discoverable rows) and filters/sorts in-process via the same
 *  pure `matchesSearch` the test suite checks, the same division of labor
 *  lib/tracker-store.ts uses for anything beyond a plain column `eq`. */
export async function searchTalentPool(
  filters: TalentPoolSearchFilters,
  identities: (candidateId: string) => Promise<{ name: string | null; photoUrl: string | null }>,
  limit = 40
): Promise<TalentPoolSearchResult[]> {
  const c = db();
  if (!c) return [];
  try {
    const { data, error } = await c.from("talent_pool_profiles").select("*").eq("is_discoverable", true).order("updated_at", { ascending: false }).limit(500);
    if (error || !data) return [];
    const rows = (data as unknown[]).map(fromRow);
    const out: TalentPoolSearchResult[] = [];
    for (const row of rows) {
      const identity = await identities(row.candidateId);
      const dataForMatch: TalentPoolProfileData = {
        name: identity.name,
        photoUrl: identity.photoUrl,
        headline: row.headline,
        skills: row.skills,
        location: row.location,
        desiredRoles: row.desiredRoles,
        yearsExperience: row.yearsExperience,
        workAuthorization: row.workAuthorization,
        bio: row.bio,
      };
      if (!matchesSearch(dataForMatch, filters)) continue;
      out.push({ id: row.id, profile: projectVisibleFields(dataForMatch, row.visibility) });
      if (out.length >= limit) break;
    }
    return out;
  } catch (e) {
    console.error("[talent-pool-store] searchTalentPool threw", e);
    return [];
  }
}

export async function getDiscoverableProfileById(id: string): Promise<TalentPoolProfile | null> {
  const c = db();
  if (!c || !id) return null;
  try {
    const { data, error } = await c.from("talent_pool_profiles").select("*").eq("id", id).eq("is_discoverable", true).maybeSingle();
    if (error || !data) return null;
    return fromRow(data);
  } catch {
    return null;
  }
}

export async function countPendingContactRequestsForEmployer(employerId: string): Promise<number> {
  const c = db();
  if (!c || !employerId) return 0;
  try {
    const { data, error } = await c.from("talent_pool_contact_requests").select("id").eq("employer_id", employerId).eq("status", "pending").limit(500);
    if (error || !data) return 0;
    return (data as unknown[]).length;
  } catch {
    return 0;
  }
}

async function priorStatusesBetween(employerId: string, candidateId: string): Promise<ContactRequestStatus[]> {
  const c = db();
  if (!c) return [];
  try {
    const { data, error } = await c.from("talent_pool_contact_requests").select("status").eq("employer_id", employerId).eq("candidate_id", candidateId).limit(100);
    if (error || !data) return [];
    return (data as { status: string }[]).map((r) => (isContactRequestStatus(r.status) ? r.status : "pending"));
  } catch {
    return [];
  }
}

export async function listSentContactRequests(employerId: string): Promise<TalentPoolContactRequest[]> {
  const c = db();
  if (!c || !employerId) return [];
  try {
    const { data, error } = await c.from("talent_pool_contact_requests").select("*").eq("employer_id", employerId).order("created_at", { ascending: false }).limit(200);
    if (error || !data) return [];
    return (data as unknown[]).map(requestFromRow);
  } catch {
    return [];
  }
}

export interface CreateContactResult {
  ok: boolean;
  reason?: string;
  request?: TalentPoolContactRequest;
}

/** Create a new contact request — enforces the 10-pending cap and the
 *  decline-blocks-resend rule (Q1/Q3/Q7) before ever inserting a row. Both
 *  checks are TOCTOU-tolerant in the same sense the rest of this codebase's
 *  allowance checks are (e.g. checkSeatAllowance): a race between two
 *  concurrent sends from the same employer could both pass the pre-check,
 *  but that only ever costs one request over the cap, never a security
 *  issue, and is the same trade-off the tracker/employer-plan checks make
 *  everywhere else in this repo. */
export async function createContactRequest(employerId: string, profile: TalentPoolProfile, message: string): Promise<CreateContactResult> {
  const c = db();
  if (!c || !employerId) return { ok: false, reason: "unavailable" };
  if (!profile.isDiscoverable) return { ok: false, reason: "not discoverable" };
  const cleanMessage = clean(message, 4000);
  if (!cleanMessage) return { ok: false, reason: "A message is required." };

  const [pending, history] = await Promise.all([countPendingContactRequestsForEmployer(employerId), priorStatusesBetween(employerId, profile.candidateId)]);
  if (!canSendContactRequest(pending)) return { ok: false, reason: "You already have 10 pending requests. Wait for one to resolve before sending another." };
  if (!canResendAfterHistory(history)) return { ok: false, reason: "This candidate declined a previous request — you can't send another." };

  try {
    const { data, error } = await c
      .from("talent_pool_contact_requests")
      .insert({ pool_profile_id: profile.id, employer_id: employerId, candidate_id: profile.candidateId, message: cleanMessage, status: "pending" })
      .select("*")
      .single();
    if (error || !data) return { ok: false, reason: "Could not save." };
    return { ok: true, request: requestFromRow(data) };
  } catch (e) {
    console.error("[talent-pool-store] createContactRequest threw", e);
    return { ok: false, reason: "Could not save." };
  }
}

export { TALENT_POOL_VISIBLE_FIELDS };
