// GET /api/apply-queue/count — { count, queued } from the main ResumeTailored
// app's queue. Used by the dashboard banner and the extension popup badge.
// Auth: NextAuth session OR a bearer ExtensionToken.

import { NextResponse } from "next/server";
import { resolveUserEmail } from "@/lib/api-identity";
import { mainQueueCount, bridgeConfigured } from "@/lib/main-app-queue";
import { corsHeaders, preflight } from "@/lib/cors";

export const dynamic = "force-dynamic";

function json(body: unknown, status: number, origin: string | null) {
  return NextResponse.json(body, { status, headers: corsHeaders(origin) });
}

export function OPTIONS(req: Request) {
  return preflight(req.headers.get("origin"));
}

export async function GET(req: Request) {
  const origin = req.headers.get("origin");
  const email = await resolveUserEmail(req);
  if (!email) return json({ error: "unauthorized", count: 0, queued: 0 }, 401, origin);
  if (!bridgeConfigured()) return json({ count: 0, queued: 0, synced: false }, 200, origin);
  try {
    const c = await mainQueueCount(email);
    return json({ ...c, synced: true }, 200, origin);
  } catch {
    return json({ error: "main_app_unreachable", count: 0, queued: 0, synced: false }, 502, origin);
  }
}
