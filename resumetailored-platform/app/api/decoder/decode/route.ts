import { NextResponse } from "next/server";
import { rateLimit } from "@/lib/rate-limit";
import { auth } from "@clerk/nextjs/server";
import { isIndividualPro } from "@/lib/plan";
import { getAnthropic, CLAUDE_MODEL, isProviderUnavailable } from "@/lib/ai";
import { extractJson } from "@/lib/tools-ai";
import { buildDecodePrompt, normalizeDecode, isDepth, type Depth } from "@/lib/decoder-ai";
import { saveDecoderAnalysis, decodesToday } from "@/lib/decoder-store";
import { guestReserve, guestUsedToday, withGuestCookie, type GuestGate } from "@/lib/guest";

export const runtime = "nodejs";
export const maxDuration = 60;

const FREE_PER_DAY = 3;

/** Current decode quota for the signed-in user, so the UI can show "2 of 3 left"
 *  before the wall is ever hit. `limit: null` = unlimited (Pro). */
async function getHandler(req: Request) {
  const { userId } = await auth();
  // A guest has 1 decode a day (lib/guest.ts); report it the same way.
  if (!userId) return NextResponse.json({ pro: false, used: await guestUsedToday(req, "decoder-decode"), limit: 1, guest: true });
  const pro = await isIndividualPro();
  const used = pro ? 0 : await decodesToday(userId);
  return NextResponse.json({ pro, used, limit: pro ? null : FREE_PER_DAY });
}

/** Decode a job posting. Free: 3 basic decodes/day (a guest gets 1: lib/guest.ts). Deep decode is Pro. */
async function postHandler(req: Request) {
  const limited = rateLimit(req, "decoder-decode");
  if (limited) return limited;
  const { userId } = await auth(); // no userId = a guest

  const body = (await req.json().catch(() => ({}))) as { jobDescription?: string; jobText?: string; depth?: string; resume?: string; jobTitle?: string; company?: string };
  const jobDescription = (body.jobDescription || body.jobText || "").trim();
  if (jobDescription.length < 40) return NextResponse.json({ error: "Paste the job posting (a few sentences at least)." }, { status: 400 });

  const pro = await isIndividualPro();
  const depth: Depth = isDepth(body.depth) ? body.depth : "basic";

  // Deep decode is Pro-only.
  if (depth === "deep" && !pro) {
    return NextResponse.json({ error: "pro_required", message: "Deep decode is a Pro feature." }, { status: 402 });
  }
  // Free tier: 3 decodes per day (counted per account; a guest's single decode is reserved below).
  let usedBefore = 0;
  if (!pro && userId) {
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
  let gate: GuestGate | null = null;
  if (!userId) {
    const reserved = await guestReserve(req, "decoder-decode");
    if (!reserved.ok) return reserved.response;
    gate = reserved.gate;
  }
  try {
    // Output budgets are generous on purpose: a 900-token cap truncated the JSON
    // mid-object for longer postings, which surfaced as a generic failure. One
    // silent retry covers the occasional malformed reply.
    const maxTokens = depth === "deep" ? 4000 : 1800;
    let result = null;
    for (let attempt = 0; attempt < 2 && !result; attempt++) {
      const msg = await anthropic.messages.create({ model: CLAUDE_MODEL, max_tokens: maxTokens, system, messages: [{ role: "user", content: user }] });
      await gate?.recordUsage(msg.usage);
      const block = msg.content[0];
      result = normalizeDecode(extractJson(block && block.type === "text" ? block.text : ""), depth);
    }
    if (!result) throw new Error("bad decode");
    if (userId) saveDecoderAnalysis(userId, { jobTitle: body.jobTitle, company: body.company, jobDescription, depth, analysis: result });
    if (gate) return NextResponse.json({ result, pro, depth, used: 1, limit: 1, guest: true });
    return NextResponse.json({ result, pro, depth, used: pro ? 0 : Math.min(FREE_PER_DAY, usedBefore + 1), limit: pro ? null : FREE_PER_DAY });
  } catch (err) {
    await gate?.refund();
    const message = isProviderUnavailable(err) ? "AI is temporarily busy. Try again in 30 seconds." : "Could not decode that posting. Please try again.";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

export const GET = withGuestCookie(getHandler);
export const POST = withGuestCookie(postHandler);
