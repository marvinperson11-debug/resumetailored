import { NextResponse } from "next/server";
import { requireEmployerId } from "@/lib/employer-auth";
import { getEmployerProfile } from "@/lib/employer-store";
import { getCareerSite, updateCareerSite, type CareerSiteInput } from "@/lib/career-site-store";
import type { Testimonial } from "@/lib/employer-ai";

export const runtime = "nodejs";

/** GET — this employer's career site config (created with a default slug on
 *  first access). */
export async function GET() {
  const employerId = await requireEmployerId();
  if (!employerId) return NextResponse.json({ error: "forbidden" }, { status: 403 });
  try {
    const profile = await getEmployerProfile(employerId);
    const site = await getCareerSite(employerId, profile?.companyName || "");
    if (!site) return NextResponse.json({ error: "Could not load your career site." }, { status: 500 });
    return NextResponse.json({ site });
  } catch (error) {
    console.error("[career-site GET]", error);
    return NextResponse.json({ error: "Could not load your career site." }, { status: 500 });
  }
}

/** PATCH — update the career site config. */
export async function PATCH(req: Request) {
  const employerId = await requireEmployerId();
  if (!employerId) return NextResponse.json({ error: "forbidden" }, { status: 403 });
  const b = (await req.json().catch(() => ({}))) as Record<string, unknown>;

  const patch: CareerSiteInput = {};
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
