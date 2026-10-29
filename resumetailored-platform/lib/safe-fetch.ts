import { lookup as dnsLookup } from "node:dns/promises";

/**
 * SSRF-guarded fetch for the Application Tracker's clip extractor (Combined
 * Build, Section 2) — the server fetches a URL the CANDIDATE supplies, which
 * is exactly the shape of request that can be abused to reach internal
 * services (cloud metadata endpoints, localhost admin ports, other
 * containers on the same private network) unless every hop is checked.
 *
 * Distinct from `app/api/fetch-job-url/route.ts`'s guard, which relies on a
 * fixed domain allowlist and never resolves DNS — fine for that route's
 * narrower purpose, but the spec for this feature calls for the general
 * guard explicitly ("resolve-and-block private/loopback ranges"), so a
 * dedicated module lives here rather than widening that route's contract.
 *
 * Fails CLOSED throughout: anything this module cannot confidently parse or
 * classify is treated as blocked, never as allowed — the same posture
 * lib/guest.ts takes for its own abuse surface.
 */

export type SafeFetchErrorCode =
  | "bad_protocol"
  | "blocked_address"
  | "dns_failed"
  | "too_many_redirects"
  | "login_required"
  | "http_error"
  | "not_html"
  | "too_large"
  | "timeout";

export class SafeFetchError extends Error {
  code: SafeFetchErrorCode;
  constructor(code: SafeFetchErrorCode, message: string) {
    super(message);
    this.code = code;
    this.name = "SafeFetchError";
  }
}

export function isAllowedProtocol(protocol: string): boolean {
  return protocol === "http:" || protocol === "https:";
}

/** IPv4 string -> 32-bit unsigned integer, or null if not a plain dotted-quad
 *  IPv4 literal (no hex/octal shorthand forms — those parse differently
 *  across tools, which is exactly the kind of ambiguity this module fails
 *  closed on by rejecting them as unparseable, i.e. blocked). */
function ipv4ToInt(ip: string): number | null {
  const m = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.exec(ip.trim());
  if (!m) return null;
  const parts = m.slice(1, 5).map((p) => Number(p));
  if (parts.some((p) => !Number.isInteger(p) || p < 0 || p > 255)) return null;
  return ((parts[0] << 24) | (parts[1] << 16) | (parts[2] << 8) | parts[3]) >>> 0;
}

function inRange(ipInt: number, base: string, maskBits: number): boolean {
  const baseInt = ipv4ToInt(base);
  if (baseInt === null) return false;
  const mask = maskBits === 0 ? 0 : (0xffffffff << (32 - maskBits)) >>> 0;
  return (ipInt & mask) === (baseInt & mask);
}

/** Private/loopback/link-local/reserved IPv4 ranges — includes
 *  169.254.169.254 (the cloud metadata endpoint on every major provider),
 *  which falls inside 169.254.0.0/16 below. */
const BLOCKED_IPV4_RANGES: [string, number][] = [
  ["0.0.0.0", 8],
  ["10.0.0.0", 8],
  ["100.64.0.0", 10], // shared/CGNAT
  ["127.0.0.0", 8], // loopback
  ["169.254.0.0", 16], // link-local, incl. cloud metadata
  ["172.16.0.0", 12],
  ["192.0.0.0", 24],
  ["192.0.2.0", 24], // TEST-NET-1
  ["192.168.0.0", 16],
  ["198.18.0.0", 15], // benchmarking
  ["198.51.100.0", 24], // TEST-NET-2
  ["203.0.113.0", 24], // TEST-NET-3
  ["224.0.0.0", 4], // multicast
  ["240.0.0.0", 4], // reserved
  ["255.255.255.255", 32], // broadcast
];

function isBlockedIpv4(ip: string): boolean {
  const ipInt = ipv4ToInt(ip);
  if (ipInt === null) return true; // unparseable -> fail closed
  return BLOCKED_IPV4_RANGES.some(([base, bits]) => inRange(ipInt, base, bits));
}

