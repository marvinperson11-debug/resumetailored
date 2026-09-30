/**
 * Employer plan / tier limits — the full pricing matrix.
 *
 * The employer plan is one role (`plan: "employer"`) with a free-form `tier`
 * string on Clerk `publicMetadata` (see lib/plan.ts). This module maps that tier
 * to every feature quota and module lock in the matrix:
 *
 *   Free       → 1 active job · 10 candidates in pipeline · 1 team seat
 *                E-Sig 3/mo · Career site BASIC · Video/Employees hub/Time
 *                suite/Office all LOCKED (visible with an upgrade banner, not
 *                hidden — see the LockedModule* components in components/ui.tsx)
 *   Portal $49 → unlimited jobs + candidates · 3 seats · E-Sig 10/mo ·
 *                Video 10/mo + recording · Career site FULL builder ·
 *                Employees hub FULL · Time suite FULL · Office still LOCKED
 *   Scale $99  → 10 seats · E-Sig 50/mo · Video 50/mo + AI summaries ·
 *                Office FULL (Calculators are free at every tier)
 *   Corporate  → unlimited sends/interviews/seats · white-label (custom
 *                careers domain + no "Powered by" badge) · SSO-ready
 *
 * An employer with no tier set (or an unrecognized tier) falls back to Free, the
 * safe floor. The admin bypasses every cap and lock (treated as Corporate).
 */
import type { Access } from "./plan";

export type EmployerTier = "free" | "portal" | "scale" | "corporate";
const TIER_RANK: Record<EmployerTier, number> = { free: 0, portal: 1, scale: 2, corporate: 3 };
function atLeast(access: Access, tier: EmployerTier): boolean {
  if (access.isAdmin) return true;
  return TIER_RANK[normalizeTier(access.tier)] >= TIER_RANK[tier];
}

/** Monthly DocuSign send limits by tier. `Infinity` means unlimited. */
export const DOCUSIGN_MONTHLY_SENDS: Record<EmployerTier, number> = {
  free: 3,
  portal: 10,
  scale: 50,
  corporate: Infinity,
};

/** Normalize a free-form tier string to a known tier, defaulting to "free". */
export function normalizeTier(tier: string | null | undefined): EmployerTier {
  const t = (tier || "").trim().toLowerCase();
  if (t === "portal" || t === "scale" || t === "corporate") return t;
  return "free";
}

/** Human label for a tier (for UI + upgrade copy). */
export function tierLabel(tier: EmployerTier): string {
  return tier.charAt(0).toUpperCase() + tier.slice(1);
}

/** The monthly DocuSign send limit for a given access context. Admin ⇒ unlimited. */
export function docusignMonthlyLimit(access: Access): number {
  if (access.isAdmin) return Infinity;
  return DOCUSIGN_MONTHLY_SENDS[normalizeTier(access.tier)];
}

// ── Video interviews (Daily.co) ───────────────────────────────────────────────
/** Monthly video-interview limits by tier. `Infinity` = unlimited, 0 = blocked. */
export const VIDEO_MONTHLY: Record<EmployerTier, number> = {
  free: 0,
  portal: 10,
  scale: 50,
  corporate: Infinity,
};

/** Recording + transcription available from Portal up. */
export function canRecordInterviews(access: Access): boolean {
  if (access.isAdmin) return true;
  return normalizeTier(access.tier) !== "free";
}

/** AI interview summaries available from Scale up. */
export function canInterviewAiSummary(access: Access): boolean {
  if (access.isAdmin) return true;
  const t = normalizeTier(access.tier);
  return t === "scale" || t === "corporate";
}

// ── Office suite ───────────────────────────────────────────────────────────────
/** Whether a tier is Scale or above (Scale, Corporate). Shared by every
 *  Scale+ Office tool: Charts now, Spreadsheet Creator / Report Writer /
 *  Presentation Builder in later phases. Calculators are on every tier and
 *  don't call this. */
export function isScalePlusTier(access: Access): boolean {
  if (access.isAdmin) return true;
  const t = normalizeTier(access.tier);
  return t === "scale" || t === "corporate";
}

/** The monthly video-interview limit for a given access context. */
export function videoMonthlyLimit(access: Access): number {
  if (access.isAdmin) return Infinity;
  return VIDEO_MONTHLY[normalizeTier(access.tier)];
}

