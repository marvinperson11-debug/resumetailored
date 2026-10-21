import { NextResponse } from "next/server";
import { employerContext } from "@/lib/employer-auth";
import { canAssistantMutate } from "@/lib/employer-plan";
import { listAckSettings } from "@/lib/assistant-ack-settings";

export const runtime = "nodejs";

/** GET every standing auto-acknowledgment template this employer has ever
 *  approved (enabled or not) — the "simple list + toggle" management
 *  surface on the assistant panel. Scale tier and up, same gate as the
 *  mutating tools themselves (lib/employer-plan.ts `canAssistantMutate`) —
 *  there is nothing to manage below that tier since the tool is never
 *  offered to draft one. */
export async function GET() {
  const ctx = await employerContext();
  if (!ctx) return NextResponse.json({ error: "forbidden" }, { status: 401 });
  if (!canAssistantMutate(ctx.access)) {
    return NextResponse.json({ error: "scale_required", message: "This needs the Scale plan." }, { status: 403 });
  }

  const settings = await listAckSettings(ctx.employerId);
  return NextResponse.json({
    settings: settings.map((s) => ({
      id: s.id,
      jobId: s.jobId,
      template: s.template,
      enabled: s.enabled,
      actorEmail: s.actorEmail,
      createdAt: s.createdAt,
    })),
  });
}
