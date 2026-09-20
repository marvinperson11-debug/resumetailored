import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import type { Announcement } from "./employee-hub";

/**
 * Employer announcements. The employer broadcasts a note; pinned + active
 * announcements surface on every invited employee's portal home. Same
 * service-role + employer_id-scoped pattern as the other employer stores;
 * best-effort (unconfigured/unreachable Supabase resolves to empty reads / null
 * writes, never a throw).
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

const COLS = "id, title, body, pinned, active, created_at";

function mapAnnouncement(r: Record<string, unknown>): Announcement {
  return {
    id: r.id as number,
    title: (r.title as string) || "",
    body: (r.body as string) || "",
    pinned: r.pinned !== false,
    active: r.active !== false,
    createdAt: (r.created_at as string) || "",
  };
}

/** All announcements for the employer's management view (active + retired). */
export async function listAnnouncements(employerId: string): Promise<Announcement[]> {
  const c = db();
  if (!c || !employerId) return [];
  try {
    const { data, error } = await c
      .from("announcements")
      .select(COLS)
      .eq("employer_id", employerId)
      .order("created_at", { ascending: false })
      .limit(500);
    if (error || !data) return [];
    return data.map(mapAnnouncement);
  } catch {
    return [];
  }
}

/** Active announcements shown on an employee's portal home, pinned first. */
export async function listActiveAnnouncements(employerId: string): Promise<Announcement[]> {
  const rows = await listAnnouncements(employerId);
  return rows
    .filter((a) => a.active)
    .sort((a, b) => (a.pinned === b.pinned ? (a.createdAt < b.createdAt ? 1 : -1) : a.pinned ? -1 : 1));
}

export async function createAnnouncement(
  employerId: string,
  v: { title: string; body?: string; pinned?: boolean; createdBy?: string }
): Promise<Announcement | null> {
  const c = db();
  if (!c || !employerId) return null;
  const title = (v.title || "").trim().slice(0, 200);
  if (!title) return null;
  try {
    const { data, error } = await c
      .from("announcements")
      .insert({
        employer_id: employerId,
        title,
        body: (v.body || "").trim().slice(0, 8000),
        pinned: v.pinned !== false,
        created_by: v.createdBy || null,
      })
      .select(COLS)
      .single();
    if (error || !data) {
      console.error("[createAnnouncement]", error);
      return null;
    }
    return mapAnnouncement(data);
  } catch (e) {
    console.error("[createAnnouncement]", e);
    return null;
  }
}

export async function updateAnnouncement(
  employerId: string,
  id: number,
  v: { title?: string; body?: string; pinned?: boolean; active?: boolean }
): Promise<Announcement | null> {
  const c = db();
  if (!c || !employerId || !id) return null;
  const row: Record<string, unknown> = {};
  if (v.title !== undefined) row.title = (v.title || "").trim().slice(0, 200);
  if (v.body !== undefined) row.body = (v.body || "").trim().slice(0, 8000);
  if (v.pinned !== undefined) row.pinned = !!v.pinned;
  if (v.active !== undefined) row.active = !!v.active;
  if (!Object.keys(row).length) return null;
  try {
    const { data, error } = await c.from("announcements").update(row).eq("employer_id", employerId).eq("id", id).select(COLS).single();
    if (error || !data) return null;
    return mapAnnouncement(data);
  } catch {
    return null;
  }
}

export async function deleteAnnouncement(employerId: string, id: number): Promise<boolean> {
  const c = db();
  if (!c || !employerId || !id) return false;
  try {
    const { error } = await c.from("announcements").delete().eq("employer_id", employerId).eq("id", id);
    return !error;
  } catch {
    return false;
  }
}
