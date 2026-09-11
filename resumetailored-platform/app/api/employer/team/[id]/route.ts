import { NextResponse } from "next/server";
import { randomUUID } from "crypto";
import { employerContext } from "@/lib/employer-auth";
import { updateMember, removeMember } from "@/lib/employer-store";
import { isTeamRole } from "@/lib/employer-ai";

export const runtime = "nodejs";

/** PATCH — change a member's role, or `{ action: "resend" }` to mint a fresh
 *  invite token (returns a new join link). Owner rows are protected in the store. */
export async function PATCH(req: Request, { params }: { params: { id: string } }) {
  const ctx = await employerContext();
  if (!ctx) return NextResponse.json({ error: "forbidden" }, { status: 403 });
  if (ctx.access.plan !== "employer") return NextResponse.json({ error: "Only the account owner can manage the team." }, { status: 403 });
  const id = Number(params.id);
  if (!Number.isFinite(id)) return NextResponse.json({ error: "bad id" }, { status: 400 });

  const b = (await req.json().catch(() => ({}))) as { role?: string; action?: string };

  if (b.action === "resend") {
    const token = randomUUID();
    const ok = await updateMember(ctx.employerId, id, { inviteToken: token });
    if (!ok) return NextResponse.json({ error: "Could not resend." }, { status: 500 });
    const origin = new URL(req.url).origin;
    return NextResponse.json({ ok: true, link: `${origin}/join?token=${token}&company=${encodeURIComponent(ctx.employerId)}` });
  }

  if (!isTeamRole(b.role) || b.role === "owner") return NextResponse.json({ error: "bad role" }, { status: 400 });
  const ok = await updateMember(ctx.employerId, id, { role: b.role });
  if (!ok) return NextResponse.json({ error: "Could not update the role." }, { status: 500 });
  return NextResponse.json({ ok: true });
}

/** DELETE — remove a team member (the owner row is protected in the store). */
export async function DELETE(_req: Request, { params }: { params: { id: string } }) {
  const ctx = await employerContext();
  if (!ctx) return NextResponse.json({ error: "forbidden" }, { status: 403 });
  if (ctx.access.plan !== "employer") return NextResponse.json({ error: "Only the account owner can manage the team." }, { status: 403 });
  const id = Number(params.id);
  if (!Number.isFinite(id)) return NextResponse.json({ error: "bad id" }, { status: 400 });
  const ok = await removeMember(ctx.employerId, id);
  if (!ok) return NextResponse.json({ error: "Could not remove." }, { status: 500 });
  return NextResponse.json({ ok: true });
}