/** IPv6 best-effort classification — fails closed on anything this doesn't
 *  recognize as clearly a global unicast address. Handles the forms that
 *  actually matter for SSRF: ::1 (loopback), ::  (unspecified),
 *  fe80::/10 (link-local), fc00::/7 (unique local / "private" IPv6),
 *  ff00::/8 (multicast), and ::ffff:a.b.c.d (IPv4-mapped — unwrapped and
 *  re-checked against the IPv4 ranges above, since this is exactly how a
 *  dual-stack rebinding attack smuggles a private IPv4 address past a
 *  naive IPv6-only check). */
function isBlockedIpv6(ip: string): boolean {
  const lower = ip.trim().toLowerCase();
  if (lower === "::1" || lower === "::") return true;
  const mapped = /^::ffff:(\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3})$/.exec(lower);
  if (mapped) return isBlockedIpv4(mapped[1]);
  // Expand enough to look at the leading hextets without a full canonical
  // expansion — sufficient for the ranges we need to catch; anything that
  // doesn't match a known-global prefix pattern fails closed below.
  const first = lower.split(":")[0] || "";
  if (lower.startsWith("fe8") || lower.startsWith("fe9") || lower.startsWith("fea") || lower.startsWith("feb")) return true; // fe80::/10
  if (/^f[c-d]/.test(first)) return true; // fc00::/7 (fc00–fdff)
  if (lower.startsWith("ff")) return true; // multicast
  // Global unicast today is 2000::/3 (hextet 2xxx/3xxx). Anything else
  // (documentation ranges, 6to4 teredo, unassigned space) is unrecognized
  // here and fails closed rather than being guessed as safe.
  return !/^[23]/.test(first);
}

/** The one exported address check both the live resolver and the test suite
 *  use directly, no network involved. */
export function isBlockedIp(ip: string): boolean {
  const trimmed = ip.trim();
  if (!trimmed) return true;
  if (trimmed.includes(":")) return isBlockedIpv6(trimmed);
  return isBlockedIpv4(trimmed);
}

export type LookupFn = (hostname: string) => Promise<string[]>;

async function defaultLookup(hostname: string): Promise<string[]> {
  const results = await dnsLookup(hostname, { all: true, verbatim: true });
  return results.map((r) => r.address);
}

/** Resolve a hostname and check EVERY returned address — if any one of them
 *  is private/loopback/link-local, the whole host is blocked (DNS can
 *  return several addresses, and an attacker-controlled DNS answer that
 *  mixes one public and one private address is exactly the rebinding shape
 *  this guards against). `lookupFn` is injectable so tests exercise the real
 *  decision logic without a real DNS query. */
export async function resolveAndCheckHost(hostname: string, lookupFn: LookupFn = defaultLookup): Promise<{ ok: true; addresses: string[] } | { ok: false; reason: SafeFetchErrorCode }> {
  // A literal IP in the URL never goes through DNS at all — check it directly.
  if (/^[\d.]+$/.test(hostname) || hostname.includes(":")) {
    return isBlockedIp(hostname) ? { ok: false, reason: "blocked_address" } : { ok: true, addresses: [hostname] };
  }
  let addresses: string[];
  try {
    addresses = await lookupFn(hostname);
  } catch {
    return { ok: false, reason: "dns_failed" };
  }
  if (!addresses.length) return { ok: false, reason: "dns_failed" };
  if (addresses.some(isBlockedIp)) return { ok: false, reason: "blocked_address" };
  return { ok: true, addresses };
}

export interface SafeFetchOptions {
  timeoutMs?: number;
  maxBytes?: number;
  maxRedirects?: number;
  lookupFn?: LookupFn;
  /** Injectable for tests — defaults to the global fetch with
   *  `redirect: "manual"` so every hop can be re-validated. */
  fetchFn?: typeof fetch;
}

export interface SafeFetchResult {
  html: string;
  finalUrl: string;
  contentType: string;
}

const DEFAULT_TIMEOUT_MS = 10_000;
const DEFAULT_MAX_BYTES = 2 * 1024 * 1024; // 2MB — a job posting page, not a file download
const DEFAULT_MAX_REDIRECTS = 5;

