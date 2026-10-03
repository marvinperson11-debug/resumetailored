import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { cleanInstructions, CUSTOM_INSTRUCTIONS_MAX } from "./instructions";

/**
 * Custom writing instructions persistence (user_prefs, migration 0042).
 * Service-role client, scoped by Clerk user_id. Reads are best-effort: an
 * unconfigured Supabase, a missing table or any error yields "no instructions"
 * so tailoring never breaks. Writes report whether they actually persisted.
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

export async function getCustomInstructions(userId: string, max: number = CUSTOM_INSTRUCTIONS_MAX): Promise<{ instructions: string; updatedAt: string | null }> {
  const c = db();
  if (!c || !userId) return { instructions: "", updatedAt: null };
  try {
    const { data, error } = await c.from("user_prefs").select("custom_instructions, updated_at").eq("user_id", userId).maybeSingle();
    if (error || !data) return { instructions: "", updatedAt: null };
    return { instructions: cleanInstructions(data.custom_instructions, max), updatedAt: (data.updated_at as string) || null };
  } catch {
    return { instructions: "", updatedAt: null };
  }
}

export async function saveCustomInstructions(userId: string, instructions: string): Promise<{ ok: boolean; updatedAt: string | null }> {
  const c = db();
  if (!c || !userId) return { ok: false, updatedAt: null };
  const updatedAt = new Date().toISOString();
  try {
    const { error } = await c
      .from("user_prefs")
      .upsert({ user_id: userId, custom_instructions: instructions, updated_at: updatedAt }, { onConflict: "user_id" });
    if (error) {
      console.error("user_prefs save failed:", error.message);
      return { ok: false, updatedAt: null };
    }
    return { ok: true, updatedAt };
  } catch (e) {
    console.error("user_prefs save failed:", e instanceof Error ? e.message : e);
    return { ok: false, updatedAt: null };
  }
}
