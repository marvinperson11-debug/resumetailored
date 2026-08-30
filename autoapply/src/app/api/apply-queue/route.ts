// GET  /api/apply-queue  — the user's queue, read live from the main
//                          ResumeTailored app (the source of truth).
// POST /api/apply-queue  — add a job to the main app's queue.
//
// Auth: NextAuth session (dashboard) OR a bearer ExtensionToken (extension).
// The main-app service secret stays server-side — the browser/extension never
// sees it; they talk only to this proxy.

import { NextResponse } from "next/server";
import { z } from "zod";
import { resolveUserEmail } from "@/lib/api-identity";
import { fetchMainQueue, addToMainQueue, bridgeConfigured } from "@/lib/main-app-queue";
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
  if (!email) return json({ error: "unauthorized", message: "Sign in to view your queue." }, 401, origin);
  if (!bridgeConfigured()) return json({ error: "bridge_unconfigured", items: [], count: 0, synced: false }, 200, origin);
  try {
    const items = await fetchMainQueue(email);
    return json({ items, count: items.length, synced: true }, 200, origin);
  } catch {
    return json({ error: "main_app_unreachable", items: [], count: 0, synced: false }, 502, origin);
  }
}

const addSchema = z.object({
  jobUrl: z.string().url().max(2000),
  jobTitle: z.string().max(300).optional(),
  companyName: z.string().max(300).optional(),
  jobBoard: z.string().max(60).optional(),
});

export async function POST(req: Request) {
  const origin = req.headers.get("origin");
  const email = await resolveUserEmail(req);
  if (!email) return json({ error: "unauthorized", message: "Sign in to add to your queue." }, 401, origin);
  if (!bridgeConfigured()) return json({ error: "bridge_unconfigured" }, 503, origin);
  const parsed = addSchema.safeParse(await req.json().catch(() => ({})));
  if (!parsed.success) return json({ error: "invalid_body", details: parsed.error.flatten() }, 400, origin);
  try {
    const item = await addToMainQueue(email, parsed.data);
    return json({ item, synced: true }, 201, origin);
  } catch {
    return json({ error: "main_app_unreachable" }, 502, origin);
  }
}
