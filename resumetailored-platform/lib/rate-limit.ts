import { NextResponse } from "next/server";

/**
 * Minimal in-memory per-IP rate limiter for the Platform's AI routes (mirrors
 * the Legacy `tailorLimiter`: 20 requests / 60 s). State is per server
 * instance, which is fine as a cost/abuse floor — it is not a billing meter.
 */
const WINDOW_MS = 60_000;
export const DEFAULT_MAX = 20;

const hits = new Map<string, number[]>();
let lastSweep = 0;

function clientIp(req: Request): string {
  const xff = req.headers.get("x-forwarded-for");
  if (xff) return xff.split(",")[0].trim();
  return req.headers.get("x-real-ip") || req.headers.get("cf-connecting-ip") || "unknown";
}

/** Returns a 429 response when the caller is over the limit for `route`, else null. */
export function rateLimit(req: Request, route: string, max = DEFAULT_MAX): NextResponse | null {
  const now = Date.now();
  if (now - lastSweep > WINDOW_MS) {
    lastSweep = now;
    hits.forEach((v, k) => {
      if (!v.length || now - v[v.length - 1] > WINDOW_MS) hits.delete(k);
    });
  }
  const key = `${route}|${clientIp(req)}`;
  const recent = (hits.get(key) || []).filter((t) => now - t < WINDOW_MS);
  if (recent.length >= max) {
    hits.set(key, recent);
    const retryAfter = Math.max(1, Math.ceil((WINDOW_MS - (now - recent[0])) / 1000));
    return NextResponse.json(
      { error: "rate_limited", message: "Too many requests — please wait a minute and try again." },
      { status: 429, headers: { "Retry-After": String(retryAfter) } }
    );
  }
  recent.push(now);
  hits.set(key, recent);
  return null;
}
