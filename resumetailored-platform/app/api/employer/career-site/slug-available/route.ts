import { NextResponse } from "next/server";
import { requireEmployerId } from "@/lib/employer-auth";
import { isSlugAvailable } from "@/lib/career-site-store";
import { isValidSlug, normalizeSlug } from "@/lib/subdomain";

export const runtime = "nodejs";

/** GET ?slug= — live availability check for the career-site subdomain slug.
 *  Returns { slug, valid, available }. */
export async function GET(req: Request) {
  const employerId = await requireEmployerId();
  if (!employerId) return NextResponse.json({ error: "forbidden" }, { status: 403 });
  const raw = new URL(req.url).searchParams.get("slug") || "";
  const slug = normalizeSlug(raw);
  if (!isValidSlug(slug)) return NextResponse.json({ slug, valid: false, available: false });
  try {
    const available = await isSlugAvailable(employerId, slug);
    return NextResponse.json({ slug, valid: true, available });
  } catch {
    return NextResponse.json({ slug, valid: true, available: false });
  }
}
