import { NextResponse } from "next/server";
import { auth } from "@clerk/nextjs/server";
import { isPro } from "@/lib/plan";
import { generateSiteHtml, type SiteData } from "@/lib/site-templates";
import { publishSite } from "@/lib/site-store";

export const runtime = "nodejs";
export const maxDuration = 30;

/** Publish the user's personal website. PRO ONLY. Renders the HTML server-side
 *  (so the stored page can't be tampered with) and upserts it to one public
 *  slug per user, served at /site/<slug>. */
export async function POST(req: Request) {
  const { userId } = await auth();
  if (!userId) return NextResponse.json({ error: "not_signed_in", message: "Please sign in." }, { status: 401 });

  if (!(await isPro())) {
    return NextResponse.json({ error: "pro_required", message: "Publishing a personal website is a Pro feature." }, { status: 402 });
  }

  const body = (await req.json().catch(() => ({}))) as { data?: SiteData };
  const data = body.data;
  if (!data || !data.name?.trim()) return NextResponse.json({ error: "Add at least your name before publishing." }, { status: 400 });
  if (data.photo && data.photo.length > 3_000_000) return NextResponse.json({ error: "Photo is too large — use a smaller image." }, { status: 413 });

  const html = generateSiteHtml(data);
  const res = await publishSite(userId, html, data as unknown as Record<string, unknown>, data.name);
  if (!res) return NextResponse.json({ error: "Could not publish (is the personal_sites table set up?)." }, { status: 500 });

  const origin = new URL(req.url).origin;
  return NextResponse.json({ slug: res.slug, url: `${origin}/site/${res.slug}` });
}
