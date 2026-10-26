import type { MetadataRoute } from "next";
import { appUrl } from "@/lib/subdomain";

/**
 * This app had no robots.txt at all before this prompt — crawlers default to
 * "allow everything" with no file present, so nothing was actively BLOCKING
 * the public job pages; they simply had no sitemap to be discovered through
 * (see app/sitemap.xml/route.ts). This file doesn't change that default-allow
 * stance, it just adds the sitemap pointer and keeps non-public app surfaces
 * out of the crawl explicitly.
 */
export default function robots(): MetadataRoute.Robots {
  return {
    rules: [{ userAgent: "*", allow: "/", disallow: ["/api/"] }],
    sitemap: appUrl("/sitemap.xml"),
  };
}
