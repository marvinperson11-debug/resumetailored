import { NextResponse } from "next/server";
import { auth } from "@clerk/nextjs/server";
import { getAnthropic, CLAUDE_MODEL, isProviderUnavailable } from "@/lib/ai";
import { isPro } from "@/lib/plan";
import { buildLinkedinPrompt } from "@/lib/tools-ai";

export const runtime = "nodejs";
export const maxDuration = 60;

/** LinkedIn Optimizer — rewrites headline + about + experience bullets for a
 *  target role (Pro adds skill suggestions + keyword-density analysis). */
export async function POST(req: Request) {
  const { userId } = await auth();
  if (!userId) return NextResponse.json({ error: "not_signed_in", message: "Please sign in." }, { status: 401 });

  const body = (await req.json().catch(() => ({}))) as { profileText?: string; targetRole?: string };
  const profileText = (body.profileText || "").trim();
  const targetRole = (body.targetRole || "").trim();
  if (!profileText) return NextResponse.json({ error: "Paste your LinkedIn headline + About section." }, { status: 400 });
  if (!targetRole) return NextResponse.json({ error: "Add the target role or job you're aiming for." }, { status: 400 });
  if (profileText.length > 20000) return NextResponse.json({ error: "That's too long — paste your profile text only." }, { status: 400 });

  const anthropic = getAnthropic();
  if (!anthropic) return NextResponse.json({ error: "not_configured", message: "AI is not configured." }, { status: 501 });

  const pro = await isPro();
  const { system, user } = buildLinkedinPrompt({ profileText, targetRole, pro });
  try {
    const msg = await anthropic.messages.create({ model: CLAUDE_MODEL, max_tokens: 4096, system, messages: [{ role: "user", content: user }] });
    const block = msg.content[0];
    const result = block && block.type === "text" ? block.text : "";
    return NextResponse.json({ result, pro });
  } catch (err) {
    const e = err as { status?: number };
    const message = e?.status === 429 ? "AI is rate limited. Try again shortly." : isProviderUnavailable(err) ? "AI is temporarily busy. Try again in 30 seconds." : "Optimization failed. Please try again.";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
