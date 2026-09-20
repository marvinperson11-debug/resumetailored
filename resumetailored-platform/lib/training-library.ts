import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { isLibraryKind, type TrainingLibraryItem, type LibraryKind } from "./employee-hub";

/**
 * Built-in Training Library — shared, read-only platform content sourced from
 * US-government public-domain channels. Not employer-scoped: the table has RLS
 * on with no policies (migration 0030), so it is reachable only through the
 * service-role key here. Best-effort like the other stores (empty reads when
 * Supabase is unconfigured/unreachable).
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

const COLS = "id, category, title, kind, provider, embed_url, body_html, source_url, created_at";

function mapItem(r: Record<string, unknown>): TrainingLibraryItem {
  return {
    id: r.id as number,
    category: (r.category as string) || "",
    title: (r.title as string) || "",
    kind: (isLibraryKind(r.kind) ? r.kind : "doc") as LibraryKind,
    provider: (r.provider as string) || "",
    embedUrl: (r.embed_url as string) || null,
    bodyHtml: (r.body_html as string) || null,
    sourceUrl: (r.source_url as string) || "",
    createdAt: (r.created_at as string) || "",
  };
}

/** List the library, optionally filtered by category and a free-text query
 *  (matched against title + provider, case-insensitive). */
export async function listLibrary(opts: { category?: string; q?: string } = {}): Promise<TrainingLibraryItem[]> {
  const c = db();
  if (!c) return [];
  try {
    let query = c.from("training_library_items").select(COLS).order("category", { ascending: true }).order("title", { ascending: true });
    if (opts.category && opts.category !== "all") query = query.eq("category", opts.category);
    const { data, error } = await query.limit(500);
    if (error || !data) return [];
    let items = data.map(mapItem);
    const q = (opts.q || "").trim().toLowerCase();
    if (q) items = items.filter((i) => i.title.toLowerCase().includes(q) || i.provider.toLowerCase().includes(q) || i.category.toLowerCase().includes(q));
    return items;
  } catch {
    return [];
  }
}

/** The distinct categories present, for the Library tab's filter. */
export async function listLibraryCategories(): Promise<string[]> {
  const items = await listLibrary();
  return Array.from(new Set(items.map((i) => i.category))).sort();
}

export async function getLibraryItem(id: number): Promise<TrainingLibraryItem | null> {
  const c = db();
  if (!c || !id) return null;
  try {
    const { data } = await c.from("training_library_items").select(COLS).eq("id", id).maybeSingle();
    return data ? mapItem(data) : null;
  } catch {
    return null;
  }
}

/**
 * Idempotently seed the library from `LIBRARY_SEED` (app code, not SQL). Upserts
 * on the `source_url` unique key with `ignoreDuplicates`, so existing rows are
 * left untouched and re-running is safe. Requires the `source_url` unique index
 * from migration 0030. Returns before/after counts so the caller can report how
 * many rows were added.
 */
export async function seedLibrary(): Promise<{ ok: boolean; before: number; after: number; inserted: number; error?: string }> {
  const c = db();
  if (!c) return { ok: false, before: 0, after: 0, inserted: 0, error: "Supabase service-role client is not configured." };
  const { LIBRARY_SEED } = await import("./training-library-seed");
  try {
    const before = (await c.from("training_library_items").select("id", { count: "exact", head: true })).count || 0;
    const rows = LIBRARY_SEED.map((i) => ({
      category: i.category,
      title: i.title,
      kind: i.kind,
      provider: i.provider,
      embed_url: i.embedUrl ?? null,
      body_html: i.bodyHtml ?? null,
      source_url: i.sourceUrl,
    }));
    const { error } = await c.from("training_library_items").upsert(rows, { onConflict: "source_url", ignoreDuplicates: true });
    if (error) return { ok: false, before, after: before, inserted: 0, error: error.message };
    const after = (await c.from("training_library_items").select("id", { count: "exact", head: true })).count || 0;
    return { ok: true, before, after, inserted: after - before };
  } catch (e) {
    return { ok: false, before: 0, after: 0, inserted: 0, error: e instanceof Error ? e.message : "unknown" };
  }
}
