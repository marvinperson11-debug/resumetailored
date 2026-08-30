/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  // The browser extension calls the API cross-origin. CORS for the
  // extension-facing endpoints is handled per-route in the route handlers
  // (see src/lib/cors.ts) so we can scope it tightly rather than globally.
  //
  // Run src/instrumentation.ts once on server boot (logs the apply-queue bridge
  // config so a missing RT_SERVICE_TOKEN / RT_MAIN_APP_URL is obvious in logs).
  experimental: {
    instrumentationHook: true,
  },
};

export default nextConfig;
