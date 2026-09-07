import { createClient, type SupabaseClient } from "@supabase/supabase-js";

/**
 * Saved jobs ("My Jobs") for the Job Finder, backed by the `job_saves` table
 * (supabase/migrations/0003_job_saves.sql). Service-role client, scoped by the
 * Clerk user_id. Best-effort: unconfigured Supabase → no-op saves, empty lists.
 */
export interface SavedJob {
  id: number;
  jobData: Record<string, unknown>;
  createdAt: string;
}

let cached: SupabaseClient | null = null;
function db(): SupabaseClient | null {
  if (cached) return cached;
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SERVICE_KEY;
  if (!url || !key) return null;
  cached = createClient(url, key, { auth: { persistSession: false } });
  return cached;
}

export async function saveJob(userId: string, jobData: Record<string, unknown>): Promise<boolean> {
  const c = db();
  if (!c || !userId) return false;
  try {
    const { error } = await c.from("job_saves").insert({ user_id: userId, job_data: jobData });
    return !error;
  } catch {
    return false;
  }
}

export async function listSavedJobs(userId: string): Promise<SavedJob[]> {
  const c = db();
  if (!c || !userId) return [];
  try {
    const { data, error } = await c
      .from("job_saves")
      .select("id, job_data, created_at")
      .eq("user_id", userId)
      .order("created_at", { ascending: false })
      .limit(100);
    if (error || !data) return [];
    return data.map((r) => ({ id: r.id as number, jobData: (r.job_data as Record<string, unknown>) || {}, createdAt: r.created_at as string }));
  } catch {
    return [];
  }
}

export async function deleteSavedJob(userId: string, id: number): Promise<boolean> {
  const c = db();
  if (!c || !userId) return false;
  try {
    const { error } = await c.from("job_saves").delete().eq("user_id", userId).eq("id", id);
    return !error;
  } catch {
    return false;
  }
}
