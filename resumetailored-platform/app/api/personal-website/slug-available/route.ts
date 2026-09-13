import { NextResponse } from "next/server";
import { auth } from "@clerk/nextjs/server";
import { cleanSiteSlug, isValidSiteSlug, personalSlugAvailable } from "@/lib/site-store";

export const runtime = "nodejs";

/** GET ?slug= — live availability check for a personal-site address across the
 *  shared namespace (career sites + personal sites). Returns { slug, valid, available }. */
export async function GET(req: Request) {
  const { userId } = await auth();
  if (!userId) return NextResponse.json({ error: "not_signed_in" }, { status: 401 });
  const slug = cleanSiteSlug(new URL(req.url).searchParams.get("slug") || "");
  if (!isValidSiteSlug(slug)) return NextResponse.json({ slug, valid: false, available: false });
  const available = await personalSlugAvailable(userId, slug);
  return NextResponse.json({ slug, valid: true, available });
}
