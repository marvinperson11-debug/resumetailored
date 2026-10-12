import { assertGuestConfig } from "./guest-config";

/**
 * Start-up checks that must stop the server. Imported only from instrumentation.ts, inside
 * its `NEXT_RUNTIME === "nodejs"` branch — this file uses process.exit, which the edge
 * compile of instrumentation must never see.
 *
 * Why exit instead of throw: Next logs an error thrown from register() and then carries on
 * ("✓ Ready") — so a bare throw would leave a server running with no guest salt. The legacy
 * Express site refuses to boot without TOOLS_HASH_SALT (it throws at require time); this is
 * the same promise for GUEST_QUOTA_SALT.
 */
export function requireGuestConfigOrExit(exit: (code: number) => unknown = (code) => process.exit(code)): boolean {
  try {
    assertGuestConfig();
    return true;
  } catch (e) {
    console.error(`FATAL: ${e instanceof Error ? e.message : String(e)} Refusing to start.`);
    exit(1);
    return false;
  }
}
