import type { MetadataRoute } from "next";
import { listPublicJobsForSitemap } from "@/lib/employer-store";
import { appUrl } from "@/lib/subdomain";

export const dynamic = "force-dynamic";

/**
 * Public jobs sitemap (Kimi prompt v3) — lists ONLY currently active+public
 * jobs. Regenerated at request time (no static snapshot to go stale), so a
 * job closed/unpublished a moment ago is already gone from the next crawl.
 * Scoped to job postings only — this app has no other indexable listing
 * pages yet (career sites are a separate feature, out of this prompt's
 * scope).
 */
export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  const jobs = await listPublicJobsForSitemap();
  const entries: MetadataRoute.Sitemap = jobs.map((j) => ({
    url: appUrl(`/jobs/${j.id}`),
    lastModified: j.updatedAt || undefined,
    changeFrequency: "daily",
  }));

  // TEMPORARY-DIAGNOSTIC: serving-layer canary (remove after probe — see
  // commit "TEMPORARY-DIAGNOSTIC: serving-layer canary (revert after probe)").
  // app/sitemap.ts uses Next's metadata-file convention, which renders
  // <urlset> itself from the returned array — there is no raw XML string to
  // inject a comment into, so the deployment id rides as one extra <url>
  // entry instead of an XML comment. TODO: delete this block.
  entries.push({ url: appUrl(`/__diagnostic-canary/${process.env.RAILWAY_DEPLOYMENT_ID || "unknown"}`) });

  return entries;
}
