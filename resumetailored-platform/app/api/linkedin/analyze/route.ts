import { NextResponse } from "next/server";
import { rateLimit } from "@/lib/rate-limit";
import { auth } from "@clerk/nextjs/server";
import { isIndividualPro } from "@/lib/plan";
import { getAnthropic, CLAUDE_MODEL, isProviderUnavailable } from "@/lib/ai";
import { extractJson } from "@/lib/tools-ai";
import { buildLinkedinAnalyzePrompt, normalizeAnalysis } from "@/lib/linkedin-ai";
import { saveLinkedinAnalysis } from "@/lib/linkedin-store";
import { guestReserve, withGuestCookie, type GuestGate } from "@/lib/guest";

export const runtime = "nodejs";
export const maxDuration = 60;

/** Score + diagnose a LinkedIn profile. Available to all signed-in users with the
 *  full suggestion list (Pro adds the AI-optimized rewrite at /api/linkedin/optimize). */
async function handle(req: Request) {
  const limited = rateLimit(req, "linkedin-analyze");
  if (limited) return limited;
  const { userId } = await auth(); // no userId = a guest: 1 use a day (lib/guest.ts), reserved below after validation

  const body = (await req.json().catch(() => ({}))) as { profileText?: string; jobTitle?: string };
  const profileText = (body.profileText || "").trim();
  if (profileText.length < 40) return NextResponse.json({ error: "Paste your LinkedIn profile (headline + About at least)." }, { status: 400 });
  if (profileText.length > 20000) return NextResponse.json({ error: "That's too long — paste your profile text only." }, { status: 400 });

  const anthropic = getAnthropic();
  if (!anthropic) return NextResponse.json({ error: "not_configured", message: "AI is not configured." }, { status: 501 });

  const pro = await isIndividualPro();
  const { system, user } = buildLinkedinAnalyzePrompt(profileText, body.jobTitle);
  let gate: GuestGate | null = null;
  if (!userId) {
    const reserved = await guestReserve(req, "linkedin-analyze");
    if (!reserved.ok) return reserved.response;
    gate = reserved.gate;
  }

  try {
    const msg = await anthropic.messages.create({ model: CLAUDE_MODEL, max_tokens: 1600, system, messages: [{ role: "user", content: user }] });
    await gate?.recordUsage(msg.usage);
    const block = msg.content[0];
    const analysis = normalizeAnalysis(extractJson(block && block.type === "text" ? block.text : ""));
    if (!analysis) throw new Error("bad analysis json");

    // Persist the full analysis for history/stats (best-effort).
    if (userId) saveLinkedinAnalysis(userId, { profileText, score: analysis.score, suggestions: analysis.suggestions });

    const total = analysis.suggestions.length;
    return NextResponse.json({ analysis, pro, suggestionsTotal: total, suggestionsTruncated: false });
  } catch (err) {
    await gate?.refund();
    const e = err as { status?: number };
    const message = e?.status === 429 ? "AI is rate limited. Try again shortly." : isProviderUnavailable(err) ? "AI is temporarily busy. Try again in 30 seconds." : "Analysis failed. Please try again.";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

export const POST = withGuestCookie(handle);
