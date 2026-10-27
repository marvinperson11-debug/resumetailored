import { NextResponse } from "next/server";
import { listPublicJobsForSitemap } from "@/lib/employer-store";
import { appUrl } from "@/lib/subdomain";

export const dynamic = "force-dynamic";

function escapeXml(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

/**
 * Public jobs sitemap (post-canary fix) — lists ONLY currently active+public
 * jobs. Was app/sitemap.ts (a Next metadata-file convention), which Next
 * prerenders at build time regardless of `export const dynamic =
 * "force-dynamic"` — confirmed by the canary probe to be serving a build-time
 * snapshot. A plain route handler has no such convention to prerender, so it
 * re-reads the table on every request; `no-store` keeps any edge/CDN layer
 * from caching it either. Same query, same URL shape as before.
 */
export async function GET() {
  // Live data — never cache below this line; freshness is verified per
  // deploy (see sitemap/feed liveness checklist).
  let jobs: Awaited<ReturnType<typeof listPublicJobsForSitemap>>;
  try {
    jobs = await listPublicJobsForSitemap();
  } catch (e) {
    // Silent-fallback class, closed: a failed query used to resolve to []
    // and serve a confident 200 with zero (or stale) jobs — indistinguishable
    // from "there really are no public jobs right now". Fail loudly instead.
    console.error("[sitemap.xml] listPublicJobsForSitemap failed — refusing to serve a possibly-empty/stale sitemap", e);
    return new NextResponse("sitemap temporarily unavailable", { status: 503, headers: { "Cache-Control": "no-store" } });
  }
  const urls = jobs
    .map((j) => {
      const loc = escapeXml(appUrl(`/jobs/${j.id}`));
      const lastmod = j.updatedAt ? `<lastmod>${escapeXml(j.updatedAt)}</lastmod>` : "";
      return `<url><loc>${loc}</loc>${lastmod}<changefreq>daily</changefreq></url>`;
    })
    .join("");
  const xml = `<?xml version="1.0" encoding="UTF-8"?><urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">${urls}</urlset>`;
  return new NextResponse(xml, {
    headers: { "Content-Type": "application/xml", "Cache-Control": "no-store" },
  });
}
