/**
 * Talent Pool ("Get Found by employers") — pure logic. No DB, no network,
 * same role in this feature that lib/tracker-core.ts plays for the
 * Application Tracker: the state machine, the field whitelist, and the
 * "what does an employer actually see" projection all live here so they can
 * be unit-tested directly and used identically by the candidate's own
 * preview ("this is what employers see") and the real employer-facing read.
 */

/** Every profile field a candidate can individually show or hide. `name` and
 *  `photo` are included even though their DATA lives on the Clerk account
 *  (not on talent_pool_profiles) — visibility is still a per-field choice
 *  like any other field (Q2), the storage location doesn't change that. */
export const TALENT_POOL_VISIBLE_FIELDS = [
  "name",
  "photo",
  "headline",
  "skills",
  "location",
  "desiredRoles",
  "yearsExperience",
  "workAuthorization",
  "bio",
] as const;
export type TalentPoolField = (typeof TALENT_POOL_VISIBLE_FIELDS)[number];

export function isTalentPoolField(v: unknown): v is TalentPoolField {
  return typeof v === "string" && (TALENT_POOL_VISIBLE_FIELDS as readonly string[]).includes(v);
}

/** Default visibility: everything visible until the candidate hides it —
 *  opting in is the gate; per-field hiding is an extra, deliberate step on
 *  top, not the default (Q4: no minimum completeness, no per-field default
 *  to hidden). */
export function defaultVisibility(): Record<TalentPoolField, boolean> {
  const v = {} as Record<TalentPoolField, boolean>;
  for (const f of TALENT_POOL_VISIBLE_FIELDS) v[f] = true;
  return v;
}

/** Merge a candidate-supplied visibility patch onto a full map, dropping any
 *  key that isn't a real field (defensive against a stale client or a typo —
 *  never silently honors a hidden field it doesn't do, and never lets an
 *  unknown key accumulate forever in the stored jsonb). */
export function normalizeVisibility(raw: unknown, base: Record<TalentPoolField, boolean> = defaultVisibility()): Record<TalentPoolField, boolean> {
  const out = { ...base };
  if (raw && typeof raw === "object") {
    for (const [k, v] of Object.entries(raw as Record<string, unknown>)) {
      if (isTalentPoolField(k)) out[k] = v !== false; // anything but an explicit false stays visible
    }
  }
  return out;
}

export interface TalentPoolProfileData {
  name: string | null;
  photoUrl: string | null;
  headline: string;
  skills: string[];
  location: string;
  desiredRoles: string[];
  yearsExperience: number | null;
  workAuthorization: string;
  bio: string;
}

/** The exact projection an employer (or the candidate's own "this is what
 *  employers see" preview) is allowed to receive: every field not in
 *  `visibility` as explicitly-visible is simply omitted from the object
 *  (never sent as `null`/empty — omission is what lets the client tell "not
 *  shared" apart from "shared but blank"). The single function both the
 *  preview and every employer-facing route call, so they can never disagree
 *  about what's visible. */
export function projectVisibleFields(data: TalentPoolProfileData, visibility: Record<TalentPoolField, boolean>): Partial<TalentPoolProfileData> {
  const out: Partial<TalentPoolProfileData> = {};
  if (visibility.name) out.name = data.name;
  if (visibility.photo) out.photoUrl = data.photoUrl;
  if (visibility.headline) out.headline = data.headline;
  if (visibility.skills) out.skills = data.skills;
  if (visibility.location) out.location = data.location;
  if (visibility.desiredRoles) out.desiredRoles = data.desiredRoles;
  if (visibility.yearsExperience) out.yearsExperience = data.yearsExperience;
  if (visibility.workAuthorization) out.workAuthorization = data.workAuthorization;
  if (visibility.bio) out.bio = data.bio;
  return out;
}

// ── Search / filtering (employer browse) ────────────────────────────────────

export interface TalentPoolSearchFilters {
  skills?: string[];
  location?: string;
  desiredRole?: string;
  minYearsExperience?: number;
  /** Free text over headline + bio. */
  q?: string;
}

const norm = (s: unknown) => (typeof s === "string" ? s.trim().toLowerCase() : "");

/** Pure predicate so the fake-Postgres test harness and the real Supabase
 *  `.contains()`/`.ilike()` query (lib/talent-pool-store.ts) stay provably in
 *  agreement — the store issues the equivalent filter at the DB layer; this
 *  function is what the test suite checks the INTENT against. */
export function matchesSearch(profile: TalentPoolProfileData, filters: TalentPoolSearchFilters): boolean {
  if (filters.skills?.length) {
    const have = new Set((profile.skills || []).map(norm));
    if (!filters.skills.some((s) => have.has(norm(s)))) return false;
  }
  if (filters.location && !norm(profile.location).includes(norm(filters.location))) return false;
  if (filters.desiredRole) {
    const roles = (profile.desiredRoles || []).map(norm);
    if (!roles.some((r) => r.includes(norm(filters.desiredRole)))) return false;
  }
  if (typeof filters.minYearsExperience === "number") {
    if (profile.yearsExperience === null || profile.yearsExperience === undefined || profile.yearsExperience < filters.minYearsExperience) return false;
  }
  if (filters.q) {
    const needle = norm(filters.q);
    const haystack = `${norm(profile.headline)} ${norm(profile.bio)}`;
    if (!haystack.includes(needle)) return false;
  }
  return true;
}

// ── Contact-request state machine ───────────────────────────────────────────

export const CONTACT_REQUEST_STATUSES = ["pending", "accepted", "declined", "withdrawn"] as const;
export type ContactRequestStatus = (typeof CONTACT_REQUEST_STATUSES)[number];

export function isContactRequestStatus(v: unknown): v is ContactRequestStatus {
  return typeof v === "string" && (CONTACT_REQUEST_STATUSES as readonly string[]).includes(v);
}

/** Pending is the only non-terminal state, and it can only move to accepted,
 *  declined, or withdrawn — never back to pending, and never between two
 *  terminal states (an accepted request can't later be "declined", a
 *  declined one can't be "accepted"). Same shape as
 *  lib/tracker-core.ts's validateStageMove: a pure check the route calls
 *  before writing anything. */
export function validateContactStatusMove(from: ContactRequestStatus, to: unknown): { ok: true; toStatus: ContactRequestStatus } | { ok: false; reason: string } {
  if (!isContactRequestStatus(to)) return { ok: false, reason: "not a real status" };
  if (from !== "pending") return { ok: false, reason: `request is already ${from}` };
  if (to === "pending") return { ok: false, reason: "not a real move" };
  return { ok: true, toStatus: to };
}

/** The employer-side pending cap (Q1/Q7): a new request is blocked until a
 *  pending one resolves. Pure so the cap number lives in exactly one place. */
export const MAX_PENDING_CONTACT_REQUESTS_PER_EMPLOYER = 10;

export function canSendContactRequest(pendingCount: number): boolean {
  return pendingCount < MAX_PENDING_CONTACT_REQUESTS_PER_EMPLOYER;
}

/** Decline-blocks-resend (Q3/Q7): an employer who has been declined by this
 *  candidate before may never message them again. A withdrawn (employer's
 *  own cancel) or an opted-out withdrawal does NOT block a future resend —
 *  only an explicit candidate decline does. */
export function canResendAfterHistory(priorStatuses: ContactRequestStatus[]): boolean {
  return !priorStatuses.includes("declined");
}
