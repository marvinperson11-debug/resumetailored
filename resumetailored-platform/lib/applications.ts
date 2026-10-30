import { createClient, type SupabaseClient } from "@supabase/supabase-js";

/**
 * LEGACY application list persistence (supabase/migrations/0004_applications.sql),
 * superseded by the Kanban tracker (lib/tracker-store.ts) — see
 * supabase/migrations/0081_migrate_legacy_applications.sql. Read-only from
 * app code now: only the list/read path remains here, for the one
 * surviving GET route (app/api/applications/route.ts).
 */
export const APPLICATION_STATUSES = [
  "Applied",
  "Phone Screen",
  "Interview",
  "Offer",
  "Rejected",
  "Ghosted",
  "Withdrawn",
] as const;
export type ApplicationStatus = (typeof APPLICATION_STATUSES)[number];

export interface Application {
  id: number;
  company: string;
  role: string;
  status: ApplicationStatus;
  contactName: string | null;
  contactEmail: string | null;
  salary: string | null;
  location: string | null;
  url: string | null;
  notes: string | null;
  resumeId: string | null;
  followUpDate: string | null; // YYYY-MM-DD
  appliedAt: string; // ISO
  updatedAt: string; // ISO
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

/* eslint-disable @typescript-eslint/no-explicit-any */
function fromRow(r: any): Application {
  return {
    id: r.id,
    company: r.company,
    role: r.role,
    status: r.status,
    contactName: r.contact_name ?? null,
    contactEmail: r.contact_email ?? null,
    salary: r.salary ?? null,
    location: r.location ?? null,
    url: r.url ?? null,
    notes: r.notes ?? null,
    resumeId: r.resume_id ?? null,
    followUpDate: r.follow_up_date ?? null,
    appliedAt: r.applied_at,
    updatedAt: r.updated_at,
  };
}
/* eslint-enable @typescript-eslint/no-explicit-any */

export async function listApplications(userId: string): Promise<Application[]> {
  const c = db();
  if (!c || !userId) return [];
  try {
    const { data, error } = await c
      .from("applications")
      .select("*")
      .eq("user_id", userId)
      .order("applied_at", { ascending: false })
      .limit(500);
    if (error || !data) return [];
    return data.map(fromRow);
  } catch {
    return [];
  }
}
