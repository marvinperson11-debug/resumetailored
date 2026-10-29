import type { MetadataRoute } from "next";
import { getTranslations } from "next-intl/server";

// PWA / home-screen manifest — RT branding, gold theme. The 192/512 icons are
// the same real RT logo mark already shipped as the marketing site's favicon
// (root repo's public/favicon-192.png + favicon.png), copied here as static
// files so they install reliably (the dynamic /icon and /apple-icon routes
// stay as the favicon + iOS home-screen icon, unrelated to this manifest).
export default async function manifest(): Promise<MetadataRoute.Manifest> {
  const t = await getTranslations("manifest");
  return {
    id: "/",
    name: "ResumeTailored",
    short_name: "ResumeTailored",
    description: t("description"),
    start_url: "/?source=pwa",
    display: "standalone",
    background_color: "#0B0F19",
    theme_color: "#C2870B",
    icons: [
      { src: "/icon-192.png", sizes: "192x192", type: "image/png", purpose: "any" },
      { src: "/icon-512.png", sizes: "512x512", type: "image/png", purpose: "any" },
      { src: "/icon-192.png", sizes: "192x192", type: "image/png", purpose: "maskable" },
      { src: "/icon-512.png", sizes: "512x512", type: "image/png", purpose: "maskable" },
    ],
    // Application Tracker clip path (b) — once installed, "ResumeTailored"
    // appears in the OS share sheet for a URL shared from a job board's own
    // app/browser. GET is the simplest Web Share Target form that still
    // covers the one thing this needs (a URL, optionally folded into `text`
    // on platforms that don't populate `url` separately) — no file sharing,
    // so no multipart/POST handling to add. See
    // app/api/tracker/share-target/route.ts, which reuses the exact same
    // extractor as the paste-URL path (a).
    share_target: {
      action: "/api/tracker/share-target",
      method: "get",
      title: "title",
      text: "text",
      url: "url",
    },
  };
}
