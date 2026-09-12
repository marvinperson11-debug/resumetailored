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

const RESERVED = new Set(["api", "site", "jobs", "candidate", "employer", "admin", "www", "app", "sign-in", "sign-up", "join"]);
function cleanSlug(s: string): string {
  return (s || "").toLowerCase().replace(/[^a-z0-9-]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 30);
}

/** Create or update the user's single published site. Returns its slug/url.
 *  `desiredSlug` lets the user pick a custom /site/<slug>; it's honored only
 *  when valid and not already taken by another user. */
export async function publishSite(
  userId: string,
  html: string,
  data: Record<string, unknown>,
  name: string,
  desiredSlug?: string
): Promise<{ slug: string } | null> {
  const c = db();
  if (!c || !userId) return null;
  try {
    const existing = await c.from("personal_sites").select("slug").eq("user_id", userId).maybeSingle();
    let slug = existing.data?.slug || slugify(name);

    const wanted = cleanSlug(desiredSlug || "");
    if (wanted && wanted.length >= 3 && wanted !== slug && !RESERVED.has(wanted)) {
      const taken = await c.from("personal_sites").select("user_id").eq("slug", wanted).maybeSingle();
      if (!taken.data || taken.data.user_id === userId) slug = wanted;
    }

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

/** Save the working draft without changing publish state. Creates an
 *  unpublished row for a first-time user (so /site/<slug> stays 404 until they
 *  explicitly publish) and updates in place afterwards, preserving `published`
 *  and `slug`. Used by the Web Studio editor's autosave. */
export async function saveSiteDraft(
  userId: string,
  html: string,
  data: Record<string, unknown>
): Promise<boolean> {
  const c = db();
  if (!c || !userId) return false;
  try {
    const existing = await c.from("personal_sites").select("slug").eq("user_id", userId).maybeSingle();
    const now = new Date().toISOString();
    if (existing.data?.slug) {
      const { error } = await c.from("personal_sites").update({ html, data, updated_at: now }).eq("user_id", userId);
      return !error;
    }
    const slug = slugify(String((data as { title?: string }).title || "site"));
    const { error } = await c.from("personal_sites").insert({ slug, user_id: userId, html, data, published: false, updated_at: now });
    return !error;
  } catch {
    return false;
  }
}

/** Increment the public view counter for a slug (best-effort, fire-and-forget). */
export async function incrementSiteViews(slug: string): Promise<void> {
  const c = db();
  if (!c || !slug) return;
  try {
    const { data } = await c.from("personal_sites").select("views").eq("slug", slug).maybeSingle();
    const next = ((data?.views as number) || 0) + 1;
    await c.from("personal_sites").update({ views: next }).eq("slug", slug);
  } catch {
    /* best-effort */
  }
}

/** The user's own published site (for the tool's "Update" state + prefill). */
export async function getUserSite(userId: string): Promise<{ slug: string; data: Record<string, unknown>; views: number; published: boolean } | null> {
  const c = db();
  if (!c || !userId) return null;
  try {
    const { data, error } = await c.from("personal_sites").select("slug, data, views, published").eq("user_id", userId).maybeSingle();
    if (error || !data) return null;
    return { slug: data.slug, data: data.data || {}, views: (data.views as number) || 0, published: data.published !== false };
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
