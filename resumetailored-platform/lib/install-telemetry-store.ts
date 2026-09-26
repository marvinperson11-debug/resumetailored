import { createClient, type SupabaseClient } from "@supabase/supabase-js";

/** App-install telemetry — not employer-scoped (an install can come from any
 *  side), service-role only, best-effort. */
let cached: SupabaseClient | null = null;
function db(): SupabaseClient | null {
  if (cached) return cached;
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SERVICE_KEY;
  if (!url || !key) return null;
  cached = createClient(url, key, { auth: { persistSession: false } });
  return cached;
}

export interface InstallEvent {
  userId?: string | null;
  email?: string | null;
  platform: string;
  userAgent?: string | null;
}

export async function logInstall(input: InstallEvent): Promise<void> {
  const c = db();
  if (!c) return;
  try {
    await c.from("app_installs").insert({
      user_id: input.userId || null,
      email: input.email || null,
      platform: (input.platform || "unknown").slice(0, 50),
      user_agent: (input.userAgent || "").slice(0, 500) || null,
    });
  } catch (e) {
    console.error("[logInstall]", e);
  }
}
