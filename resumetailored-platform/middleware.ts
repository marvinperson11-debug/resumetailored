import { clerkMiddleware, createRouteMatcher } from "@clerk/nextjs/server";
import { NextResponse } from "next/server";
import { careerSubdomainFromHost } from "@/lib/subdomain";

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
    const url = req.nextUrl.clone();
    url.pathname = `/careers/${sub}`;
    return NextResponse.rewrite(url);
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
