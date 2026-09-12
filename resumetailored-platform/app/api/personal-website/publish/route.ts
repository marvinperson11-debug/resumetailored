import { NextResponse } from "next/server";
import { auth } from "@clerk/nextjs/server";
import { isIndividualPro } from "@/lib/plan";
import { generateSiteHtml, type SiteData } from "@/lib/site-templates";
import { renderStudioSite } from "@/lib/studio-render";
import { isStudioSite, type StudioSite } from "@/lib/studio-types";
import { publishSite } from "@/lib/site-store";

export const runtime = "nodejs";
export const maxDuration = 30;

/** Publish the user's personal website. PRO ONLY. Renders the HTML server-side
 *  (so the stored page can't be tampered with) and upserts it to one public
 *  slug per user, served at /site/<slug>.
 *
 *  Accepts either the v2 Web Studio document (`studio`) or the legacy flat
 *  `data` payload — the same public slug/route serves whichever was rendered. */
export async function POST(req: Request) {
  const { userId } = await auth();
  if (!userId) return NextResponse.json({ error: "not_signed_in", message: "Please sign in." }, { status: 401 });

  if (!(await isIndividualPro())) {
    return NextResponse.json({ error: "pro_required", message: "Publishing a personal website is a Pro feature." }, { status: 402 });
  }

  const body = (await req.json().catch(() => ({}))) as { studio?: StudioSite; data?: SiteData; slug?: string };

  let html: string;
  let stored: Record<string, unknown>;
  let name: string;

  if (body.studio && isStudioSite(body.studio)) {
    const site = body.studio;
    // Guard against oversized payloads (embedded base64 media).
    if (JSON.stringify(site).length > 5_000_000) {
      return NextResponse.json({ error: "Your site is too large — use hosted image/video URLs instead of large uploads." }, { status: 413 });
    }
    html = renderStudioSite(site);
    stored = site as unknown as Record<string, unknown>;
    name = (site.sections.find((s) => s.type === "hero")?.elements.find((e) => e.type === "heading")?.content || site.title || "site").replace(/<[^>]+>/g, "").trim() || "site";
  } else {
    const data = body.data;
    if (!data || !data.name?.trim()) return NextResponse.json({ error: "Add at least your name before publishing." }, { status: 400 });
    if (data.photo && data.photo.length > 3_000_000) return NextResponse.json({ error: "Photo is too large — use a smaller image." }, { status: 413 });
    html = generateSiteHtml(data);
    stored = data as unknown as Record<string, unknown>;
    name = data.name;
  }

  const res = await publishSite(userId, html, stored, name, body.slug);
  if (!res) return NextResponse.json({ error: "Could not publish (is the personal_sites table set up?)." }, { status: 500 });

  const origin = new URL(req.url).origin;
  return NextResponse.json({ slug: res.slug, url: `${origin}/site/${res.slug}` });
}
