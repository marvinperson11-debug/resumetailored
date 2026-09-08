import { createClient, type SupabaseClient } from "@supabase/supabase-js";

/** Best-effort persistence for Resume Video generations (video_generations). */
let cached: SupabaseClient | null = null;
function db(): SupabaseClient | null {
  if (cached) return cached;
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SERVICE_KEY;
  if (!url || !key) return null;
  cached = createClient(url, key, { auth: { persistSession: false } });
  return cached;
}

export async function saveVideoGeneration(
  userId: string,
  v: { title?: string; script?: string; videoUrl?: string; template?: string }
): Promise<number | null> {
  const c = db();
  if (!c || !userId) return null;
  try {
    const { data } = await c
      .from("video_generations")
      .insert({
        user_id: userId,
        title: (v.title || "Untitled video").slice(0, 200),
        script: v.script ?? null,
        video_url: v.videoUrl ?? null,
        template: v.template ?? null,
      })
      .select("id")
      .single();
    const id = (data as { id?: number } | null)?.id;
    return typeof id === "number" ? id : null;
  } catch {
    /* best-effort */
    return null;
  }
}

export interface VideoGenerationRow {
  id: number;
  title: string;
  videoUrl: string;
  createdAt: string | null;
}

/** List a user's generated videos that have a saved public URL (newest first). */
export async function listVideoGenerations(userId: string): Promise<VideoGenerationRow[]> {
  const c = db();
  if (!c || !userId) return [];
  try {
    const { data, error } = await c
      .from("video_generations")
      .select("id, title, video_url, created_at")
      .eq("user_id", userId)
      .not("video_url", "is", null)
      .order("created_at", { ascending: false })
      .limit(50);
    if (error || !data) return [];
    return (data as { id: number; title: string | null; video_url: string | null; created_at: string | null }[])
      .filter((r) => !!r.video_url)
      .map((r) => ({ id: r.id, title: r.title || "Resume video", videoUrl: r.video_url as string, createdAt: r.created_at }));
  } catch {
    return [];
  }
}
