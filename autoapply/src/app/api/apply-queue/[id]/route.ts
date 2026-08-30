// PATCH /api/apply-queue/:id — write a status change back to the main
// ResumeTailored app's queue, keeping the two in sync. `:id` is the main app's
// queue item id. Accepts either a local status (NEW/PREPARED/APPLIED) or a main
// status; both are mapped to the main enum by main-app-queue.

import { NextResponse } from "next/server";
import { z } from "zod";
import { resolveUserEmail } from "@/lib/api-identity";
import { updateMainStatus, bridgeConfigured } from "@/lib/main-app-queue";
import { corsHeaders, preflight } from "@/lib/cors";

export const dynamic = "force-dynamic";

function json(body: unknown, status: number, origin: string | null) {
  return NextResponse.json(body, { status, headers: corsHeaders(origin) });
}

export function OPTIONS(req: Request) {
  return preflight(req.headers.get("origin"));
}

const patchSchema = z.object({ status: z.string().min(1).max(40) });

export async function PATCH(req: Request, { params }: { params: { id: string } }) {
  const origin = req.headers.get("origin");
  const email = await resolveUserEmail(req);
  if (!email) return json({ error: "unauthorized" }, 401, origin);
  if (!bridgeConfigured()) return json({ error: "bridge_unconfigured" }, 503, origin);
  const parsed = patchSchema.safeParse(await req.json().catch(() => ({})));
  if (!parsed.success) return json({ error: "invalid_body" }, 400, origin);
  try {
    const ok = await updateMainStatus(email, params.id, parsed.data.status);
    if (!ok) return json({ error: "sync_failed" }, 502, origin);
    return json({ success: true }, 200, origin);
  } catch {
    return json({ error: "main_app_unreachable" }, 502, origin);
  }
}
