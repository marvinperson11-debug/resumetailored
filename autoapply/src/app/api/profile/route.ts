import { NextResponse } from "next/server";
import { z } from "zod";
import { getSessionUserId } from "@/lib/auth";
import { prisma } from "@/lib/prisma";

export async function GET() {
  const userId = await getSessionUserId();
  if (!userId) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { id: true, email: true, name: true, resumeData: true, preferences: true },
  });
  return NextResponse.json({ user });
}

const preferencesSchema = z.object({
  role: z.string().max(120).optional(),
  location: z.string().max(120).optional(),
  workMode: z.enum(["remote", "hybrid", "onsite", "any"]).optional(),
  minSalary: z.number().int().nonnegative().optional(),
});

const bodySchema = z.object({
  // resumeData is stored as-is (already validated at parse time)
  resumeData: z.any().optional(),
  preferences: preferencesSchema.optional(),
});

export async function PUT(req: Request) {
  const userId = await getSessionUserId();
  if (!userId) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const parsed = bodySchema.safeParse(await req.json().catch(() => ({})));
  if (!parsed.success) {
    return NextResponse.json({ error: "invalid_body", details: parsed.error.flatten() }, { status: 400 });
  }

  const data: Record<string, unknown> = {};
  if (parsed.data.resumeData !== undefined) data.resumeData = parsed.data.resumeData;
  if (parsed.data.preferences !== undefined) data.preferences = parsed.data.preferences;

  const user = await prisma.user.update({
    where: { id: userId },
    data,
    select: { id: true, resumeData: true, preferences: true },
  });
  return NextResponse.json({ user });
}
