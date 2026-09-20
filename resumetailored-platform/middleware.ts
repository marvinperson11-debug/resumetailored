import { clerkMiddleware, createRouteMatcher } from "@clerk/nextjs/server";
import { NextResponse } from "next/server";
import { careerSubdomainFromHost, APP_ORIGIN, ROOT_DOMAIN } from "@/lib/subdomain";

/** Ask the internal resolver what a tenant label maps to. Returns the current
 *  tenant kind, and — when `label` is a renamed (old) slug — the current slug it
 *  now points to plus `aliased: true`. Fails soft to an empty result. */
async function resolveLabel(
  label: string
): Promise<{ type?: string; slug?: string; aliased?: boolean }> {
  try {
    const r = await fetch(`${APP_ORIGIN}/api/tenant-resolve?label=${encodeURIComponent(label)}`, {
      signal: AbortSignal.timeout(2500),
    });
    if (r.ok) return (await r.json()) as { type?: string; slug?: string; aliased?: boolean };
  } catch {
    /* fall through to empty */
  }
  return {};
}

// Production auth: everything under these prefixes requires a signed-in user.
const isProtectedRoute = createRouteMatcher([
  "/dashboard(.*)",
  "/employer(.*)",
  "/candidate(.*)",
]);

export default clerkMiddleware(async (auth, req) => {
  // Career-site subdomains: {slug}.resumetailored.com → render /careers/{slug}
  // via an internal REWRITE (the URL bar keeps showing the subdomain). The
  // Cloudflare Worker (route *.resumetailored.com/*) forwards to
  // app.resumetailored.com and sets BOTH x-original-host and x-forwarded-host to
  // the tenant subdomain — but Cloudflare's edge overwrites x-forwarded-host with
  // app.resumetailored.com, so x-original-host is the reliable one. Prefer it,
  // then x-forwarded-host, then host. Only the root path is rewritten, so the
  // Apply flow (/jobs/:id) and assets still route normally on the subdomain. The
  // /careers/[slug] page handles a missing slug (404).
  const sub = careerSubdomainFromHost(
    req.headers.get("x-original-host") || req.headers.get("x-forwarded-host") || req.headers.get("host")
  );
  if (sub && req.nextUrl.pathname === "/") {
    // Slugs share one namespace across employer career sites and candidate
    // personal sites. Ask the internal resolver which one owns this label, then
    // rewrite to /careers/{slug} or /site/{slug}. The resolver is called on the
    // canonical app origin (never the subdomain) so there's no Worker loop; it
    // lives at /api/tenant-resolve, which is never a root path and so is never
    // rewritten. On any failure or an unknown slug, fall back to /careers/{slug}
    // (which renders the friendly careers "not found" page).
    const d = await resolveLabel(sub);
    // A renamed (old) slug 301-redirects to its current subdomain, path "/".
    if (d.aliased && d.slug && d.slug !== sub) {
      return NextResponse.redirect(`https://${d.slug}.${ROOT_DOMAIN}/`, 301);
    }
    const type: "career" | "site" = d.type === "site" ? "site" : "career";
    const url = req.nextUrl.clone();
    url.pathname = type === "site" ? `/site/${sub}` : `/careers/${sub}`;
    return NextResponse.rewrite(url);
  }

  // Direct path hits (canonical app origin or a shared link): an old
  // /careers/{oldslug} or /site/{oldslug} 301-redirects to the current path. A
  // current slug isn't an alias, so this leaves live pages untouched.
  const pathAlias = req.nextUrl.pathname.match(/^\/(careers|site)\/([^/]+)\/?$/);
  if (pathAlias) {
    const label = decodeURIComponent(pathAlias[2]).toLowerCase();
    const d = await resolveLabel(label);
    if (d.aliased && d.slug && d.slug !== label) {
      const url = req.nextUrl.clone();
      url.pathname = `/${d.type === "site" ? "site" : "careers"}/${d.slug}`;
      return NextResponse.redirect(url, 301);
    }
  }

  if (isProtectedRoute(req)) {
    const { userId } = await auth();
    if (!userId) {
      // Unauthenticated visitors are sent back to the public landing page.
      return NextResponse.redirect(new URL("/", req.url));
    }
  }
});

export const config = {
  matcher: [
    // Skip Next.js internals and static files, unless found in search params.
    "/((?!_next|[^?]*\\.(?:html?|css|js(?!on)|jpe?g|webp|png|gif|svg|ttf|woff2?|ico|csv|docx?|xlsx?|zip|webmanifest)).*)",
    // Always run for API routes.
    "/(api|trpc)(.*)",
  ],
};
