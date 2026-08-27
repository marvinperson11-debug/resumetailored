import { NextResponse } from "next/server";
import { z } from "zod";
import { getSessionUserId } from "@/lib/auth";
import { prisma } from "@/lib/prisma";

type Params = { params: { id: string } };

// GET /api/jobs/:id — full record (including prepared output) for the owner
export async function GET(_req: Request, { params }: Params) {
  const userId = await getSessionUserId();
  if (!userId) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const job = await prisma.jobApplication.findFirst({
    where: { id: params.id, userId },
  });
  if (!job) return NextResponse.json({ error: "not_found" }, { status: 404 });
  return NextResponse.json({ job });
}

const patchSchema = z.object({
  status: z.enum(["NEW", "PREPARED", "APPLIED"]).optional(),
});

// PATCH /api/jobs/:id — currently used to move status (e.g. mark APPLIED)
export async function PATCH(req: Request, { params }: Params) {
  const userId = await getSessionUserId();
  if (!userId) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const parsed = patchSchema.safeParse(await req.json().catch(() => ({})));
  if (!parsed.success) {
    return NextResponse.json({ error: "invalid_body" }, { status: 400 });
  }

  const existing = await prisma.jobApplication.findFirst({
    where: { id: params.id, userId },
    select: { id: true },
  });
  if (!existing) return NextResponse.json({ error: "not_found" }, { status: 404 });

  const data: Record<string, unknown> = {};
  if (parsed.data.status) {
    data.status = parsed.data.status;
    if (parsed.data.status === "APPLIED") data.appliedAt = new Date();
  }

  const job = await prisma.jobApplication.update({ where: { id: params.id }, data });
  return NextResponse.json({ job });
}

// DELETE /api/jobs/:id
export async function DELETE(_req: Request, { params }: Params) {
  const userId = await getSessionUserId();
  if (!userId) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const existing = await prisma.jobApplication.findFirst({
    where: { id: params.id, userId },
    select: { id: true },
  });
  if (!existing) return NextResponse.json({ error: "not_found" }, { status: 404 });

  await prisma.jobApplication.delete({ where: { id: params.id } });
  return NextResponse.json({ ok: true });
}
