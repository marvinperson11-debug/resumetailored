// instrumentation.ts — Next.js runs register() once when the server starts
// (enabled via experimental.instrumentationHook in next.config.mjs). We use it
// to make the apply-queue bridge's configuration state obvious in the logs, so a
// missing RT_SERVICE_TOKEN / RT_MAIN_APP_URL is caught at boot rather than as a
// silent no-op later. The app still runs either way (graceful degradation).

export async function register() {
  // Only the Node.js server runtime touches the bridge env.
  if (process.env.NEXT_RUNTIME && process.env.NEXT_RUNTIME !== "nodejs") return;
  const { getBridgeConfig } = await import("@/lib/bridge-config");
  const cfg = getBridgeConfig();
  if (cfg.configured) {
    console.log(`[AutoApply Bridge] configured → ${cfg.mainAppUrl} (apply-queue sync enabled).`);
  } else {
    console.warn(
      `[AutoApply Bridge] ${cfg.missing.join(" + ")} not set — apply-queue sync with the main ` +
        `ResumeTailored app is DISABLED. The dashboard will show "Bridge not configured" and the ` +
        `app falls back to its own local job list. Set RT_MAIN_APP_URL + RT_SERVICE_TOKEN to enable.`
    );
  }
}
