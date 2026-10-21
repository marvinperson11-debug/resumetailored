import { createClient, type SupabaseClient } from "@supabase/supabase-js";

/**
 * Per-employer state for the Employer Portal AI Assistant's daily morning
 * brief (assistant_brief_state, migration 0057). One row per employer;
 * `lastBriefAt` is the single source of truth for "has today's brief already
 * gone out" — lib/assistant-brief.ts sets it BEFORE attempting the brief's
 * LLM call, not after, so a slow/failing brief can't retry-storm the same
 * employer within one day (see that migration's comment).
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

export interface BriefStateRow {
  employerId: string;
  lastBriefAt: string | null;
  briefHour: number;
}

function mapRow(r: Record<string, unknown>): BriefStateRow {
  return {
    employerId: (r.employer_id as string) || "",
    lastBriefAt: (r.last_brief_at as string) ?? null,
    briefHour: typeof r.brief_hour === "number" ? (r.brief_hour as number) : 7,
  };
}

/** Brief state for several employers at once, keyed by employerId. An
 *  employer with no row yet simply isn't in the map — the caller defaults it
 *  to "never briefed, brief_hour 7" (never been due before, which is exactly
 *  correct for a brand-new employer). */
export async function getBriefStates(employerIds: string[]): Promise<Map<string, BriefStateRow>> {
  const map = new Map<string, BriefStateRow>();
  const c = db();
  if (!c || !employerIds.length) return map;
  try {
    const { data, error } = await c.from("assistant_brief_state").select("employer_id, last_brief_at, brief_hour").in("employer_id", employerIds);
    if (error || !data) return map;
    for (const r of data) {
      const row = mapRow(r);
      map.set(row.employerId, row);
    }
  } catch (e) {
    console.error("[assistant-brief-store] getBriefStates threw", e);
  }
  return map;
}

/** Stamp `last_brief_at`, creating the row on first use. Deliberately a
 *  manual select-then-update-or-insert (not `.upsert`) — plain,
 *  unambiguous primitives rather than relying on onConflict semantics for a
 *  table this small and infrequently written. */
export async function setLastBriefAt(employerId: string, iso: string): Promise<boolean> {
  const c = db();
  if (!c || !employerId) return false;
  try {
    const { data: existing } = await c.from("assistant_brief_state").select("employer_id").eq("employer_id", employerId).maybeSingle();
    if (existing) {
      const { error } = await c.from("assistant_brief_state").update({ last_brief_at: iso }).eq("employer_id", employerId);
      return !error;
    }
    const { error } = await c.from("assistant_brief_state").insert({ employer_id: employerId, last_brief_at: iso, brief_hour: 7 });
    return !error;
  } catch (e) {
    console.error("[assistant-brief-store] setLastBriefAt threw", { employerId, error: e });
    return false;
  }
}
