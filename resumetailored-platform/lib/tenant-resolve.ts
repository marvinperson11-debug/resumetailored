import { createClient, type SupabaseClient } from "@supabase/supabase-js";

/**
 * Shared slug namespace for tenant subdomains. A slug lives in ONE global
 * namespace spanning employer career sites (`career_sites.slug`) and candidate
 * personal sites (`personal_sites.slug`) — a slug taken on either side is taken
 * everywhere. Server-only (service-role); imported by API routes and the two
 * stores, never by client code or middleware (middleware calls the
 * /api/tenant-resolve route instead).
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

export type TenantType = "career" | "site" | null;

/** Which kind of tenant owns this subdomain label — career site wins over a
 *  personal site if (somehow) both exist. `null` = unknown → careers 404. */
export async function resolveTenant(label: string): Promise<TenantType> {
  const c = db();
  if (!c || !label) return null;
  try {
    const { data: cs } = await c.from("career_sites").select("slug").eq("slug", label).limit(1);
    if (cs && cs.length) return "career";
    const { data: ps } = await c.from("personal_sites").select("slug").eq("slug", label).limit(1);
    if (ps && ps.length) return "site";
    return null;
  } catch {
    return null;
  }
}

/** Is `slug` already claimed by ANY career site or personal site — regardless of
 *  published state (reserved means reserved)? Pass the caller's own id to let
 *  them keep their current slug. Fails safe: on error, treats as taken so a
 *  glitch never hands out a colliding slug. */
export async function isSlugTaken(
  slug: string,
  exclude: { careerEmployerId?: string; personalUserId?: string } = {}
): Promise<boolean> {
  const c = db();
  if (!c || !slug) return true;
  try {
    const { data: cs } = await c.from("career_sites").select("employer_id").eq("slug", slug).limit(1);
    if (cs && cs.length && cs[0].employer_id !== exclude.careerEmployerId) return true;
    const { data: ps } = await c.from("personal_sites").select("user_id").eq("slug", slug).limit(1);
    if (ps && ps.length && ps[0].user_id !== exclude.personalUserId) return true;
    return false;
  } catch {
    return true;
  }
}
