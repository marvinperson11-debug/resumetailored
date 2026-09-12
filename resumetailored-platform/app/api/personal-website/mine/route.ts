import { NextResponse } from "next/server";
import { auth } from "@clerk/nextjs/server";
import { isIndividualPro } from "@/lib/plan";
import { getUserSite } from "@/lib/site-store";

export const runtime = "nodejs";

/** Return the signed-in user's published site (slug + saved config), so the tool
 *  can prefill and switch its button to "Update Published Site". Pro-only. */
export async function GET(req: Request) {
  const { userId } = await auth();
  if (!userId) return NextResponse.json({ error: "not_signed_in" }, { status: 401 });
  if (!(await isIndividualPro())) return NextResponse.json({ error: "pro_required" }, { status: 402 });

  const site = await getUserSite(userId);
  if (!site) return NextResponse.json({ site: null });
  const origin = new URL(req.url).origin;
  return NextResponse.json({ site: { slug: site.slug, url: `${origin}/site/${site.slug}`, config: site.data, views: site.views, published: site.published } });
}