/**
 * Resolve an employer's tier by their Clerk userId (publicMetadata.tier) —
 * for server contexts with no session to call getAccess() from: a webhook,
 * or a PUBLIC page (the careers site, resolving its OWNER's tier to decide
 * what's live). Best-effort: any failure resolves to "free", the safe floor.
 * The admin account always resolves to "corporate".
 */
export async function resolveTierForUserId(userId: string): Promise<EmployerTier> {
  if (!userId) return "free";
  try {
    const { isAdminId } = await import("./admin");
    if (isAdminId(userId)) return "corporate";
    const { clerkClient } = await import("@clerk/nextjs/server");
    const client = await clerkClient();
    const user = await client.users.getUser(userId);
    return normalizeTier((user?.publicMetadata as { tier?: string })?.tier);
  } catch {
    return "free";
  }
}

/** Whether an employer's tier includes AI interview summaries — resolved by
 *  userId, for server contexts without a session (the Daily webhook). */
export async function canUseAiSummaryForTier(userId: string): Promise<boolean> {
  const tier = await resolveTierForUserId(userId);
  return tier === "scale" || tier === "corporate";
}

/** Whether an employer's career site should render the FULL builder (vs the
 *  Free BASIC page) — resolved by userId, for the public /careers/:slug page,
 *  which has no employer session of its own. */
export async function canUseCareerSiteBuilderForTier(userId: string): Promise<boolean> {
  const tier = await resolveTierForUserId(userId);
  return tier !== "free";
}

/** Whether an employer's career site should hide the "Powered by
 *  ResumeTailored" badge — resolved by userId, for the public page. */
export async function canUseWhiteLabelForTier(userId: string): Promise<boolean> {
  const tier = await resolveTierForUserId(userId);
  return tier === "corporate";
}

export interface VideoAllowance {
  allowed: boolean;
  limit: number; // Infinity = unlimited, 0 = not on this tier
  used: number;
  remaining: number;
  tier: EmployerTier;
  canRecord: boolean;
  canSummary: boolean;
  message: string;
}

/** Decide whether one more video interview is allowed this calendar month. */
export function checkVideoAllowance(access: Access, used: number): VideoAllowance {
  const tier = access.isAdmin ? "corporate" : normalizeTier(access.tier);
  const limit = videoMonthlyLimit(access);
  const remaining = limit === Infinity ? Infinity : Math.max(0, limit - used);
  const allowed = limit === Infinity ? true : remaining > 0;
  let message = "";
  if (!allowed) {
    message =
      limit === 0
        ? "Video interviews are a Pro feature. Upgrade to Portal to host video interviews with auto-generated join links."
        : `You've used all ${limit} video interviews included in your ${tierLabel(tier)} plan this month. Upgrade for more, or wait until next month.`;
  }
  return {
    allowed,
    limit,
    used,
    remaining,
    tier,
    canRecord: canRecordInterviews(access),
    canSummary: canInterviewAiSummary(access),
    message,
  };
}

export interface SendAllowance {
  allowed: boolean;
  limit: number; // Infinity = unlimited
  used: number;
  remaining: number; // Infinity = unlimited
  tier: EmployerTier;
  /** Friendly message when the cap is hit (empty when allowed). */
  message: string;
}

/**
 * Decide whether one more send is allowed, given the count already used this
 * calendar month. Pure — the caller supplies `used` from the store.
 */
export function checkSendAllowance(access: Access, used: number): SendAllowance {
  const tier = access.isAdmin ? "corporate" : normalizeTier(access.tier);
  const limit = docusignMonthlyLimit(access);
  const remaining = limit === Infinity ? Infinity : Math.max(0, limit - used);
  const allowed = remaining > 0;
  const nextTier = tier === "free" ? "Portal (10/mo)" : tier === "portal" ? "Scale (50/mo)" : "Corporate (unlimited)";
  const message = allowed
    ? ""
    : `You've used all ${limit} offer-letter sends included in your ${tierLabel(
        tier
      )} plan this month. Upgrade to ${nextTier} to send more, or wait until next month when your allowance resets.`;
  return { allowed, limit, used, remaining, tier, message };
}

// ── Job postings ───────────────────────────────────────────────────────────────
/** Active job posting limits by tier. `Infinity` = unlimited. Free counts only
 *  postings with status "active" — a draft doesn't consume the slot, so a free
 *  employer can draft freely and publish one at a time. */
export const JOB_POSTING_LIMITS: Record<EmployerTier, number> = {
  free: 1,
  portal: Infinity,
  scale: Infinity,
  corporate: Infinity,
};

