import { isIP } from "node:net";

/**
 * The visitor's address, for per-IP limits and guest quotas. A TypeScript port of the
 * legacy site's client-ip.js (same precedence, same normalisation) — the platform's
 * Docker build context is this folder, so it cannot import the root file. The two are
 * kept honest by scripts/test-guest-gate.cjs, which runs both over the same inputs.
 *
 * Precedence, most trustworthy first:
 *   1. `CF-Connecting-IP` — production is Cloudflare -> Railway -> app, and Cloudflare
 *      puts the real client address here.
 *   2. The platform-provided `request.ip` (NextRequest only; unset on a self-hosted
 *      `next start`).
 *   3. The RIGHTMOST `X-Forwarded-For` entry — the address the nearest proxy saw. That is
 *      what Express's `req.ip` returns with `trust proxy = 1` on the legacy site.
 *      NEVER the leftmost: the leftmost entry is whatever the client chose to send, so
 *      keying a limit on it lets anyone mint a fresh identity per request.
 *   4. `'unknown'`. Route handlers have no socket to fall back to (the legacy helper's
 *      last resort), so every caller that reaches here shares one bucket.
 *
 * Trust note: CF-Connecting-IP is only authoritative for traffic that really came through
 * Cloudflare. A caller that reaches the origin directly (the *.up.railway.app host) can
 * set it to anything, so a limit built on this is a fairness control, not a security
 * boundary — which is why guest quotas also have a global spend ceiling (lib/guest.ts).
 *
 * IPv6 clients are bucketed by /64: one subscriber is handed that whole block, so a
 * per-address cap on an IPv6 address would be trivially rotated.
 */

function v6Prefix64(ip: string): string {
  if (ip.includes(".")) return ip; // embedded-IPv4 forms other than ::ffff: are rare; keep as-is
  const halves = ip.split("::");
  const head = halves[0] ? halves[0].split(":") : [];
  const tail = halves.length > 1 && halves[1] ? halves[1].split(":") : [];
  const fill = halves.length > 1 ? Array(Math.max(0, 8 - head.length - tail.length)).fill("0") : [];
  const groups = head.concat(fill, tail).map((g) => g.padStart(4, "0"));
  return groups.slice(0, 4).join(":") + "::/64";
}

/** Canonical form for a quota key, or null when `raw` is not an IP address. */
export function normalizeIp(raw: unknown): string | null {
  if (typeof raw !== "string") return null;
  let ip = raw.trim().toLowerCase();
  if (!ip) return null;
  const zone = ip.indexOf("%");
  if (zone !== -1) ip = ip.slice(0, zone);
  if (ip.startsWith("::ffff:") && isIP(ip.slice(7)) === 4) ip = ip.slice(7);
  const family = isIP(ip);
  if (family === 4) return ip;
  if (family === 6) return v6Prefix64(ip);
  return null;
}

export function getClientIp(req: Request): string {
  const cf = req.headers.get("cf-connecting-ip");
  const platformIp = (req as Request & { ip?: string }).ip;
  const xff = req.headers.get("x-forwarded-for");
  const rightmost = xff ? xff.split(",").pop() : undefined;
  return normalizeIp(cf) || normalizeIp(platformIp) || normalizeIp(rightmost) || "unknown";
}
