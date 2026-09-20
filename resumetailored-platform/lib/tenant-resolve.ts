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
 *  published state (reserved means reserved) — OR reserved by a rename alias
 *  (slug_aliases)? A renamed slug stays reserved so its 301 redirect keeps
 *  working and nobody else can re-claim it. Pass the caller's own id to let them
 *  keep their current slug (an alias is never the caller's own current slug, so
 *  it's always taken). Fails safe: on error, treats as taken so a glitch never
 *  hands out a colliding slug. */
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
    const { data: al } = await c.from("slug_aliases").select("id").eq("slug", slug).limit(1);
    if (al && al.length) return true;
    return false;
  } catch {
    return true;
  }
}

/** The current tenant a renamed (old) slug now points to. */
export interface AliasResolution {
  type: "career" | "site";
  slug: string;
}

/** If `label` is an old (renamed) slug, resolve it to the CURRENT tenant kind and
 *  slug it now belongs to — for a 301 redirect. Returns null when `label` isn't
 *  an alias, the target row is gone, or (defensively) the target still carries
 *  the same slug (nothing to redirect to). Fails soft. */
export async function resolveAlias(label: string): Promise<AliasResolution | null> {
  const c = db();
  if (!c || !label) return null;
  try {
    const { data: a } = await c
      .from("slug_aliases")
      .select("target_type, target_id")
      .eq("slug", label)
      .limit(1);
    if (!a || !a.length) return null;
    const type = a[0].target_type as "career" | "site";
    const targetId = a[0].target_id as number;
    const table = type === "career" ? "career_sites" : "personal_sites";
    const { data: rows } = await c.from(table).select("slug").eq("id", targetId).limit(1);
    if (!rows || !rows.length) return null;
    const slug = (rows[0] as { slug?: string }).slug || "";
    if (!slug || slug === label) return null;
    return { type, slug };
  } catch {
    return null;
  }
}

/** Record `oldSlug` as a permanent alias for the tenant identified by `targetId`,
 *  so its old URL keeps 301-redirecting to `newSlug`. Idempotent + best-effort:
 *  a no-op when the slug is empty or unchanged, and safe to call twice (upsert on
 *  the unique slug). Never throws — a rename must not fail because the alias
 *  couldn't be written. */
export async function recordSlugAlias(
  oldSlug: string | null | undefined,
  newSlug: string,
  targetType: "career" | "site",
  targetId: number | null | undefined
): Promise<void> {
  const c = db();
  if (!c || targetId == null) return;
  const from = (oldSlug || "").toLowerCase();
  if (!from || from === (newSlug || "").toLowerCase()) return;
  try {
    await c
      .from("slug_aliases")
      .upsert({ slug: from, target_type: targetType, target_id: targetId }, { onConflict: "slug" });
  } catch {
    /* best-effort — the redirect is a convenience, not a correctness invariant */
  }
}