export function jobPostingLimit(access: Access): number {
  if (access.isAdmin) return Infinity;
  return JOB_POSTING_LIMITS[normalizeTier(access.tier)];
}

export interface JobAllowance {
  allowed: boolean;
  limit: number;
  used: number;
  remaining: number;
  tier: EmployerTier;
  message: string;
}

/** Decide whether one more ACTIVE job posting is allowed, given the count of
 *  currently-active postings this employer already has. */
export function checkJobAllowance(access: Access, activeUsed: number): JobAllowance {
  const tier = access.isAdmin ? "corporate" : normalizeTier(access.tier);
  const limit = jobPostingLimit(access);
  const remaining = limit === Infinity ? Infinity : Math.max(0, limit - activeUsed);
  const allowed = limit === Infinity ? true : remaining > 0;
  const message = allowed
    ? ""
    : `You've used your ${limit} free active job posting. Upgrade to Employer Portal for unlimited job postings, or close an existing one first.`;
  return { allowed, limit, used: activeUsed, remaining, tier, message };
}

// ── Candidate pipeline ────────────────────────────────────────────────────────
/** Total candidates-in-pipeline limits by tier (across all jobs, any status
 *  except explicitly rejected — a candidate the employer has passed on
 *  shouldn't keep occupying a slot). `Infinity` = unlimited. */
export const CANDIDATE_PIPELINE_LIMITS: Record<EmployerTier, number> = {
  free: 10,
  portal: Infinity,
  scale: Infinity,
  corporate: Infinity,
};

export function candidatePipelineLimit(access: Access): number {
  if (access.isAdmin) return Infinity;
  return CANDIDATE_PIPELINE_LIMITS[normalizeTier(access.tier)];
}

export interface CandidateAllowance {
  allowed: boolean;
  limit: number;
  used: number;
  remaining: number;
  tier: EmployerTier;
  message: string;
}

/** Decide whether one more candidate can be added to the pipeline, given the
 *  count already there. This gates the employer's own manual "add candidate"
 *  action — a real applicant arriving through the public job-application form
 *  is never rejected for the employer's plan; see createPublicApplicant. */
export function checkCandidateAllowance(access: Access, used: number): CandidateAllowance {
  const tier = access.isAdmin ? "corporate" : normalizeTier(access.tier);
  const limit = candidatePipelineLimit(access);
  const remaining = limit === Infinity ? Infinity : Math.max(0, limit - used);
  const allowed = limit === Infinity ? true : remaining > 0;
  const message = allowed
    ? ""
    : `You've used all ${limit} candidate slots included in the Free plan. Upgrade to Employer Portal for an unlimited pipeline.`;
  return { allowed, limit, used, remaining, tier, message };
}

// ── Team seats ─────────────────────────────────────────────────────────────────
/** Team seat limits by tier, INCLUDING the owner's own seat. `Infinity` =
 *  unlimited. */
export const TEAM_SEAT_LIMITS: Record<EmployerTier, number> = {
  free: 1,
  portal: 3,
  scale: 10,
  corporate: Infinity,
};

export function teamSeatLimit(access: Access): number {
  if (access.isAdmin) return Infinity;
  return TEAM_SEAT_LIMITS[normalizeTier(access.tier)];
}

export interface SeatAllowance {
  allowed: boolean;
  limit: number;
  used: number;
  remaining: number;
  tier: EmployerTier;
  message: string;
}

/** Decide whether one more team seat (an active member or a pending invite —
 *  both hold the seat) can be filled, given the count already used. */
export function checkSeatAllowance(access: Access, used: number): SeatAllowance {
  const tier = access.isAdmin ? "corporate" : normalizeTier(access.tier);
  const limit = teamSeatLimit(access);
  const remaining = limit === Infinity ? Infinity : Math.max(0, limit - used);
  const allowed = limit === Infinity ? true : remaining > 0;
  const nextTier = tier === "free" ? "Portal (3 seats)" : tier === "portal" ? "Scale (10 seats)" : "Corporate (unlimited seats)";
  const message = allowed
    ? ""
    : `You've used all ${limit} team seat${limit === 1 ? "" : "s"} on the ${tierLabel(tier)} plan. Upgrade to ${nextTier} to invite more teammates.`;
  return { allowed, limit, used, remaining, tier, message };
}

// ── Locked modules (Free-tier: Video is quota-gated above; these four are
//    fully module-locked below a tier, but stay VISIBLE — see
//    LockedModuleBanner/useFirstTouchGate in components/ui.tsx) ────────────────
/** Employees hub (training, quizzes, onboarding, certs, feed, skills):
 *  Portal and above. */
