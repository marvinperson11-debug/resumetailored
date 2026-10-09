import { NextResponse } from "next/server";
import { requireEmployerId, employerContext } from "@/lib/employer-auth";
import { canManageCareerSite } from "@/lib/career-site-permissions";
import { getEmployerProfile } from "@/lib/employer-store";
import { getCareerSite, getCareerSiteState, createCareerSite, softDeleteCareerSite, updateCareerSite, isSlugAvailable, type CareerSiteInput } from "@/lib/career-site-store";
import { isValidSlug, normalizeSlug } from "@/lib/subdomain";
import type { Testimonial } from "@/lib/employer-ai";

export const runtime = "nodejs";

/** GET — this employer's career site config (created with a default slug on
 *  first access). */
export async function GET() {
  const employerId = await requireEmployerId();
  if (!employerId) return NextResponse.json({ error: "forbidden" }, { status: 403 });
  try {
    // A soft-deleted site is reported as such (never silently recreated) so the page can offer "create".
    if ((await getCareerSiteState(employerId)).state === "deleted") return NextResponse.json({ site: null, deleted: true });
    const profile = await getEmployerProfile(employerId);
    const site = await getCareerSite(employerId, profile?.companyName || "");
    if (!site) return NextResponse.json({ error: "Could not load your career site." }, { status: 500 });
    return NextResponse.json({ site });
  } catch (error) {
    console.error("[career-site GET]", error);
    return NextResponse.json({ error: "Could not load your career site." }, { status: 500 });
  }
}

/** POST — (re)create the career site after it was deleted. Owner only. */
export async function POST() {
  const ctx = await employerContext();
  if (!canManageCareerSite(ctx)) return NextResponse.json({ error: "forbidden" }, { status: 403 });
  try {
    const profile = await getEmployerProfile(ctx!.employerId);
    const site = await createCareerSite(ctx!.employerId, profile?.companyName || "");
    if (!site) return NextResponse.json({ error: "Could not create your career site." }, { status: 500 });
    return NextResponse.json({ site });
  } catch (error) {
    console.error("[career-site POST]", error);
    return NextResponse.json({ error: "Could not create your career site." }, { status: 500 });
  }
}

/** DELETE — soft-delete the career site (kept in the database, recoverable by us). Owner only,
 *  checked here on the server: the employer id comes from the session, never from the request. */
export async function DELETE() {
  const ctx = await employerContext();
  if (!canManageCareerSite(ctx)) return NextResponse.json({ error: "forbidden" }, { status: 403 });
  try {
    const ok = await softDeleteCareerSite(ctx!.employerId);
    if (!ok) return NextResponse.json({ error: "Could not delete your career site." }, { status: 404 });
    return NextResponse.json({ ok: true });
  } catch (error) {
    console.error("[career-site DELETE]", error);
    return NextResponse.json({ error: "Could not delete your career site." }, { status: 500 });
  }
}

/** PATCH — update the career site config. */
export async function PATCH(req: Request) {
  const employerId = await requireEmployerId();
  if (!employerId) return NextResponse.json({ error: "forbidden" }, { status: 403 });
  if ((await getCareerSiteState(employerId)).state === "deleted") return NextResponse.json({ error: "no_site" }, { status: 404 });
  const b = (await req.json().catch(() => ({}))) as Record<string, unknown>;

  const patch: CareerSiteInput = {};
  // Slug edits change the primary subdomain — validate format + availability.
  if (b.slug !== undefined) {
    const slug = normalizeSlug(String(b.slug));
    if (!isValidSlug(slug)) {
      return NextResponse.json({ error: "That address isn’t valid — use letters, numbers, and hyphens (and not a reserved word)." }, { status: 400 });
    }
    if (!(await isSlugAvailable(employerId, slug))) {
      return NextResponse.json({ error: "That address is already taken. Please choose another." }, { status: 409 });
    }
    patch.slug = slug;
  }
  if (b.companyName !== undefined) patch.companyName = String(b.companyName);
  if (b.logoUrl !== undefined) patch.logoUrl = String(b.logoUrl);
  if (b.bannerUrl !== undefined) patch.bannerUrl = String(b.bannerUrl);
  if (b.brandColor !== undefined) patch.brandColor = String(b.brandColor);
  if (b.aboutText !== undefined) patch.aboutText = String(b.aboutText);
  if (b.missionText !== undefined) patch.missionText = String(b.missionText);
  if (b.valuesText !== undefined) patch.valuesText = String(b.valuesText);
  if (b.contactEmail !== undefined) patch.contactEmail = String(b.contactEmail);
  if (b.showAbout !== undefined) patch.showAbout = !!b.showAbout;
  if (b.showBenefits !== undefined) patch.showBenefits = !!b.showBenefits;
  if (b.showTeam !== undefined) patch.showTeam = !!b.showTeam;
  if (b.showTestimonials !== undefined) patch.showTestimonials = !!b.showTestimonials;
  if (b.showContact !== undefined) patch.showContact = !!b.showContact;
  if (Array.isArray(b.benefits)) patch.benefits = b.benefits.map((x) => String(x));
  if (Array.isArray(b.testimonials)) patch.testimonials = b.testimonials as Testimonial[];

  try {
    const site = await updateCareerSite(employerId, patch);
    if (!site) return NextResponse.json({ error: "Could not save your career site." }, { status: 500 });
    return NextResponse.json({ site });
  } catch (error) {
    console.error("[career-site PATCH]", error);
    return NextResponse.json({ error: "Could not save your career site." }, { status: 500 });
  }
}
