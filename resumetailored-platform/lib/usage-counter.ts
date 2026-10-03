import { createClient, type SupabaseClient } from "@supabase/supabase-js";

/**
 * Monotonic usage counters (table `usage_counters`, migration 0043). Unlike a
 * COUNT over live rows, a counter can't be reset by deleting the rows it
 * counts. Best-effort: if Supabase or the table is unavailable, reads return
 * null and bumps return null so callers can choose their own fallback.
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

/** UTC calendar month key, e.g. "2026-10". */
export function monthPeriod(d = new Date()): string {
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}`;
}

/** Current value, or null when the counter store is unavailable. */
export async function getCounter(scopeId: string, kind: string, period: string): Promise<number | null> {
  const c = db();
  if (!c || !scopeId) return null;
  try {
    const { data, error } = await c
      .from("usage_counters")
      .select("count")
      .eq("scope_id", scopeId)
      .eq("kind", kind)
      .eq("period", period)
      .maybeSingle();
    if (error) return null;
    return data ? Number(data.count) || 0 : 0;
  } catch {
    return null;
  }
}

/** Atomically add `by` and return the new value, or null when unavailable. */
export async function bumpCounter(scopeId: string, kind: string, period: string, by = 1): Promise<number | null> {
  const c = db();
  if (!c || !scopeId) return null;
  try {
    const { data, error } = await c.rpc("bump_usage_counter", { p_scope: scopeId, p_kind: kind, p_period: period, p_by: by });
    if (error) return null;
    return typeof data === "number" ? data : Number(data) || 0;
  } catch {
    return null;
  }
}