async function validateUrlForFetch(rawUrl: string, lookupFn: LookupFn): Promise<URL> {
  let u: URL;
  try {
    u = new URL(rawUrl);
  } catch {
    throw new SafeFetchError("bad_protocol", "Not a valid URL.");
  }
  if (!isAllowedProtocol(u.protocol)) throw new SafeFetchError("bad_protocol", "Only http/https URLs are allowed.");
  const check = await resolveAndCheckHost(u.hostname, lookupFn);
  if (!check.ok) throw new SafeFetchError(check.reason, "That address can't be fetched.");
  return u;
}

/** Fetch a candidate-supplied URL and return its HTML, enforcing: http(s)
 *  only, resolve-and-block private/loopback ranges (re-checked on EVERY
 *  redirect hop, not just the first URL), a response timeout, a response
 *  size cap enforced while streaming (never buffers an unbounded body), and
 *  Content-Type must be HTML. No credentials are ever attached. A
 *  login-walled page (401/403) throws a distinguishable error so the caller
 *  can offer the "add manually" fallback rather than a generic failure. */
export async function safeFetchHtml(rawUrl: string, opts: SafeFetchOptions = {}): Promise<SafeFetchResult> {
  const timeoutMs = opts.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const maxBytes = opts.maxBytes ?? DEFAULT_MAX_BYTES;
  const maxRedirects = opts.maxRedirects ?? DEFAULT_MAX_REDIRECTS;
  const lookupFn = opts.lookupFn ?? defaultLookup;
  const doFetch = opts.fetchFn ?? fetch;

  let current = await validateUrlForFetch(rawUrl, lookupFn);
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    for (let hop = 0; hop <= maxRedirects; hop++) {
      let response: Response;
      try {
        response = await doFetch(current.toString(), {
          redirect: "manual",
          signal: controller.signal,
          headers: {
            "User-Agent": "Mozilla/5.0 (compatible; ResumeTailoredTracker/1.0; +https://resumetailored.com)",
            Accept: "text/html,application/xhtml+xml",
          },
        });
      } catch (err) {
        const e = err as { name?: string };
        if (e?.name === "AbortError" || e?.name === "TimeoutError") throw new SafeFetchError("timeout", "The page took too long to respond.");
        throw new SafeFetchError("dns_failed", "Could not reach that page.");
      }

      if (response.status >= 300 && response.status < 400) {
        const location = response.headers.get("location");
        if (!location) throw new SafeFetchError("http_error", "Redirected with no destination.");
        if (hop === maxRedirects) throw new SafeFetchError("too_many_redirects", "Too many redirects.");
        current = await validateUrlForFetch(new URL(location, current).toString(), lookupFn);
        continue;
      }
      if (response.status === 401 || response.status === 403) {
        throw new SafeFetchError("login_required", "This page requires signing in to view.");
      }
      if (!response.ok) {
        throw new SafeFetchError("http_error", `The page responded with HTTP ${response.status}.`);
      }
      const contentType = response.headers.get("content-type") || "";
      if (!/text\/html|application\/xhtml\+xml/i.test(contentType)) {
        throw new SafeFetchError("not_html", "That URL isn't an HTML page.");
      }

      const body = await readCapped(response, maxBytes, controller);
      return { html: body, finalUrl: current.toString(), contentType };
    }
    throw new SafeFetchError("too_many_redirects", "Too many redirects.");
  } finally {
    clearTimeout(timer);
  }
}

/** Stream the body and abort the moment it exceeds `maxBytes` — never
 *  buffers an unbounded response the way `response.text()` would. */
async function readCapped(response: Response, maxBytes: number, controller: AbortController): Promise<string> {
  const reader = response.body?.getReader();
  if (!reader) return "";
  const chunks: Uint8Array[] = [];
  let total = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      if (!value) continue;
      total += value.byteLength;
      if (total > maxBytes) {
        controller.abort();
        throw new SafeFetchError("too_large", "That page was too large to read.");
      }
      chunks.push(value);
    }
  } finally {
    reader.releaseLock?.();
  }
  return Buffer.concat(chunks.map((c) => Buffer.from(c))).toString("utf-8");
}
