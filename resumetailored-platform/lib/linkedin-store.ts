import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import type { LinkedinSuggestion } from "./linkedin-ai";

/** Best-effort persistence for LinkedIn analyses (linkedin_analyses). */
let cached: SupabaseClient | null = null;
function db(): SupabaseClient | null {
  if (cached) return cached;
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SERVICE_KEY;
  if (!url || !key) return null;
  cached = createClient(url, key, { auth: { persistSession: false } });
  return cached;
}

export async function saveLinkedinAnalysis(
  userId: string,
  v: { profileText?: string; score: number; suggestions: LinkedinSuggestion[] }
): Promise<void> {
  const c = db();
  if (!c || !userId) return;
  try {
    await c.from("linkedin_analyses").insert({
      user_id: userId,
      profile_text: (v.profileText || "").slice(0, 20000) || null,
      score: Math.max(0, Math.min(100, Math.round(v.score || 0))),
      suggestions: v.suggestions ?? [],
    });
  } catch {
    /* best-effort */
  }
}
