import { NextResponse } from "next/server";
import { auth } from "@clerk/nextjs/server";
import { isPro } from "@/lib/plan";
import { getAnthropic, CLAUDE_MODEL, isProviderUnavailable } from "@/lib/ai";
import { extractJson } from "@/lib/tools-ai";
import { buildComparePrompt, normalizeCompare } from "@/lib/decoder-ai";

export const runtime = "nodejs";
export const maxDuration = 60;

/** Compare two job postings side-by-side. PRO ONLY. */
export async function POST(req: Request) {
  const { userId } = await auth();
  if (!userId) return NextResponse.json({ error: "not_signed_in", message: "Please sign in." }, { status: 401 });
  if (!(await isPro())) return NextResponse.json({ error: "pro_required", message: "Compare mode is a Pro feature." }, { status: 402 });

  const body = (await req.json().catch(() => ({}))) as { jobA?: string; jobB?: string; resume?: string };
  const jobA = (body.jobA || "").trim();
  const jobB = (body.jobB || "").trim();
  if (jobA.length < 40 || jobB.length < 40) return NextResponse.json({ error: "Paste both job postings to compare." }, { status: 400 });

  const anthropic = getAnthropic();
  if (!anthropic) return NextResponse.json({ error: "not_configured", message: "AI is not configured." }, { status: 501 });

  const { system, user } = buildComparePrompt(jobA, jobB, (body.resume || "").trim());
  try {
    const msg = await anthropic.messages.create({ model: CLAUDE_MODEL, max_tokens: 1800, system, messages: [{ role: "user", content: user }] });
    const block = msg.content[0];
    const result = normalizeCompare(extractJson(block && block.type === "text" ? block.text : ""));
    if (!result) throw new Error("bad compare");
    return NextResponse.json({ result });
  } catch (err) {
    const message = isProviderUnavailable(err) ? "AI is temporarily busy. Try again in 30 seconds." : "Could not compare those postings. Please try again.";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
