import { createClient, type SupabaseClient } from "@supabase/supabase-js";

/**
 * Application Tracker persistence (supabase/migrations/0004_applications.sql).
 * Service-role client, scoped by the Clerk user_id. Best-effort: unconfigured
 * Supabase → empty lists / failed writes reported to the caller.
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

/** Fields a client may create/update. */
export interface ApplicationInput {
  company: string;
  role: string;
  status?: ApplicationStatus;
  contactName?: string | null;
  contactEmail?: string | null;
  salary?: string | null;
  location?: string | null;
  url?: string | null;
  notes?: string | null;
  resumeId?: string | null;
  followUpDate?: string | null;
  appliedAt?: string | null;
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

export function applicationsEnabled(): boolean {
  return db() !== null;
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

const clean = (s?: string | null) => {
  const v = (s ?? "").toString().trim();
  return v ? v.slice(0, 4000) : null;
};

function toRow(input: ApplicationInput): Record<string, unknown> {
  const row: Record<string, unknown> = {};
  if (input.company !== undefined) row.company = clean(input.company) || "";
  if (input.role !== undefined) row.role = clean(input.role) || "";
  if (input.status !== undefined) row.status = input.status;
  if (input.contactName !== undefined) row.contact_name = clean(input.contactName);
  if (input.contactEmail !== undefined) row.contact_email = clean(input.contactEmail);
  if (input.salary !== undefined) row.salary = clean(input.salary);
  if (input.location !== undefined) row.location = clean(input.location);
  if (input.url !== undefined) row.url = clean(input.url);
  if (input.notes !== undefined) row.notes = clean(input.notes);
  if (input.resumeId !== undefined) row.resume_id = clean(input.resumeId);
  if (input.followUpDate !== undefined) row.follow_up_date = input.followUpDate || null;
  if (input.appliedAt) row.applied_at = input.appliedAt;
  return row;
}

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

export async function createApplication(userId: string, input: ApplicationInput): Promise<Application | null> {
  const c = db();
  if (!c || !userId) return null;
  if (!clean(input.company) || !clean(input.role)) return null;
  try {
    const { data, error } = await c
      .from("applications")
      .insert({ user_id: userId, ...toRow(input) })
      .select("*")
      .single();
    if (error || !data) return null;
    return fromRow(data);
  } catch {
    return null;
  }
}

export async function updateApplication(userId: string, id: number, input: ApplicationInput): Promise<Application | null> {
  const c = db();
  if (!c || !userId) return null;
  try {
    const { data, error } = await c
      .from("applications")
      .update({ ...toRow(input), updated_at: new Date().toISOString() })
      .eq("user_id", userId)
      .eq("id", id)
      .select("*")
      .single();
    if (error || !data) return null;
    return fromRow(data);
  } catch {
    return null;
  }
}

export async function deleteApplication(userId: string, id: number): Promise<boolean> {
  const c = db();
  if (!c || !userId) return false;
  try {
    const { error } = await c.from("applications").delete().eq("user_id", userId).eq("id", id);
    return !error;
  } catch {
    return false;
  }
}
