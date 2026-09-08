import { NextResponse } from "next/server";
import { auth } from "@clerk/nextjs/server";
import { isPro } from "@/lib/plan";
import { getAnthropic, CLAUDE_MODEL, isProviderUnavailable } from "@/lib/ai";
import { extractJson } from "@/lib/tools-ai";
import { buildLinkedinOptimizePrompt, isOptimizeSection } from "@/lib/linkedin-ai";

export const runtime = "nodejs";
export const maxDuration = 60;

/** Generate optimized LinkedIn copy for one section. PRO ONLY. Headline returns
 *  3 options; About/Experience return one full rewrite. */
export async function POST(req: Request) {
  const { userId } = await auth();
  if (!userId) return NextResponse.json({ error: "not_signed_in", message: "Please sign in." }, { status: 401 });

  if (!(await isPro())) {
    return NextResponse.json({ error: "pro_required", message: "AI-optimized copy is a Pro feature." }, { status: 402 });
  }

  const body = (await req.json().catch(() => ({}))) as { profileText?: string; section?: string; jobTitle?: string };
  const profileText = (body.profileText || "").trim();
  if (profileText.length < 40) return NextResponse.json({ error: "Analyze a profile first." }, { status: 400 });
  if (!isOptimizeSection(body.section)) return NextResponse.json({ error: "Unknown section." }, { status: 400 });

  const anthropic = getAnthropic();
  if (!anthropic) return NextResponse.json({ error: "not_configured", message: "AI is not configured." }, { status: 501 });

  const { system, user } = buildLinkedinOptimizePrompt(profileText, body.section, body.jobTitle);
  try {
    const msg = await anthropic.messages.create({ model: CLAUDE_MODEL, max_tokens: 1800, system, messages: [{ role: "user", content: user }] });
    const block = msg.content[0];
    const parsed = extractJson<{ options?: unknown }>(block && block.type === "text" ? block.text : "");
    const options = Array.isArray(parsed?.options) ? parsed!.options.map((o) => String(o).trim()).filter(Boolean) : [];
    if (!options.length) throw new Error("no options");
    return NextResponse.json({ options });
  } catch (err) {
    const e = err as { status?: number };
    const message = e?.status === 429 ? "AI is rate limited. Try again shortly." : isProviderUnavailable(err) ? "AI is temporarily busy. Try again in 30 seconds." : "Could not generate copy. Please try again.";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
