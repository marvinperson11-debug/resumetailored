import { NextResponse } from "next/server";
import { resolveTenant, resolveAlias } from "@/lib/tenant-resolve";
import { isValidSlug } from "@/lib/subdomain";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Internal helper for middleware subdomain routing (no auth). Given a tenant
 * label, returns { type: "career" | "site" | null } by checking both the
 * career_sites and personal_sites namespaces. When there's no CURRENT match, the
 * label may be an old (renamed) slug: we then resolve the alias and return the
 * CURRENT slug plus { aliased: true } so middleware can 301-redirect. Middleware
 * calls this only for tenant root / path requests; it never rewrites this path,
 * so there's no recursion.
 */
export async function GET(req: Request) {
  const noStore = { headers: { "Cache-Control": "no-store" } };
  const label = (new URL(req.url).searchParams.get("label") || "").toLowerCase();
  if (!label || !isValidSlug(label)) {
    return NextResponse.json({ type: null }, noStore);
  }
  const type = await resolveTenant(label);
  if (type) return NextResponse.json({ type }, noStore);
  // No current tenant owns this label — is it a renamed slug?
  const alias = await resolveAlias(label);
  if (alias) return NextResponse.json({ type: alias.type, slug: alias.slug, aliased: true }, noStore);
  return NextResponse.json({ type: null }, noStore);
}
