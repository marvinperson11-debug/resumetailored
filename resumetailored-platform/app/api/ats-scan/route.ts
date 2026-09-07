import { NextResponse } from "next/server";
import { currentUser } from "@clerk/nextjs/server";
import { getAnthropic, buildAtsPrompt, localAtsFallback, isProviderUnavailable, CLAUDE_MODEL, type AtsResult } from "@/lib/ai";
import { getAccess } from "@/lib/plan";
import { consumeUsage } from "@/lib/usage";

export const runtime = "nodejs";
export const maxDuration = 60;

// Free tier: 1 ATS scan per day. Pro: unlimited.
const FREE_DAILY_SCANS = 1;

/**
 * Scores a resume against a job description and surfaces matched/missing
 * keywords + rewrite suggestions. Ported from the old site's `/api/ats-scan`
 * (same prompt, model, and keyword-overlap fallback). Free users get one scan
 * per day (server-enforced via Clerk metadata); Pro is unlimited.
 */
export async function POST(req: Request) {
  const user = await currentUser();
  if (!user) return NextResponse.json({ error: "not_signed_in" }, { status: 401 });

  const body = (await req.json().catch(() => ({}))) as { resume?: string; jobPosting?: string };
  const { resume, jobPosting } = body;
  if (!resume || !jobPosting) {
    return NextResponse.json({ error: "Resume and job posting are required." }, { status: 400 });
  }

  const access = await getAccess();
  const isPro = access.plan === "pro" || access.plan === "employee";

  if (!isPro) {
    const state = await consumeUsage("ats_scan", FREE_DAILY_SCANS);
    if (!state.allowed) {
      return NextResponse.json(
        {
          error: "limit_reached",
          message: "You've used your free ATS scan for today. Upgrade to Pro for unlimited scans.",
          limit: FREE_DAILY_SCANS,
          used: state.used,
        },
        { status: 402 }
      );
    }
  }

  const anthropic = getAnthropic();
  if (!anthropic) {
    // No key configured → still return a useful (deterministic) result.
    return NextResponse.json(localAtsFallback(resume, jobPosting));
  }

  try {
    const msg = await anthropic.messages.create({
      model: CLAUDE_MODEL,
      max_tokens: 1024,
      messages: [{ role: "user", content: buildAtsPrompt(resume, jobPosting) }],
    });
    const block = msg.content[0];
    const raw = (block && block.type === "text" ? block.text : "").trim();
    const jsonMatch = raw.match(/\{[\s\S]*\}/);
    if (!jsonMatch) throw new Error("No JSON in response");
    const result = JSON.parse(jsonMatch[0]) as AtsResult;
    return NextResponse.json(result);
  } catch (err) {
    const e = err as { message?: string };
    console.error("ATS scan error:", e?.message || err);
    if (isProviderUnavailable(err)) {
      return NextResponse.json(localAtsFallback(resume, jobPosting));
    }
    return NextResponse.json({ error: "Analysis failed. Please try again." }, { status: 500 });
  }
}
