import { NextResponse } from "next/server";

function allowedOrigins(): string[] {
  return (process.env.EXTENSION_ORIGINS ?? "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
}

/** Build CORS headers for an extension-facing request, echoing the origin
 *  only if it is on the allowlist. */
export function corsHeaders(origin: string | null): Record<string, string> {
  const allow = allowedOrigins();
  const ok = origin && (allow.includes(origin) || allow.includes("*"));
  return {
    "Access-Control-Allow-Origin": ok ? origin! : "null",
    "Access-Control-Allow-Methods": "GET,POST,OPTIONS",
    "Access-Control-Allow-Headers": "Authorization,Content-Type",
    "Access-Control-Max-Age": "600",
    Vary: "Origin",
  };
}

export function preflight(origin: string | null): NextResponse {
  return new NextResponse(null, { status: 204, headers: corsHeaders(origin) });
}

export function withCors(
  res: NextResponse,
  origin: string | null
): NextResponse {
  const h = corsHeaders(origin);
  for (const [k, v] of Object.entries(h)) res.headers.set(k, v);
  return res;
}
