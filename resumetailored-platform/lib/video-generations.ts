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
): Promise<void> {
  const c = db();
  if (!c || !userId) return;
  try {
    await c.from("video_generations").insert({
      user_id: userId,
      title: (v.title || "Untitled video").slice(0, 200),
      script: v.script ?? null,
      video_url: v.videoUrl ?? null,
      template: v.template ?? null,
    });
  } catch {
    /* best-effort */
  }
}
