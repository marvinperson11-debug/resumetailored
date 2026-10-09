/**
 * Resume Video monthly allowance: who gets how many, what has been used, and the one rule for when a video
 * counts. Pure functions + a thin counter wrapper over `usage_counters` (migration 0043, already applied).
 *
 *  - Pro monthly: 10 / month, Pro Lifetime: 40 / month (lib/plan-config.ts). Free and employer tiers never get
 *    here — the tool stays Pro-gated exactly as before.
 *  - A video consumes quota only when its render completes successfully (recordVideoGenerated is called after
 *    the render returns a video). A failed voiceover or render costs nothing.
 *  - The check runs BEFORE the voiceover is recorded, so a member at their limit never spends ElevenLabs credits.
 *  - The admin and employer-invited staff are not on a purchased plan: admin is unlimited; staff use the monthly
 *    Pro allowance.
 */
import type { Access } from "./plan";
import { RESUME_VIDEO_MONTHLY_LIMITS } from "./plan-config";
import { getCounter, bumpCounter, monthPeriod } from "./usage-counter";

export const VIDEO_COUNTER_KIND = "resume_video";

export type VideoPlanKind = "monthly" | "lifetime" | "unlimited";

export interface VideoQuota {
  kind: VideoPlanKind;
  /** null = unlimited */
  limit: number | null;
  used: number;
  /** null = unlimited */
  remaining: number | null;
  /** UTC month key the count belongs to, e.g. "2026-10". */
  period: string;
}

/** Which allowance applies to this account. `lifetime` comes from isLifetimeAccount() (Pro only). */
export function videoPlanKind(access: Pick<Access, "isAdmin" | "plan">, lifetime: boolean): VideoPlanKind {
  if (access.isAdmin) return "unlimited";
  return lifetime && access.plan === "pro" ? "lifetime" : "monthly";
}

export function videoLimitFor(kind: VideoPlanKind): number | null {
  return kind === "unlimited" ? null : kind === "lifetime" ? RESUME_VIDEO_MONTHLY_LIMITS.proLifetime : RESUME_VIDEO_MONTHLY_LIMITS.pro;
}

/** Quota snapshot from a count. Pure. */
export function quotaFrom(kind: VideoPlanKind, used: number, period = monthPeriod()): VideoQuota {
  const limit = videoLimitFor(kind);
  return { kind, limit, used, remaining: limit === null ? null : Math.max(0, limit - used), period };
}

export function isOverLimit(q: VideoQuota): boolean {
  return q.limit !== null && q.used >= q.limit;
}

/** The count this month. An unavailable counter store reads as 0 (fail open, logged) — same as the variants cap. */
export async function videoQuota(userId: string, kind: VideoPlanKind, now = new Date()): Promise<VideoQuota> {
  const period = monthPeriod(now);
  const used = await getCounter(userId, VIDEO_COUNTER_KIND, period);
  if (used === null) console.error("[video-quota] counter store unavailable for", userId);
  return quotaFrom(kind, used ?? 0, period);
}

/** Count one finished video. Call ONLY after the render succeeded. Admin runs are not counted. */
export async function recordVideoGenerated(userId: string, kind: VideoPlanKind, now = new Date()): Promise<number | null> {
  if (kind === "unlimited") return null;
  const n = await bumpCounter(userId, VIDEO_COUNTER_KIND, monthPeriod(now), 1);
  if (n === null) console.error("[video-quota] could not record video for", userId);
  return n;
}

/** The JSON body sent when a generation is refused. The page turns it into the localized message. */
export function limitReachedBody(q: VideoQuota) {
  return {
    error: "video_limit_reached" as const,
    kind: q.kind,
    limit: q.limit,
    used: q.used,
    period: q.period,
    // English fallback for API callers; the app shows its own localized text from kind + limit.
    message:
      q.kind === "lifetime"
        ? `You've used all ${q.limit} Resume Videos included with Pro Lifetime this month. Your allowance resets on the 1st.`
        : `You've used all ${q.limit} Resume Videos included with Pro this month. Your allowance resets on the 1st — or upgrade to Lifetime for ${RESUME_VIDEO_MONTHLY_LIMITS.proLifetime} a month.`,
  };
}
