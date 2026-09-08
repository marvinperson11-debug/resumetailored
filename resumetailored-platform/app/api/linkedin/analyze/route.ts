import { NextResponse } from "next/server";
import { auth } from "@clerk/nextjs/server";
import { isPro } from "@/lib/plan";
import { getAnthropic, CLAUDE_MODEL, isProviderUnavailable } from "@/lib/ai";
import { extractJson } from "@/lib/tools-ai";
import { buildLinkedinAnalyzePrompt, normalizeAnalysis } from "@/lib/linkedin-ai";
import { saveLinkedinAnalysis } from "@/lib/linkedin-store";

export const runtime = "nodejs";
export const maxDuration = 60;

/** Score + diagnose a LinkedIn profile. Available to all signed-in users; free
 *  users get the score + top 3 suggestions, Pro gets the full list. */
export async function POST(req: Request) {
  const { userId } = await auth();
  if (!userId) return NextResponse.json({ error: "not_signed_in", message: "Please sign in." }, { status: 401 });

  const body = (await req.json().catch(() => ({}))) as { profileText?: string; jobTitle?: string };
  const profileText = (body.profileText || "").trim();
  if (profileText.length < 40) return NextResponse.json({ error: "Paste your LinkedIn profile (headline + About at least)." }, { status: 400 });
  if (profileText.length > 20000) return NextResponse.json({ error: "That's too long — paste your profile text only." }, { status: 400 });

  const anthropic = getAnthropic();
  if (!anthropic) return NextResponse.json({ error: "not_configured", message: "AI is not configured." }, { status: 501 });

  const pro = await isPro();
  const { system, user } = buildLinkedinAnalyzePrompt(profileText, body.jobTitle);
  try {
    const msg = await anthropic.messages.create({ model: CLAUDE_MODEL, max_tokens: 1600, system, messages: [{ role: "user", content: user }] });
    const block = msg.content[0];
    const analysis = normalizeAnalysis(extractJson(block && block.type === "text" ? block.text : ""));
    if (!analysis) throw new Error("bad analysis json");

    // Persist the full analysis for history/stats (best-effort).
    saveLinkedinAnalysis(userId, { profileText, score: analysis.score, suggestions: analysis.suggestions });

    // Free tier: score + keyword insights + only the top 3 suggestions.
    const total = analysis.suggestions.length;
    if (!pro) {
      analysis.suggestions = analysis.suggestions.slice(0, 3);
    }
    return NextResponse.json({ analysis, pro, suggestionsTotal: total, suggestionsTruncated: !pro && total > 3 });
  } catch (err) {
    const e = err as { status?: number };
    const message = e?.status === 429 ? "AI is rate limited. Try again shortly." : isProviderUnavailable(err) ? "AI is temporarily busy. Try again in 30 seconds." : "Analysis failed. Please try again.";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
