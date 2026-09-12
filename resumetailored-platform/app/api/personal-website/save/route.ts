import { NextResponse } from "next/server";
import { auth } from "@clerk/nextjs/server";
import { isIndividualPro } from "@/lib/plan";
import { renderStudioSite } from "@/lib/studio-render";
import { isStudioSite, type StudioSite } from "@/lib/studio-types";
import { saveSiteDraft } from "@/lib/site-store";

export const runtime = "nodejs";
export const maxDuration = 20;

/** Autosave the Web Studio working draft (Pro-only). Stores the v2 document +
 *  a rendered snapshot WITHOUT changing publish state — a first-time draft stays
 *  unpublished (its /site/<slug> 404s) until the user explicitly publishes. */
export async function POST(req: Request) {
  const { userId } = await auth();
  if (!userId) return NextResponse.json({ error: "not_signed_in" }, { status: 401 });
  if (!(await isIndividualPro())) return NextResponse.json({ error: "pro_required" }, { status: 402 });

  const body = (await req.json().catch(() => ({}))) as { site?: StudioSite };
  const site = body.site;
  if (!site || !isStudioSite(site)) return NextResponse.json({ error: "bad_site" }, { status: 400 });
  if (JSON.stringify(site).length > 5_000_000) return NextResponse.json({ error: "too_large" }, { status: 413 });

  const html = renderStudioSite(site);
  const ok = await saveSiteDraft(userId, html, site as unknown as Record<string, unknown>);
  return NextResponse.json({ ok });
}
