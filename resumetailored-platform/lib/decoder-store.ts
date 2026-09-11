import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import type { Depth } from "./decoder-ai";

/** Decoder Key persistence (decoder_analyses) + the free daily-usage counter. */
let cached: SupabaseClient | null = null;
function db(): SupabaseClient | null {
  if (cached) return cached;
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SERVICE_KEY;
  if (!url || !key) return null;
  cached = createClient(url, key, { auth: { persistSession: false } });
  return cached;
}

export async function saveDecoderAnalysis(userId: string, v: { jobTitle?: string; company?: string; jobDescription?: string; depth: Depth; analysis: unknown }): Promise<void> {
  const c = db();
  if (!c || !userId) return;
  try {
    await c.from("decoder_analyses").insert({
      user_id: userId,
      job_title: (v.jobTitle || "").slice(0, 200) || null,
      company: (v.company || "").slice(0, 200) || null,
      job_description: (v.jobDescription || "").slice(0, 12000) || null,
      depth: v.depth,
      analysis: v.analysis ?? {},
    });
  } catch { /* best-effort */ }
}

/** How many decodes the user has run since UTC midnight (for the free 1/day cap).
 *  Best-effort: if the table/DB is unavailable it returns 0 so decoding is never
 *  hard-blocked by a missing table. */
export async function decodesToday(userId: string): Promise<number> {
  const c = db();
  if (!c || !userId) return 0;
  try {
    const since = new Date(); since.setUTCHours(0, 0, 0, 0);
    const { count } = await c.from("decoder_analyses").select("id", { count: "exact", head: true }).eq("user_id", userId).gte("created_at", since.toISOString());
    return count || 0;
  } catch { return 0; }
}
