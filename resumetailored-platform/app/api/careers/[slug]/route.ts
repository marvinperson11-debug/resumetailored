import { NextResponse } from "next/server";
import { getPublicCareerSite } from "@/lib/career-site-store";

export const runtime = "nodejs";

/** Public — no auth. Returns a career site config + that employer's active,
 *  public-listed jobs (public-safe fields only). */
export async function GET(_req: Request, { params }: { params: { slug: string } }) {
  const slug = String(params.slug || "").trim();
  if (!slug) return NextResponse.json({ error: "not_found" }, { status: 404 });
  const data = await getPublicCareerSite(slug);
  if (!data) return NextResponse.json({ error: "not_found" }, { status: 404 });
  return NextResponse.json(data);
}
