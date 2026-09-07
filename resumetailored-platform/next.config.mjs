/** @type {import('next').NextConfig} */
const nextConfig = {
  experimental: {
    // Keep the resume-parsing libs out of the webpack bundle — they use dynamic
    // requires / read data files at runtime and must load as real Node modules.
    serverComponentsExternalPackages: ["pdf-parse", "mammoth"],
  },
};

export default nextConfig;
