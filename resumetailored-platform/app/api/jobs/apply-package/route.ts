import { NextResponse } from "next/server";
import { auth } from "@clerk/nextjs/server";
import { isPro } from "@/lib/plan";
import { getAnthropic, CLAUDE_MODEL, isProviderUnavailable } from "@/lib/ai";
import { extractJson } from "@/lib/tools-ai";
import { buildApplyPackagePrompt } from "@/lib/jobs-ai";

export const runtime = "nodejs";
export const maxDuration = 90;

/** One-click apply package: tailored resume + cover letter + LinkedIn note.
 *  PRO ONLY. */
export async function POST(req: Request) {
  const { userId } = await auth();
  if (!userId) return NextResponse.json({ error: "not_signed_in", message: "Please sign in." }, { status: 401 });
  if (!(await isPro())) return NextResponse.json({ error: "pro_required", message: "The apply package is a Pro feature." }, { status: 402 });

  const body = (await req.json().catch(() => ({}))) as { resume?: string; jobDescription?: string };
  const resume = (body.resume || "").trim();
  const jobDescription = (body.jobDescription || "").trim();
  if (resume.length < 40) return NextResponse.json({ error: "Add your resume first." }, { status: 400 });
  if (jobDescription.length < 20) return NextResponse.json({ error: "No job selected." }, { status: 400 });

  const anthropic = getAnthropic();
  if (!anthropic) return NextResponse.json({ error: "not_configured", message: "AI is not configured." }, { status: 501 });

  const { system, user } = buildApplyPackagePrompt(resume, jobDescription);
  try {
    const msg = await anthropic.messages.create({ model: CLAUDE_MODEL, max_tokens: 3000, system, messages: [{ role: "user", content: user }] });
    const block = msg.content[0];
    const pkg = extractJson<{ resume?: string; coverLetter?: string; linkedInMessage?: string }>(block && block.type === "text" ? block.text : "");
    if (!pkg || !pkg.resume || !pkg.coverLetter) throw new Error("bad package");
    return NextResponse.json({
      resume: String(pkg.resume).trim(),
      coverLetter: String(pkg.coverLetter).trim(),
      linkedInMessage: String(pkg.linkedInMessage || "").trim(),
    });
  } catch (err) {
    const message = isProviderUnavailable(err) ? "AI is temporarily busy. Try again in 30 seconds." : "Could not build the apply package. Please try again.";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
