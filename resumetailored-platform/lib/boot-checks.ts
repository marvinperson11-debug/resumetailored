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

/**
 * Fire-and-forget: run the guest quota self-test once the server is up and say the result in the
 * log. Deliberately does NOT stop the server — the fail-closed reserve already declines guests when
 * the store is broken, and signed-in users must keep working — it just makes "the quota store does
 * not work" a line in the deploy log rather than something QA finds.
 */
export function startGuestSelfTest(run: () => Promise<{ ok: true } | { ok: false; step: string; detail: string }>, delayMs = 3000): void {
  setTimeout(() => {
    run()
      .then((r) => {
        if (r.ok) console.log("[guest] self-test OK: reserve -> cap -> refund all behave on the real quota store");
        else console.error(`[guest] SELF-TEST FAILED at "${r.step}": ${r.detail}. Anonymous requests will be declined (503) until this is fixed.`);
      })
      .catch((e) => console.error("[guest] SELF-TEST CRASHED:", e instanceof Error ? e.message : e));
  }, delayMs);
}
