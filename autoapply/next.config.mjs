/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  // The browser extension calls the API cross-origin. CORS for the
  // extension-facing endpoints is handled per-route in the route handlers
  // (see src/lib/cors.ts) so we can scope it tightly rather than globally.
};

export default nextConfig;
