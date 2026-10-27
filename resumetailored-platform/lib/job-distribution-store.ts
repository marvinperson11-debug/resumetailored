import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { randomBytes } from "node:crypto";
import type { DistributionChannels } from "./job-distribution";

/**
 * Persistence for Job Distribution (migration 0071_job_distribution.sql):
 * `employer_profiles.job_feed_token` (the Indeed feed's unguessable path
 * segment) and the `job_distribution` table (one row per job that has ever
 * had distribution approved). Same service-role-only, best-effort shape as
 * every other *-store.ts module in this codebase.
 */
// `cached` below is only the Supabase CLIENT instance (connection reuse), never
// a cache of query results — every function in this file re-reads its table on
// every call. Live data — never cache below this line; freshness is verified
// per deploy (see sitemap/feed liveness checklist). Audited 2026-10-26 while
// chasing a reported sitemap/Indeed-feed staleness gap: no unstable_cache,
// memoization, or module-level result cache lives in this file.
//
// LIVE ROUTE: see the matching comment in lib/employer-store.ts `db()` — the
// `global.fetch` override is the actual fix for the staleness gap this
// module was also implicated in (listIndeedFeedJobIds / listZipRecruiterFeedJobIds
// are on the feed routes' live path). A route-level `force-dynamic` does not
// reach a fetch this file doesn't call directly; this client issuing every
// one of its own requests with `cache: "no-store"` does.
let cached: SupabaseClient | null = null;
function db(): SupabaseClient | null {
  if (cached) return cached;
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SERVICE_KEY;
  if (!url || !key) return null;
  cached = createClient(url, key, {
    auth: { persistSession: false },
    global: { fetch: (input, init) => fetch(input, { ...init, cache: "no-store" }) },
  });
  return cached;
}

/** The employer's own Indeed feed token — generated the first time it's
 *  needed (distribute_job's first approval with indeedFeed on) and reused
 *  forever after, same opaque-token-on-an-existing-row shape as
 *  docusign_envelopes.sign_token. */
export async function ensureEmployerFeedToken(employerId: string): Promise<string | null> {
  const c = db();
  if (!c || !employerId) return null;
  try {
    const { data } = await c.from("employer_profiles").select("job_feed_token").eq("user_id", employerId).maybeSingle();
    const existing = (data as { job_feed_token?: string } | null)?.job_feed_token;
    if (existing) return existing;
    const token = randomBytes(24).toString("base64url");
    const { error } = await c.from("employer_profiles").update({ job_feed_token: token }).eq("user_id", employerId);
    if (error) {
      console.error("[job-distribution-store] ensureEmployerFeedToken failed", error);
      return null;
    }
    return token;
  } catch (e) {
    console.error("[job-distribution-store] ensureEmployerFeedToken threw", e);
    return null;
  }
}

/** Resolve an employer by their feed token — the Indeed feed route's only
 *  auth (a public, unguessable URL, like every other XML job feed). Null for
 *  an unknown/never-generated token. */
export async function getEmployerIdByFeedToken(token: string): Promise<string | null> {
  const c = db();
  if (!c || !token) return null;
  try {
    const { data, error } = await c.from("employer_profiles").select("user_id").eq("job_feed_token", token).maybeSingle();
    if (error) throw error;
    return (data as { user_id?: string } | null)?.user_id || null;
  } catch (e) {
    // Silent-fallback class, closed: a real query error used to resolve to
    // null exactly like "unknown token" (404), with no log line — the feed
    // routes now let this propagate so they can answer 503 instead of
    // silently rendering as if the token never existed.
    console.error("[job-distribution-store] getEmployerIdByFeedToken failed", token, e);
    throw e;
  }
}

export interface DistributionRow {
  jobId: number;
  employerId: string;
  channels: DistributionChannels;
  status: string;
  actorUserId: string | null;
  actorEmail: string | null;
  updatedAt: string;
}

