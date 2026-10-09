import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { cleanVideoSettings, DEFAULT_VIDEO_SETTINGS, type VideoSettings } from "./video-settings";

/**
 * Resume Video settings persistence (user_prefs.video_settings, migration 0046). Service-role client scoped
 * by Clerk user_id. Reads are best-effort: unconfigured Supabase, a missing column or any error yields the
 * defaults, so the tool always opens. Writes report whether they actually persisted.
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

export async function getVideoSettings(userId: string): Promise<VideoSettings> {
  const c = db();
  if (!c || !userId) return { ...DEFAULT_VIDEO_SETTINGS };
  try {
    const { data, error } = await c.from("user_prefs").select("video_settings").eq("user_id", userId).maybeSingle();
    if (error || !data) return { ...DEFAULT_VIDEO_SETTINGS };
    return cleanVideoSettings(data.video_settings);
  } catch {
    return { ...DEFAULT_VIDEO_SETTINGS };
  }
}

export async function saveVideoSettings(userId: string, settings: VideoSettings): Promise<boolean> {
  const c = db();
  if (!c || !userId) return false;
  try {
    const { error } = await c
      .from("user_prefs")
      .upsert({ user_id: userId, video_settings: settings, updated_at: new Date().toISOString() }, { onConflict: "user_id" });
    if (error) {
      console.error("video settings save failed:", error.message);
      return false;
    }
    return true;
  } catch (e) {
    console.error("video settings save failed:", e instanceof Error ? e.message : e);
    return false;
  }
}
