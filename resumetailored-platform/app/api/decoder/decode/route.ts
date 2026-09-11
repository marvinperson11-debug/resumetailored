import { NextResponse } from "next/server";
import { auth } from "@clerk/nextjs/server";
import { isPro } from "@/lib/plan";
import { getAnthropic, CLAUDE_MODEL, isProviderUnavailable } from "@/lib/ai";
import { extractJson } from "@/lib/tools-ai";
import { buildDecodePrompt, normalizeDecode, isDepth, type Depth } from "@/lib/decoder-ai";
import { saveDecoderAnalysis, decodesToday } from "@/lib/decoder-store";

export const runtime = "nodejs";
export const maxDuration = 60;

const FREE_PER_DAY = 1;

/** Decode a job posting. Free: 1 basic decode/day. Deep decode is Pro. */
export async function POST(req: Request) {
  const { userId } = await auth();
  if (!userId) return NextResponse.json({ error: "not_signed_in", message: "Please sign in." }, { status: 401 });

  const body = (await req.json().catch(() => ({}))) as { jobDescription?: string; jobText?: string; depth?: string; resume?: string; jobTitle?: string; company?: string };
  const jobDescription = (body.jobDescription || body.jobText || "").trim();
  if (jobDescription.length < 40) return NextResponse.json({ error: "Paste the job posting (a few sentences at least)." }, { status: 400 });

  const pro = await isPro();
  const depth: Depth = isDepth(body.depth) ? body.depth : "basic";

  // Deep decode is Pro-only.
  if (depth === "deep" && !pro) {
    return NextResponse.json({ error: "pro_required", message: "Deep decode is a Pro feature." }, { status: 402 });
  }
  // Free tier: 1 decode per day.
  if (!pro) {
    const used = await decodesToday(userId);
    if (used >= FREE_PER_DAY) {
      return NextResponse.json({ error: "daily_limit", message: "Free covers 1 decode per day. Upgrade to Pro for unlimited." }, { status: 402 });
    }
  }

  const anthropic = getAnthropic();
  if (!anthropic) return NextResponse.json({ error: "not_configured", message: "AI is not configured." }, { status: 501 });

  const resume = (body.resume || "").trim();
  const hasResume = depth === "deep" && resume.length >= 40;
  const { system, user } = buildDecodePrompt(jobDescription, depth, hasResume, resume);
  try {
    const msg = await anthropic.messages.create({ model: CLAUDE_MODEL, max_tokens: depth === "deep" ? 2600 : 900, system, messages: [{ role: "user", content: user }] });
    const block = msg.content[0];
    const result = normalizeDecode(extractJson(block && block.type === "text" ? block.text : ""), depth);
    if (!result) throw new Error("bad decode");
    saveDecoderAnalysis(userId, { jobTitle: body.jobTitle, company: body.company, jobDescription, depth, analysis: result });
    return NextResponse.json({ result, pro, depth });
  } catch (err) {
    const message = isProviderUnavailable(err) ? "AI is temporarily busy. Try again in 30 seconds." : "Could not decode that posting. Please try again.";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