function mapRow(r: Record<string, unknown>): DistributionRow {
  return {
    jobId: r.job_id as number,
    employerId: (r.employer_id as string) || "",
    channels: (r.channels as DistributionChannels) || {},
    status: (r.status as string) || "none",
    actorUserId: (r.actor_user_id as string) || null,
    actorEmail: (r.actor_email as string) || null,
    updatedAt: (r.updated_at as string) || "",
  };
}

/** Ownership-scoped — a job_distribution row for a different employer's job
 *  (should never happen, since job_id is only ever written by this
 *  employer's own approved mutation) comes back null exactly like "no row
 *  yet", never a cross-tenant leak. */
export async function getDistribution(employerId: string, jobId: number): Promise<DistributionRow | null> {
  const c = db();
  if (!c || !employerId || !Number.isFinite(jobId)) return null;
  try {
    const { data } = await c.from("job_distribution").select("*").eq("job_id", jobId).eq("employer_id", employerId).maybeSingle();
    return data ? mapRow(data as Record<string, unknown>) : null;
  } catch {
    return null;
  }
}

/** Upsert the one row for this job (job_id is the table's primary key — a
 *  job is distributed or it isn't, there's nothing to version). */
export async function upsertDistribution(
  employerId: string,
  jobId: number,
  channels: DistributionChannels,
  actorUserId: string,
  actorEmail: string | null
): Promise<DistributionRow | null> {
  const c = db();
  if (!c || !employerId || !Number.isFinite(jobId)) return null;
  try {
    const { data, error } = await c
      .from("job_distribution")
      .upsert(
        { job_id: jobId, employer_id: employerId, channels, status: "approved", actor_user_id: actorUserId, actor_email: actorEmail, updated_at: new Date().toISOString() },
        { onConflict: "job_id" }
      )
      .select("*")
      .single();
    if (error || !data) {
      console.error("[job-distribution-store] upsertDistribution failed", error);
      return null;
    }
    return mapRow(data as Record<string, unknown>);
  } catch (e) {
    console.error("[job-distribution-store] upsertDistribution threw", e);
    return null;
  }
}

/** Every job_id this employer has ever turned the Indeed feed on for,
 *  regardless of whether that job is STILL currently public — the feed route
 *  itself re-checks public/active server-side, per id, via
 *  lib/employer-store.ts `getLivePublicJob` (the same status+public_listed
 *  predicate the sitemap and public job page use), so a job closed after
 *  being feed-enabled simply drops out of the rendered feed rather than
 *  needing a second write here. */
export async function listIndeedFeedJobIds(employerId: string): Promise<number[]> {
  const c = db();
  if (!c || !employerId) return [];
  try {
    const { data, error } = await c.from("job_distribution").select("job_id, channels").eq("employer_id", employerId);
    if (error) throw error;
    return ((data as Record<string, unknown>[]) || []).filter((r) => !!(r.channels as DistributionChannels)?.indeedFeed?.enabled).map((r) => r.job_id as number);
  } catch (e) {
    // Silent-fallback class, closed: see getEmployerIdByFeedToken above —
    // a real query error must not read as "this employer distributes no
    // jobs", which a 200 empty feed would otherwise claim.
    console.error("[listIndeedFeedJobIds] query failed", employerId, e);
    throw e;
  }
}

/** Sibling of listIndeedFeedJobIds for the ZipRecruiter channel — same
 *  reasoning: every job_id this employer has ever turned the ZipRecruiter
 *  feed on for, regardless of whether it's STILL currently public (the
 *  ZipRecruiter feed route re-checks that itself). */
export async function listZipRecruiterFeedJobIds(employerId: string): Promise<number[]> {
  const c = db();
  if (!c || !employerId) return [];
  try {
    const { data, error } = await c.from("job_distribution").select("job_id, channels").eq("employer_id", employerId);
    if (error) throw error;
    return ((data as Record<string, unknown>[]) || []).filter((r) => !!(r.channels as DistributionChannels)?.zipRecruiter?.enabled).map((r) => r.job_id as number);
  } catch (e) {
    // Silent-fallback class, closed: same reasoning as listIndeedFeedJobIds.
    console.error("[listZipRecruiterFeedJobIds] query failed", employerId, e);
    throw e;
  }
}
