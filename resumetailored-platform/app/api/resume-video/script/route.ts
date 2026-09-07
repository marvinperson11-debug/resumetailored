import { NextResponse } from "next/server";
import { auth } from "@clerk/nextjs/server";
import { getAnthropic, CLAUDE_MODEL, isProviderUnavailable } from "@/lib/ai";
import { buildVideoScriptPrompt } from "@/lib/video-ai";

export const runtime = "nodejs";
export const maxDuration = 60;

/** Generate a first-person video-resume script. Available to all signed-in
 *  users (Pro gates only the voiceover + download). */
export async function POST(req: Request) {
  const { userId } = await auth();
  if (!userId) return NextResponse.json({ error: "not_signed_in", message: "Please sign in." }, { status: 401 });

  const body = (await req.json().catch(() => ({}))) as { resume?: string; template?: string };
  const resume = (body.resume || "").trim();
  if (resume.length < 40) return NextResponse.json({ error: "Paste your resume (a few sentences at least)." }, { status: 400 });

  const anthropic = getAnthropic();
  if (!anthropic) return NextResponse.json({ error: "not_configured", message: "AI is not configured." }, { status: 501 });

  const { system, user } = buildVideoScriptPrompt(resume, body.template || "professional");
  try {
    const msg = await anthropic.messages.create({ model: CLAUDE_MODEL, max_tokens: 700, system, messages: [{ role: "user", content: user }] });
    const block = msg.content[0];
    const script = (block && block.type === "text" ? block.text : "").trim();
    if (!script) throw new Error("empty script");
    return NextResponse.json({ script });
  } catch (err) {
    const message = isProviderUnavailable(err) ? "AI is temporarily busy. Try again in 30 seconds." : "Could not generate the script. Please try again.";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
