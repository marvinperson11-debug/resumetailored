import { NextResponse } from "next/server";
import { auth } from "@clerk/nextjs/server";
import { getAnthropic, CLAUDE_MODEL, isProviderUnavailable } from "@/lib/ai";
import { buildDecoderPrompt, extractJson, type JobDecode } from "@/lib/tools-ai";

export const runtime = "nodejs";
export const maxDuration = 60;

/** Decoder Key — decodes a job posting into must-have / nice-to-have / red
 *  flags / hidden requirements / culture signals. ALWAYS FREE (no Pro gate). */
export async function POST(req: Request) {
  const { userId } = await auth();
  if (!userId) return NextResponse.json({ error: "not_signed_in", message: "Please sign in." }, { status: 401 });

  const body = (await req.json().catch(() => ({}))) as { jobText?: string };
  const jobText = (body.jobText || "").trim();
  if (jobText.length < 40) return NextResponse.json({ error: "Paste the job posting (a few sentences at least)." }, { status: 400 });
  if (jobText.length > 15000) return NextResponse.json({ error: "Please keep it under ~15,000 characters." }, { status: 400 });

  const anthropic = getAnthropic();
  if (!anthropic) return NextResponse.json({ error: "not_configured", message: "AI is not configured." }, { status: 501 });

  const { system, user } = buildDecoderPrompt(jobText);
  try {
    const msg = await anthropic.messages.create({ model: CLAUDE_MODEL, max_tokens: 1800, system, messages: [{ role: "user", content: user }] });
    const block = msg.content[0];
    const result = extractJson<JobDecode>(block && block.type === "text" ? block.text : "");
    if (!result) throw new Error("bad decode json");
    return NextResponse.json({ result });
  } catch (err) {
    const message = isProviderUnavailable(err) ? "AI is temporarily busy. Try again in 30 seconds." : "Something went wrong. Please try again.";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
