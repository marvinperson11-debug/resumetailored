import { NextResponse } from "next/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * TEMPORARY debug route — no auth. Echoes exactly which host headers the server
 * received, to diagnose subdomain routing through the Cloudflare Worker.
 * Remove once subdomain routing is confirmed working.
 */
export async function GET(req: Request) {
  return NextResponse.json(
    {
      host: req.headers.get("host"),
      xForwardedHost: req.headers.get("x-forwarded-host"),
      xOriginalHost: req.headers.get("x-original-host"),
      pathname: new URL(req.url).pathname,
    },
    { headers: { "Cache-Control": "no-store, no-cache, must-revalidate" } }
  );
}
