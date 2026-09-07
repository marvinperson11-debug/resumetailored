import { createClient, type SupabaseClient } from "@supabase/supabase-js";

/**
 * Published personal sites (personal_sites). One published site per user
 * (upsert on user_id); served publicly at /site/<slug>.
 */
export interface StoredSite {
  slug: string;
  html: string;
  data: Record<string, unknown>;
  updatedAt: string;
}

let cached: SupabaseClient | null = null;
function db(): SupabaseClient | null {
  if (cached) return cached;
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SERVICE_KEY;
  if (!url || !key) return null;
  cached = createClient(url, key, { auth: { persistSession: false } });
  return cached;
}

function slugify(name: string): string {
  const base = (name || "site").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 30) || "site";
  return `${base}-${Math.random().toString(36).slice(2, 7)}`;
}

/** Create or update the user's single published site. Returns its slug/url. */
export async function publishSite(
  userId: string,
  html: string,
  data: Record<string, unknown>,
  name: string
): Promise<{ slug: string } | null> {
  const c = db();
  if (!c || !userId) return null;
  try {
    const existing = await c.from("personal_sites").select("slug").eq("user_id", userId).maybeSingle();
    const slug = existing.data?.slug || slugify(name);
    const { error } = await c.from("personal_sites").upsert(
      { slug, user_id: userId, html, data, published: true, updated_at: new Date().toISOString() },
      { onConflict: "user_id" }
    );
    if (error) return null;
    return { slug };
  } catch {
    return null;
  }
}

/** Public read for the /site/<slug> page. */
export async function getSiteBySlug(slug: string): Promise<StoredSite | null> {
  const c = db();
  if (!c) return null;
  try {
    const { data, error } = await c.from("personal_sites").select("slug, html, data, updated_at, published").eq("slug", slug).maybeSingle();
    if (error || !data || !data.published) return null;
    return { slug: data.slug, html: data.html, data: data.data || {}, updatedAt: data.updated_at };
  } catch {
    return null;
  }
}
