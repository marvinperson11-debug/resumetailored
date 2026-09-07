import { createClient, type SupabaseClient } from "@supabase/supabase-js";

/**
 * Server-side persistence for everything the tools generate — tailored resumes,
 * cover letters, and ATS scans — in a single Supabase table. This is the source
 * of truth for the dashboard's stat cards.
 *
 * Table (see supabase/migrations/0001_generations.sql):
 *   generations(id, user_id text, tool_type text, content jsonb, created_at timestamptz)
 *   user_id = the Clerk user id.
 *
 * Writes use the SERVICE ROLE key (server-only) so they bypass RLS — Clerk, not
 * Supabase Auth, owns identity here, so rows are scoped by the Clerk user_id we
 * pass, never by a Supabase session. Everything is best-effort: if Supabase
 * isn't configured or a call fails, we log and move on so a persistence hiccup
 * never blocks a generation or crashes the dashboard.
 */
export type ToolType = "resume" | "cover_letter" | "ats";

export interface GenerationStats {
  resumes: number;
  coverLetters: number;
  atsTotal: number;
  atsToday: number;
}

let cached: SupabaseClient | null = null;

function getServerSupabase(): SupabaseClient | null {
  if (cached) return cached;
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SERVICE_KEY;
  if (!url || !key) return null;
  cached = createClient(url, key, { auth: { persistSession: false } });
  return cached;
}

/** Persist one generation. Best-effort; never throws. */
export async function recordGeneration(userId: string, toolType: ToolType, content: unknown): Promise<void> {
  const db = getServerSupabase();
  if (!db || !userId) return;
  try {
    const { error } = await db.from("generations").insert({ user_id: userId, tool_type: toolType, content });
    if (error) console.warn("[generations] insert failed:", error.message);
  } catch (e) {
    console.warn("[generations] insert threw:", e instanceof Error ? e.message : e);
  }
}

/** Aggregate counts for the dashboard. Returns zeros if Supabase is unconfigured. */
export async function getGenerationStats(userId: string): Promise<GenerationStats> {
  const empty: GenerationStats = { resumes: 0, coverLetters: 0, atsTotal: 0, atsToday: 0 };
  const db = getServerSupabase();
  if (!db || !userId) return empty;
  try {
    const startOfDay = new Date();
    startOfDay.setHours(0, 0, 0, 0);
    const countFor = async (toolType: ToolType, sinceIso?: string) => {
      let q = db.from("generations").select("id", { count: "exact", head: true }).eq("user_id", userId).eq("tool_type", toolType);
      if (sinceIso) q = q.gte("created_at", sinceIso);
      const { count, error } = await q;
      if (error) throw error;
      return count || 0;
    };
    const [resumes, coverLetters, atsTotal, atsToday] = await Promise.all([
      countFor("resume"),
      countFor("cover_letter"),
      countFor("ats"),
      countFor("ats", startOfDay.toISOString()),
    ]);
    return { resumes, coverLetters, atsTotal, atsToday };
  } catch (e) {
    console.warn("[generations] stats failed:", e instanceof Error ? e.message : e);
    return empty;
  }
}
