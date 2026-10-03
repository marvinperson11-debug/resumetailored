import { NextResponse } from "next/server";
import { rateLimit } from "@/lib/rate-limit";
import { auth } from "@clerk/nextjs/server";
import { isIndividualPro } from "@/lib/plan";
import { getAnthropic, CLAUDE_MODEL, isProviderUnavailable } from "@/lib/ai";
import { extractJson } from "@/lib/tools-ai";
import { buildDecodePrompt, normalizeDecode, isDepth, type Depth } from "@/lib/decoder-ai";
import { saveDecoderAnalysis, decodesToday } from "@/lib/decoder-store";

export const runtime = "nodejs";
export const maxDuration = 60;

const FREE_PER_DAY = 3;

/** Current decode quota for the signed-in user, so the UI can show "2 of 3 left"
 *  before the wall is ever hit. `limit: null` = unlimited (Pro). */
export async function GET() {
  const { userId } = await auth();
  if (!userId) return NextResponse.json({ error: "not_signed_in", message: "Please sign in." }, { status: 401 });
  const pro = await isIndividualPro();
  const used = pro ? 0 : await decodesToday(userId);
  return NextResponse.json({ pro, used, limit: pro ? null : FREE_PER_DAY });
}

/** Decode a job posting. Free: 3 basic decodes/day. Deep decode is Pro. */
export async function POST(req: Request) {
  const limited = rateLimit(req, "decoder-decode");
  if (limited) return limited;
  const { userId } = await auth();
  if (!userId) return NextResponse.json({ error: "not_signed_in", message: "Please sign in." }, { status: 401 });

  const body = (await req.json().catch(() => ({}))) as { jobDescription?: string; jobText?: string; depth?: string; resume?: string; jobTitle?: string; company?: string };
  const jobDescription = (body.jobDescription || body.jobText || "").trim();
  if (jobDescription.length < 40) return NextResponse.json({ error: "Paste the job posting (a few sentences at least)." }, { status: 400 });

  const pro = await isIndividualPro();
  const depth: Depth = isDepth(body.depth) ? body.depth : "basic";

  // Deep decode is Pro-only.
  if (depth === "deep" && !pro) {
    return NextResponse.json({ error: "pro_required", message: "Deep decode is a Pro feature." }, { status: 402 });
  }
  // Free tier: 1 decode per day.
  let usedBefore = 0;
  if (!pro) {
    const used = (usedBefore = await decodesToday(userId));
    if (used >= FREE_PER_DAY) {
      return NextResponse.json({ error: "daily_limit", message: `Daily limit reached — Free covers ${FREE_PER_DAY} decodes per day. Upgrade to Pro for unlimited.`, used, limit: FREE_PER_DAY }, { status: 402 });
    }
  }

  const anthropic = getAnthropic();
  if (!anthropic) return NextResponse.json({ error: "not_configured", message: "AI is not configured." }, { status: 501 });

  const resume = (body.resume || "").trim();
  const hasResume = depth === "deep" && resume.length >= 40;
  const { system, user } = buildDecodePrompt(jobDescription, depth, hasResume, resume);
  try {
    // Output budgets are generous on purpose: a 900-token cap truncated the JSON
    // mid-object for longer postings, which surfaced as a generic failure. One
    // silent retry covers the occasional malformed reply.
    const maxTokens = depth === "deep" ? 4000 : 1800;
    let result = null;
    for (let attempt = 0; attempt < 2 && !result; attempt++) {
      const msg = await anthropic.messages.create({ model: CLAUDE_MODEL, max_tokens: maxTokens, system, messages: [{ role: "user", content: user }] });
      const block = msg.content[0];
      result = normalizeDecode(extractJson(block && block.type === "text" ? block.text : ""), depth);
    }
    if (!result) throw new Error("bad decode");
    saveDecoderAnalysis(userId, { jobTitle: body.jobTitle, company: body.company, jobDescription, depth, analysis: result });
    return NextResponse.json({ result, pro, depth, used: pro ? 0 : Math.min(FREE_PER_DAY, usedBefore + 1), limit: pro ? null : FREE_PER_DAY });
  } catch (err) {
    const message = isProviderUnavailable(err) ? "AI is temporarily busy. Try again in 30 seconds." : "Could not decode that posting. Please try again.";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
