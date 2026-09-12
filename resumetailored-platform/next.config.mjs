import createNextIntlPlugin from "next-intl/plugin";

// Cookie-based locale (no i18n routing) — the request config reads `rt_locale`.
const withNextIntl = createNextIntlPlugin("./i18n/request.ts");

/** @type {import('next').NextConfig} */
const nextConfig = {
  experimental: {
    // Keep the resume-parsing libs out of the webpack bundle — they use dynamic
    // requires / read data files at runtime and must load as real Node modules.
    serverComponentsExternalPackages: ["pdf-parse", "mammoth"],
    // Tree-shake barrel imports so a page only ships the icons/charts it uses,
    // instead of the whole library. Big first-load win for lucide-react (used
    // across every sidebar/nav) and recharts (employer dashboards only).
    optimizePackageImports: ["lucide-react", "recharts"],
  },
};

export default withNextIntl(nextConfig);
