import { NextResponse } from "next/server";
import { getSessionUserId } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { createExtensionToken } from "@/lib/extension-auth";

// GET /api/extension-token — list token metadata (never the raw token)
export async function GET() {
  const userId = await getSessionUserId();
  if (!userId) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const tokens = await prisma.extensionToken.findMany({
    where: { userId, revokedAt: null },
    select: { id: true, label: true, lastUsedAt: true, createdAt: true },
    orderBy: { createdAt: "desc" },
  });
  return NextResponse.json({ tokens });
}

// POST /api/extension-token — mint a new token; raw value returned ONCE
export async function POST(req: Request) {
  const userId = await getSessionUserId();
  if (!userId) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const body = await req.json().catch(() => ({}));
  const raw = await createExtensionToken(userId, typeof body?.label === "string" ? body.label : undefined);
  return NextResponse.json({ token: raw }, { status: 201 });
}

// DELETE /api/extension-token?id=... — revoke
export async function DELETE(req: Request) {
  const userId = await getSessionUserId();
  if (!userId) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const id = new URL(req.url).searchParams.get("id");
  if (!id) return NextResponse.json({ error: "missing_id" }, { status: 400 });

  await prisma.extensionToken.updateMany({
    where: { id, userId },
    data: { revokedAt: new Date() },
  });
  return NextResponse.json({ ok: true });
}
