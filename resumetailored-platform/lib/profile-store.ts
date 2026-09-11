import { createClient, type SupabaseClient } from "@supabase/supabase-js";

/**
 * Candidate profile + settings persistence (user_profiles). Service-role client,
 * scoped by Clerk user_id. Best-effort: an unconfigured/unreachable Supabase
 * yields defaults on read and false on write, never a throw.
 */
export interface UserProfile {
  phone: string;
  location: string;
  linkedinUrl: string;
  websiteUrl: string;
  bio: string;
  profilePublic: boolean;
  emailProduct: boolean;
  emailTips: boolean;
}

export const DEFAULT_PROFILE: UserProfile = {
  phone: "",
  location: "",
  linkedinUrl: "",
  websiteUrl: "",
  bio: "",
  profilePublic: false,
  emailProduct: true,
  emailTips: true,
};

let cached: SupabaseClient | null = null;
function db(): SupabaseClient | null {
  if (cached) return cached;
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SERVICE_KEY;
  if (!url || !key) return null;
  cached = createClient(url, key, { auth: { persistSession: false } });
  return cached;
}

export async function getUserProfile(userId: string): Promise<UserProfile> {
  const c = db();
  if (!c || !userId) return { ...DEFAULT_PROFILE };
  try {
    const { data } = await c
      .from("user_profiles")
      .select("phone, location, linkedin_url, website_url, bio, profile_public, email_product, email_tips")
      .eq("user_id", userId)
      .maybeSingle();
    if (!data) return { ...DEFAULT_PROFILE };
    return {
      phone: (data.phone as string) || "",
      location: (data.location as string) || "",
      linkedinUrl: (data.linkedin_url as string) || "",
      websiteUrl: (data.website_url as string) || "",
      bio: (data.bio as string) || "",
      profilePublic: !!data.profile_public,
      emailProduct: data.email_product !== false,
      emailTips: data.email_tips !== false,
    };
  } catch {
    return { ...DEFAULT_PROFILE };
  }
}

export async function saveUserProfile(userId: string, patch: Partial<UserProfile>): Promise<boolean> {
  const c = db();
  if (!c || !userId) return false;
  const row: Record<string, unknown> = { user_id: userId, updated_at: new Date().toISOString() };
  if (patch.phone !== undefined) row.phone = patch.phone.slice(0, 60) || null;
  if (patch.location !== undefined) row.location = patch.location.slice(0, 160) || null;
  if (patch.linkedinUrl !== undefined) row.linkedin_url = patch.linkedinUrl.slice(0, 400) || null;
  if (patch.websiteUrl !== undefined) row.website_url = patch.websiteUrl.slice(0, 400) || null;
  if (patch.bio !== undefined) row.bio = patch.bio.slice(0, 2000) || null;
  if (patch.profilePublic !== undefined) row.profile_public = patch.profilePublic;
  if (patch.emailProduct !== undefined) row.email_product = patch.emailProduct;
  if (patch.emailTips !== undefined) row.email_tips = patch.emailTips;
  try {
    const { error } = await c.from("user_profiles").upsert(row, { onConflict: "user_id" });
    return !error;
  } catch {
    return false;
  }
}
