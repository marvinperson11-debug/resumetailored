import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import type { ResumeDraft, ResumeDraftContent } from "./draft-types";

/**
 * Server-side persistence for saved resumes / version history (FIX 7 #6/#7,
 * FIX 8), backed by the `resume_drafts` table (see
 * supabase/migrations/0002_resume_drafts.sql). Uses the service-role key so it
 * bypasses RLS; every row is scoped by the Clerk user_id we pass. Best-effort:
 * if Supabase isn't configured, saves become no-ops and lists come back empty,
 * so a persistence hiccup never breaks the builder.
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

/** True when Supabase persistence is available. */
export function draftsEnabled(): boolean {
  return db() !== null;
}

/** Insert or update one draft (upsert on the (user_id, id) primary key). */
export async function saveDraft(
  userId: string,
  id: string,
  title: string,
  content: ResumeDraftContent
): Promise<{ ok: boolean; error?: string }> {
  const client = db();
  if (!client || !userId || !id) return { ok: false, error: "not_configured" };
  try {
    const { error } = await client
      .from("resume_drafts")
      .upsert(
        { id, user_id: userId, title: title.slice(0, 200) || "Untitled resume", content, updated_at: new Date().toISOString() },
        { onConflict: "user_id,id" }
      );
    if (error) return { ok: false, error: error.message };
    return { ok: true };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "save_failed" };
  }
}

/** List a user's saved resumes, newest first. */
export async function listDrafts(userId: string): Promise<ResumeDraft[]> {
  const client = db();
  if (!client || !userId) return [];
  try {
    const { data, error } = await client
      .from("resume_drafts")
      .select("id, title, content, updated_at")
      .eq("user_id", userId)
      .order("updated_at", { ascending: false })
      .limit(100);
    if (error || !data) return [];
    return data.map((r) => ({
      id: r.id as string,
      title: (r.title as string) || "Untitled resume",
      updatedAt: r.updated_at as string,
      content: (r.content as ResumeDraftContent) || ({} as ResumeDraftContent),
    }));
  } catch {
    return [];
  }
}

/** Delete one draft. */
export async function deleteDraft(userId: string, id: string): Promise<boolean> {
  const client = db();
  if (!client || !userId || !id) return false;
  try {
    const { error } = await client.from("resume_drafts").delete().eq("user_id", userId).eq("id", id);
    return !error;
  } catch {
    return false;
  }
}
