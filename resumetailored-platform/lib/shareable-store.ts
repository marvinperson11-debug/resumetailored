import { createClient, type SupabaseClient } from "@supabase/supabase-js";

/**
 * Shareable Link (FREE) — one simple public profile per user at /u/<username>.
 * Stored in `shareable_profiles`, entirely separate from the Pro Website
 * Creator's `personal_sites`. Pure themes + validators live here so both the
 * public page and the dashboard editor can share them.
 */

export interface ContactInfo {
  email?: string;
  phone?: string;
  location?: string;
  linkedin?: string;
  website?: string;
}

export interface ShareableProfile {
  username: string;
  name: string;
  headline: string;
  photoUrl: string;
  bio: string;
  contact: ContactInfo;
  theme: string;
}

export interface ShareTheme {
  id: string;
  label: string;
  bg: string;
  panel: string;
  text: string;
  muted: string;
  accent: string;
  font: string;
  googleFont?: string;
}

/** The 5 basic themes free users can pick from. */
export const SHARE_THEMES: ShareTheme[] = [
  { id: "aurora", label: "Aurora", bg: "#0b0f19", panel: "#141a2b", text: "#e9ebf5", muted: "#9aa3c0", accent: "#8B5CF6", font: "'Inter',system-ui,sans-serif", googleFont: "Inter" },
  { id: "cream", label: "Cream", bg: "#faf7f0", panel: "#ffffff", text: "#20242e", muted: "#6b7280", accent: "#C2870B", font: "'Playfair Display',Georgia,serif", googleFont: "Playfair Display" },
  { id: "mint", label: "Mint", bg: "#f1faf6", panel: "#ffffff", text: "#12241c", muted: "#5b6b62", accent: "#059669", font: "'Poppins',sans-serif", googleFont: "Poppins" },
  { id: "rose", label: "Rose", bg: "#fff5f7", panel: "#ffffff", text: "#2a1620", muted: "#7a5b64", accent: "#E11D48", font: "'DM Sans',sans-serif", googleFont: "DM Sans" },
  { id: "slate", label: "Slate", bg: "#eef1f5", panel: "#ffffff", text: "#1a1f2b", muted: "#5b6472", accent: "#1E3A8A", font: "'Inter',system-ui,sans-serif", googleFont: "Inter" },
];
export function themeById(id: string): ShareTheme {
  return SHARE_THEMES.find((t) => t.id === id) || SHARE_THEMES[0];
}

const RESERVED = new Set([
  "api", "site", "u", "jobs", "candidate", "employer", "admin", "www", "app",
  "sign-in", "sign-up", "join", "about", "pricing", "blog", "help", "support", "settings",
]);

/** Normalize + validate a desired username. Returns null when invalid. */
export function cleanUsername(raw: string): string | null {
  const u = String(raw || "").toLowerCase().trim().replace(/[^a-z0-9-_]/g, "");
  if (u.length < 3 || u.length > 30) return null;
  if (RESERVED.has(u)) return null;
  return u;
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

interface Row {
  user_id: string; username: string; name: string; headline: string;
  photo_url: string | null; bio: string; contact_info: ContactInfo; theme: string;
}
function toProfile(r: Row): ShareableProfile {
  return {
    username: r.username, name: r.name || "", headline: r.headline || "",
    photoUrl: r.photo_url || "", bio: r.bio || "", contact: r.contact_info || {}, theme: r.theme || "aurora",
  };
}

/** The signed-in user's profile (for the dashboard editor). */
export async function getMyProfile(userId: string): Promise<ShareableProfile | null> {
  const c = db();
  if (!c || !userId) return null;
  try {
    const { data, error } = await c.from("shareable_profiles").select("*").eq("user_id", userId).maybeSingle();
    if (error || !data) return null;
    return toProfile(data as Row);
  } catch {
    return null;
  }
}

/** Public read for /u/<username> (case-insensitive). */
export async function getProfileByUsername(username: string): Promise<ShareableProfile | null> {
  const c = db();
  const u = String(username || "").toLowerCase();
  if (!c || !u) return null;
  try {
    const { data, error } = await c.from("shareable_profiles").select("*").ilike("username", u).maybeSingle();
    if (error || !data) return null;
    return toProfile(data as Row);
  } catch {
    return null;
  }
}

/** Is a username free for this user to take? */
export async function usernameAvailable(username: string, userId: string): Promise<boolean> {
  const c = db();
  if (!c) return false;
  try {
    const { data } = await c.from("shareable_profiles").select("user_id").ilike("username", username.toLowerCase()).maybeSingle();
    return !data || (data as { user_id: string }).user_id === userId;
  } catch {
    return false;
  }
}

export type SaveResult = { ok: true; profile: ShareableProfile } | { ok: false; error: "username_taken" | "invalid_username" | "db_unavailable" };

/** Create or update the user's shareable profile (username unique per platform). */
export async function upsertProfile(userId: string, input: Partial<ShareableProfile> & { username: string }): Promise<SaveResult> {
  const c = db();
  if (!c || !userId) return { ok: false, error: "db_unavailable" };
  const username = cleanUsername(input.username);
  if (!username) return { ok: false, error: "invalid_username" };
  if (!(await usernameAvailable(username, userId))) return { ok: false, error: "username_taken" };
  try {
    const row = {
      user_id: userId,
      username,
      name: (input.name || "").slice(0, 120),
      headline: (input.headline || "").slice(0, 160),
      photo_url: input.photoUrl || null,
      bio: (input.bio || "").slice(0, 2000),
      contact_info: input.contact || {},
      theme: SHARE_THEMES.some((t) => t.id === input.theme) ? input.theme : "aurora",
      updated_at: new Date().toISOString(),
    };
    const { error } = await c.from("shareable_profiles").upsert(row, { onConflict: "user_id" });
    if (error) {
      // A race on the unique index still surfaces as taken.
      if (/duplicate|unique/i.test(error.message)) return { ok: false, error: "username_taken" };
      return { ok: false, error: "db_unavailable" };
    }
    return { ok: true, profile: toProfile(row as unknown as Row) };
  } catch {
    return { ok: false, error: "db_unavailable" };
  }
}
