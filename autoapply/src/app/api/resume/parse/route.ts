import { NextResponse } from "next/server";
import { z } from "zod";
import { getSessionUserId } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { parseResumeText } from "@/lib/ai";

export const maxDuration = 60;

const bodySchema = z.object({
  // The client extracts text from the uploaded PDF/DOCX (pdf.js) and posts it.
  resumeText: z.string().min(30, "resume_text_too_short").max(40000),
  save: z.boolean().optional().default(true),
});

export async function POST(req: Request) {
  const userId = await getSessionUserId();
  if (!userId) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const parsed = bodySchema.safeParse(await req.json().catch(() => ({})));
  if (!parsed.success) {
    return NextResponse.json({ error: "invalid_body", details: parsed.error.flatten() }, { status: 400 });
  }

  let resumeData;
  try {
    resumeData = await parseResumeText(parsed.data.resumeText);
  } catch (err) {
    console.error("resume parse failed", err);
    return NextResponse.json({ error: "parse_failed" }, { status: 502 });
  }

  if (parsed.data.save) {
    await prisma.user.update({ where: { id: userId }, data: { resumeData: resumeData as object } });
  }

  return NextResponse.json({ resumeData });
}
