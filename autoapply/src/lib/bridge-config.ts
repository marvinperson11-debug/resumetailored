// bridge-config.ts — one place to answer "is the apply-queue bridge to the main
// ResumeTailored app configured, and if not, what's missing?" Used by the
// startup instrumentation and by the /api/apply-queue/status route the dashboard
// polls for its Synced / Bridge-offline badge.

export interface BridgeConfig {
  configured: boolean;
  mainAppUrl: string | null;
  missing: string[]; // names of the env vars that are unset
}

export function getBridgeConfig(): BridgeConfig {
  const mainAppUrl = process.env.RT_MAIN_APP_URL || null;
  const token = process.env.RT_SERVICE_TOKEN || null;
  const missing: string[] = [];
  if (!mainAppUrl) missing.push("RT_MAIN_APP_URL");
  if (!token) missing.push("RT_SERVICE_TOKEN");
  return { configured: missing.length === 0, mainAppUrl, missing };
}
