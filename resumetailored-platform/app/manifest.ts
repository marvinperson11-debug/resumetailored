import type { MetadataRoute } from "next";

// PWA / home-screen manifest — RT branding, gold theme. The 192/512 icons are
// the same real RT logo mark already shipped as the marketing site's favicon
// (root repo's public/favicon-192.png + favicon.png), copied here as static
// files so they install reliably (the dynamic /icon and /apple-icon routes
// stay as the favicon + iOS home-screen icon, unrelated to this manifest).
export default function manifest(): MetadataRoute.Manifest {
  return {
    id: "/",
    name: "ResumeTailored",
    short_name: "ResumeTailored",
    description: "A private office for your ambitions.",
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
  };
}
