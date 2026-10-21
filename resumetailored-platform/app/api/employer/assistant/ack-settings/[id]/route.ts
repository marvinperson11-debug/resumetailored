import { NextResponse } from "next/server";
import { employerContext } from "@/lib/employer-auth";
import { canAssistantMutate } from "@/lib/employer-plan";
import { setAckSettingEnabled } from "@/lib/assistant-ack-settings";

export const runtime = "nodejs";

/** PATCH `{ enabled: boolean }` — the toggle in the "simple list + toggle"
 *  management UI. This only ever flips `enabled`; changing the TEXT of a
 *  template is never done here — that's a new set_ack_template pending
 *  action, approved the same way as the original (see
 *  lib/assistant-ack-settings.ts `createAckSetting`'s header comment for
 *  why there is deliberately no in-place template edit). */
export async function PATCH(req: Request, { params }: { params: { id: string } }) {
  const ctx = await employerContext();
  if (!ctx) return NextResponse.json({ error: "forbidden" }, { status: 401 });
  if (!canAssistantMutate(ctx.access)) {
    return NextResponse.json({ error: "scale_required", message: "This needs the Scale plan." }, { status: 403 });
  }

  const b = (await req.json().catch(() => ({}))) as { enabled?: unknown };
  if (typeof b.enabled !== "boolean") return NextResponse.json({ error: "enabled (boolean) is required" }, { status: 400 });

  const ok = await setAckSettingEnabled(ctx.employerId, params.id, b.enabled);
  if (!ok) return NextResponse.json({ error: "not_found" }, { status: 404 });
  return NextResponse.json({ ok: true, enabled: b.enabled });
}
