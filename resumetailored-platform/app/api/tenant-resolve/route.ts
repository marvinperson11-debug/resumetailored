import { NextResponse } from "next/server";
import { resolveTenant } from "@/lib/tenant-resolve";
import { isValidSlug } from "@/lib/subdomain";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Internal helper for middleware subdomain routing (no auth). Given a tenant
 * label, returns { type: "career" | "site" | null } by checking both the
 * career_sites and personal_sites namespaces. Middleware calls this only for
 * tenant root requests; it never rewrites this path, so there's no recursion.
 */
export async function GET(req: Request) {
  const label = (new URL(req.url).searchParams.get("label") || "").toLowerCase();
  if (!label || !isValidSlug(label)) {
    return NextResponse.json({ type: null }, { headers: { "Cache-Control": "no-store" } });
  }
  const type = await resolveTenant(label);
  return NextResponse.json({ type }, { headers: { "Cache-Control": "no-store" } });
}