export function canUseEmployeesHub(access: Access): boolean {
  return atLeast(access, "portal");
}
/** Time suite (schedule, clock in/out, timesheets, time off): Portal and above. */
export function canUseTimeSuite(access: Access): boolean {
  return atLeast(access, "portal");
}
/** Career site FULL builder (custom layout/branding beyond the basic subdomain
 *  page every tier gets): Portal and above. */
export function canUseCareerSiteBuilder(access: Access): boolean {
  return atLeast(access, "portal");
}

// ── White-label (Corporate) ──────────────────────────────────────────────────
/** Custom careers domain (careers.yourco.com via CNAME) + removal of the
 *  "Powered by ResumeTailored" footer badge: Corporate only. */
export function canUseWhiteLabel(access: Access): boolean {
  return atLeast(access, "corporate");
}

// ── Documents ──────────────────────────────────────────────────────────────
/** Document-count limits by tier. `Infinity` = unlimited. Counts every row an
 *  employer has created in `documents` (Document Creator + Office-suite
 *  saves) — never documents received from others, and never gates viewing,
 *  editing, or sending an EXISTING document (signing spends the separate
 *  e-sig quota instead, see `checkSendAllowance`). */
export const DOCUMENT_LIMITS: Record<EmployerTier, number> = {
  free: 5,
  portal: 50,
  scale: 200,
  corporate: Infinity,
};

export function documentLimit(access: Access): number {
  if (access.isAdmin) return Infinity;
  return DOCUMENT_LIMITS[normalizeTier(access.tier)];
}

export interface DocumentAllowance {
  allowed: boolean;
  limit: number;
  used: number;
  remaining: number;
  tier: EmployerTier;
  message: string;
}

/** Decide whether one more document can be CREATED — a new Document Creator
 *  document, an uploaded PDF sent standalone (not from an existing document),
 *  or an Office-suite save (chart/spreadsheet/report/presentation) — given
 *  the count already owned. */
export function checkDocumentAllowance(access: Access, used: number): DocumentAllowance {
  const tier = access.isAdmin ? "corporate" : normalizeTier(access.tier);
  const limit = documentLimit(access);
  const remaining = limit === Infinity ? Infinity : Math.max(0, limit - used);
  const allowed = limit === Infinity ? true : remaining > 0;
  const nextTier = tier === "free" ? "Portal (50 documents)" : tier === "portal" ? "Scale (200 documents)" : "Corporate (unlimited documents)";
  const message = allowed
    ? ""
    : `You've used all ${limit} documents included in the ${tierLabel(tier)} plan. Upgrade to ${nextTier} to create more, or delete an existing one first.`;
  return { allowed, limit, used, remaining, tier, message };
}

// ── Persistent in-page upgrade card ─────────────────────────────────────────
export interface UpgradeCardData {
  /** Machine tier so the client can render the plan name and pitch in the
   *  user's language; `planLabel`/`pitch` stay as the English fallback. */
  tier: "free" | "portal" | "scale";
  planLabel: string;
  used: number;
  limit: number;
  pitch: string;
}

const UPGRADE_PITCH: Record<"free" | "portal" | "scale", string> = {
  free: "Upgrade to Portal for unlimited jobs & candidates, more sends, and video interviewing.",
  portal: "Upgrade to Scale for more sends, AI interview summaries, and the Office suite.",
  scale: "Upgrade to Corporate for unlimited sends and white-label career pages.",
};

/**
 * Data for the slim, persistent upgrade card shown at the bottom of every
 * non-locked employer page (Dashboard, Hire, Candidates, Messages,
 * Shortlists, E-Signatures, Documents, Team — locked modules show their own
 * LockedModuleBanner instead, so they never render this too). `null` for
 * Corporate and the admin bypass: both have unlimited sends and nowhere
 * further to upgrade.
 */
export async function getUpgradeCardData(access: Access, employerId: string): Promise<UpgradeCardData | null> {
  const tier = access.isAdmin ? "corporate" : normalizeTier(access.tier);
  if (tier === "corporate") return null;
  const { monthlySendCount } = await import("./docusign-store");
  const used = await monthlySendCount(employerId);
  const allowance = checkSendAllowance(access, used);
  if (allowance.limit === Infinity) return null;
  return { tier, planLabel: tierLabel(tier), used: allowance.used, limit: allowance.limit, pitch: UPGRADE_PITCH[tier] };
}
