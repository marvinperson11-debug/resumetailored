import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import type { CareerSite, Testimonial, PublicCareerJob, RemoteType, EmploymentType } from "./employer-ai";

/**
 * Career Site Builder persistence — one `career_sites` row per employer, served
 * publicly at /careers/:slug. Same contract as employer-store.ts: one
 * service-role client, owner writes scoped by employer_id, and a public
 * read-by-slug that returns only public-safe fields. Best-effort: an
 * unconfigured client throws the permanent config error; everything else
 * fails soft.
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

const COLS =
  "id, employer_id, company_name, slug, logo_url, banner_url, brand_color, about_text, mission_text, values_text, show_about, show_benefits, show_team, show_testimonials, show_contact, benefits, testimonials, contact_email, created_at, updated_at";

const HEX_RE = /^#[0-9a-fA-F]{6}$/;

function strList(v: unknown, max = 30): string[] {
  return Array.isArray(v) ? v.map((x) => String(x).trim()).filter(Boolean).slice(0, max) : [];
}

function testimonialList(v: unknown): Testimonial[] {
  if (!Array.isArray(v)) return [];
  const out: Testimonial[] = [];
  for (const t of v.slice(0, 20)) {
    if (!t || typeof t !== "object") continue;
    const r = t as Record<string, unknown>;
    const quote = String(r.quote || "").trim().slice(0, 600);
    const author = String(r.author || "").trim().slice(0, 120);
    if (!quote || !author) continue;
    const role = String(r.role || "").trim().slice(0, 120);
    out.push(role ? { quote, author, role } : { quote, author });
  }
  return out;
}

function mapSite(r: Record<string, unknown>): CareerSite {
  return {
    id: r.id as number,
    companyName: (r.company_name as string) || "",
    slug: (r.slug as string) || "",
    logoUrl: (r.logo_url as string) || "",
    bannerUrl: (r.banner_url as string) || "",
    brandColor: (r.brand_color as string) || "#F59E0B",
    aboutText: (r.about_text as string) || "",
    missionText: (r.mission_text as string) || "",
    valuesText: (r.values_text as string) || "",
    showAbout: r.show_about !== false,
    showBenefits: r.show_benefits !== false,
    showTeam: !!r.show_team,
    showTestimonials: !!r.show_testimonials,
    showContact: r.show_contact !== false,
    benefits: strList(r.benefits),
    testimonials: testimonialList(r.testimonials),
    contactEmail: (r.contact_email as string) || "",
    createdAt: (r.created_at as string) || "",
    updatedAt: (r.updated_at as string) || "",
  };
}

function slugify(name: string): string {
  return (name || "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 40);
}

/** Pick a slug not already taken, appending -2, -3, … on conflict. */
async function uniqueSlug(c: SupabaseClient, base: string): Promise<string> {
  const root = base || "company";
  for (let i = 1; i < 50; i++) {
    const candidate = i === 1 ? root : `${root}-${i}`;
    const { data } = await c.from("career_sites").select("id").eq("slug", candidate).maybeSingle();
    if (!data) return candidate;
  }
  return `${root}-${Date.now().toString(36)}`;
}

/** Get this employer's career site, creating a default row on first access. */
export async function getCareerSite(employerId: string, companyName = ""): Promise<CareerSite | null> {
  const c = db();
  if (!c) throw new Error("Supabase client not configured (check NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY).");
  if (!employerId) return null;
  try {
    const { data } = await c.from("career_sites").select(COLS).eq("employer_id", employerId).maybeSingle();
    if (data) return mapSite(data);
    // First access — create a default row.
    const slug = await uniqueSlug(c, slugify(companyName) || slugify(employerId) || "company");
    const { data: created, error } = await c
      .from("career_sites")
      .insert({ employer_id: employerId, company_name: companyName || "", slug })
      .select(COLS)
      .single();
    if (error || !created) {
      console.error("[getCareerSite] create default failed:", error);
      return null;
    }
    return mapSite(created);
  } catch (e) {
    console.error("[getCareerSite]", e);
    return null;
  }
}

export interface CareerSiteInput {
  companyName?: string;
  logoUrl?: string;
  bannerUrl?: string;
  brandColor?: string;
  aboutText?: string;
  missionText?: string;
  valuesText?: string;
  showAbout?: boolean;
  showBenefits?: boolean;
  showTeam?: boolean;
  showTestimonials?: boolean;
  showContact?: boolean;
  benefits?: string[];
  testimonials?: Testimonial[];
  contactEmail?: string;
}

