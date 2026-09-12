import type { MetadataRoute } from "next";

// PWA / home-screen manifest — RT branding, gold theme.
export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "ResumeTailored",
    short_name: "ResumeTailored",
    description: "A private office for your ambitions.",
    start_url: "/",
    display: "standalone",
    background_color: "#0B0F19",
    theme_color: "#C2870B",
    icons: [
      { src: "/icon", sizes: "32x32", type: "image/png" },
      { src: "/apple-icon", sizes: "180x180", type: "image/png" },
      { src: "/apple-icon", sizes: "192x192", type: "image/png" },
      { src: "/apple-icon", sizes: "512x512", type: "image/png" },
    ],
  };
}
