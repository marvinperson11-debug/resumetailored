import { createClient, type SupabaseClient } from "@supabase/supabase-js";

/**
 * Saved jobs ("My Jobs") for the Job Finder, backed by the `job_saves` table
 * (0003 + 0009 status/notes). Service-role client, scoped by the Clerk user_id.
 * Best-effort: unconfigured Supabase → no-op saves, empty lists.
 */
export const JOB_STATUSES = ["saved", "applied", "interview", "offer", "rejected"] as const;
export type JobStatus = (typeof JOB_STATUSES)[number];
export function isJobStatus(v: unknown): v is JobStatus {
  return (JOB_STATUSES as readonly string[]).includes(String(v));
}

export interface SavedJob {
  id: number;
  jobData: Record<string, unknown>;
  status: JobStatus;
  notes: string | null;
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
    const { error } = await c.from("job_saves").insert({ user_id: userId, job_data: jobData, status: "saved" });
    return !error;
  } catch {
    return false;
  }
}

export async function listSavedJobs(userId: string): Promise<SavedJob[]> {
  const c = db();
  if (!c || !userId) return [];
  try {
    // Select status/notes when present; fall back gracefully if the columns
    // don't exist yet (0009 not run) by retrying with the base columns.
    let rows: Record<string, unknown>[] | null = null;
    const full = await c
      .from("job_saves")
      .select("id, job_data, status, notes, created_at")
      .eq("user_id", userId)
      .order("created_at", { ascending: false })
      .limit(200);
    if (full.error) {
      const base = await c.from("job_saves").select("id, job_data, created_at").eq("user_id", userId).order("created_at", { ascending: false }).limit(200);
      rows = base.error ? [] : base.data;
    } else {
      rows = full.data;
    }
    return (rows || []).map((r) => ({
      id: r.id as number,
      jobData: (r.job_data as Record<string, unknown>) || {},
      status: isJobStatus(r.status) ? (r.status as JobStatus) : "saved",
      notes: (r.notes as string) ?? null,
      createdAt: r.created_at as string,
    }));
  } catch {
    return [];
  }
}

export async function updateJobStatus(userId: string, id: number, status: JobStatus, notes?: string): Promise<boolean> {
  const c = db();
  if (!c || !userId) return false;
  try {
    const patch: Record<string, unknown> = { status, updated_at: new Date().toISOString() };
    if (typeof notes === "string") patch.notes = notes.slice(0, 4000);
    const { error } = await c.from("job_saves").update(patch).eq("user_id", userId).eq("id", id);
    return !error;
  } catch {
    return false;
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
