import { clerkMiddleware } from "@clerk/nextjs/server";

// DEMO BUILD: no routes are gated, so the full /dashboard/* experience is
// clickable on a preview URL where the live Clerk key (bound to
// clerk.resumetailored.com) cannot complete a sign-in. Before shipping to
// production, restore auth here by protecting /dashboard(.*) and redirecting
// unauthenticated users.
export default clerkMiddleware();

export const config = {
  matcher: [
    // Skip Next.js internals and static files, unless found in search params.
    "/((?!_next|[^?]*\\.(?:html?|css|js(?!on)|jpe?g|webp|png|gif|svg|ttf|woff2?|ico|csv|docx?|xlsx?|zip|webmanifest)).*)",
    // Always run for API routes.
    "/(api|trpc)(.*)",
  ],
};
