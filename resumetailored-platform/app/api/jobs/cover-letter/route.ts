import { NextResponse } from "next/server";
import { rateLimit } from "@/lib/rate-limit";
import { auth } from "@clerk/nextjs/server";
import { getAnthropic, CLAUDE_MODEL, isProviderUnavailable } from "@/lib/ai";
import { buildCoverLetterPrompt } from "@/lib/jobs-ai";
import { guestReserve, withGuestCookie, type GuestGate } from "@/lib/guest";

export const runtime = "nodejs";
export const maxDuration = 60;

/** Generate a tailored cover letter for one job. Open to every signed-in user. */
async function handle(req: Request) {
  const limited = rateLimit(req, "jobs-cover-letter");
  if (limited) return limited;
  const { userId } = await auth(); // no userId = a guest: 1 use a day (lib/guest.ts), reserved below after validation

  const body = (await req.json().catch(() => ({}))) as { resume?: string; jobDescription?: string };
  const resume = (body.resume || "").trim();
  const jobDescription = (body.jobDescription || "").trim();
  if (resume.length < 40) return NextResponse.json({ error: "Add your resume first." }, { status: 400 });
  if (jobDescription.length < 20) return NextResponse.json({ error: "No job selected." }, { status: 400 });

  const anthropic = getAnthropic();
  if (!anthropic) return NextResponse.json({ error: "not_configured", message: "AI is not configured." }, { status: 501 });

  const { system, user } = buildCoverLetterPrompt(resume, jobDescription);
  let gate: GuestGate | null = null;
  if (!userId) {
    const reserved = await guestReserve(req, "jobs-cover-letter");
    if (!reserved.ok) return reserved.response;
    gate = reserved.gate;
  }

  try {
    const msg = await anthropic.messages.create({ model: CLAUDE_MODEL, max_tokens: 1200, system, messages: [{ role: "user", content: user }] });
    await gate?.recordUsage(msg.usage);
    const block = msg.content[0];
    const coverLetter = (block && block.type === "text" ? block.text : "").trim();
    if (!coverLetter) throw new Error("empty");
    return NextResponse.json({ coverLetter });
  } catch (err) {
    await gate?.refund();
    const message = isProviderUnavailable(err) ? "AI is temporarily busy. Try again in 30 seconds." : "Could not generate the cover letter. Please try again.";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

export const POST = withGuestCookie(handle);