function toRow(v: CareerSiteInput): Record<string, unknown> {
  const row: Record<string, unknown> = {};
  if (v.companyName !== undefined) row.company_name = String(v.companyName).slice(0, 200);
  if (v.logoUrl !== undefined) row.logo_url = String(v.logoUrl).slice(0, 2000) || null;
  if (v.bannerUrl !== undefined) row.banner_url = String(v.bannerUrl).slice(0, 2000) || null;
  if (v.brandColor !== undefined) row.brand_color = HEX_RE.test(String(v.brandColor)) ? v.brandColor : "#F59E0B";
  if (v.aboutText !== undefined) row.about_text = String(v.aboutText).slice(0, 5000) || null;
  if (v.missionText !== undefined) row.mission_text = String(v.missionText).slice(0, 3000) || null;
  if (v.valuesText !== undefined) row.values_text = String(v.valuesText).slice(0, 3000) || null;
  if (v.showAbout !== undefined) row.show_about = !!v.showAbout;
  if (v.showBenefits !== undefined) row.show_benefits = !!v.showBenefits;
  if (v.showTeam !== undefined) row.show_team = !!v.showTeam;
  if (v.showTestimonials !== undefined) row.show_testimonials = !!v.showTestimonials;
  if (v.showContact !== undefined) row.show_contact = !!v.showContact;
  if (v.benefits !== undefined) row.benefits = strList(v.benefits);
  if (v.testimonials !== undefined) row.testimonials = testimonialList(v.testimonials);
  if (v.contactEmail !== undefined) row.contact_email = String(v.contactEmail).slice(0, 200) || null;
  return row;
}

export async function updateCareerSite(employerId: string, patch: CareerSiteInput): Promise<CareerSite | null> {
  const c = db();
  if (!c) throw new Error("Supabase client not configured (check NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY).");
  if (!employerId) return null;
  // Ensure a row exists first (and thus a stable slug).
  const existing = await getCareerSite(employerId, patch.companyName || "");
  if (!existing) return null;
  try {
    const { data, error } = await c
      .from("career_sites")
      .update({ ...toRow(patch), updated_at: new Date().toISOString() })
      .eq("employer_id", employerId)
      .select(COLS)
      .single();
    if (error || !data) {
      console.error("[updateCareerSite]", error);
      return null;
    }
    return mapSite(data);
  } catch (e) {
    console.error("[updateCareerSite]", e);
    return null;
  }
}

function mapPublicJob(r: Record<string, unknown>): PublicCareerJob {
  return {
    id: r.id as number,
    title: (r.title as string) || "",
    department: (r.department as string) || "",
    location: (r.location as string) || "",
    remoteType: ((r.remote_type as RemoteType) || "") as RemoteType | "",
    employmentType: ((r.employment_type as EmploymentType) || "") as EmploymentType | "",
    salaryMin: typeof r.salary_min === "number" ? (r.salary_min as number) : null,
    salaryMax: typeof r.salary_max === "number" ? (r.salary_max as number) : null,
    salaryCurrency: (r.salary_currency as string) || "USD",
    description: (r.description as string) || "",
    requirements: Array.isArray(r.requirements) ? r.requirements.map((x) => String(x)).filter(Boolean) : [],
  };
}

/** Public read by slug — no auth. Returns the site config + that employer's
 *  active, public-listed jobs (public-safe fields only), or null if no site. */
export async function getPublicCareerSite(slug: string): Promise<{ site: CareerSite; jobs: PublicCareerJob[] } | null> {
  const c = db();
  if (!c || !slug) return null;
  try {
    const { data } = await c.from("career_sites").select(COLS + ", employer_id").eq("slug", slug).maybeSingle();
    if (!data) return null;
    const row = data as unknown as Record<string, unknown>;
    const site = mapSite(row);
    const employerId = row.employer_id as string;
    const { data: jobRows } = await c
      .from("job_postings")
      .select("id, title, department, location, remote_type, employment_type, salary_min, salary_max, salary_currency, description, requirements")
      .eq("employer_id", employerId)
      .eq("status", "active")
      .eq("public_listed", true)
      .order("created_at", { ascending: false })
      .limit(200);
    const jobs = (jobRows || []).map(mapPublicJob);
    return { site, jobs };
  } catch (e) {
    console.error("[getPublicCareerSite]", e);
    return null;
  }
}
