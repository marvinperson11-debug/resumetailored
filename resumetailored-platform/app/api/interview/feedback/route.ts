import { NextResponse } from "next/server";
import { rateLimit } from "@/lib/rate-limit";
import { auth } from "@clerk/nextjs/server";
import { isIndividualPro } from "@/lib/plan";
import { getAnthropic, CLAUDE_MODEL, isProviderUnavailable } from "@/lib/ai";
import { extractJson } from "@/lib/tools-ai";
import { buildFeedbackPrompt, normalizeFeedback, isInterviewType } from "@/lib/interview-ai";
import { guestReserve, withGuestCookie, type GuestGate } from "@/lib/guest";

export const runtime = "nodejs";
export const maxDuration = 60;

/** Score + coach a typed answer. All signed-in users; Pro gets detailed feedback
 *  (multiple strengths/improvements + a model answer), free gets a basic score +
 *  one strength + one improvement. */
async function handle(req: Request) {
  const limited = rateLimit(req, "interview-feedback");
  if (limited) return limited;
  const { userId } = await auth(); // no userId = a guest: 1 use a day (lib/guest.ts), reserved below after validation

  const body = (await req.json().catch(() => ({}))) as { question?: string; answer?: string; type?: string; jobDescription?: string; resume?: string };
  const question = (body.question || "").trim();
  const answer = (body.answer || "").trim();
  if (!question) return NextResponse.json({ error: "No question selected." }, { status: 400 });
  if (answer.length < 5) return NextResponse.json({ error: "Give the coach a real answer to review." }, { status: 400 });

  const anthropic = getAnthropic();
  if (!anthropic) return NextResponse.json({ error: "not_configured", message: "AI is not configured." }, { status: 501 });

  const type = isInterviewType(body.type) ? body.type : "behavioral";
  const detailed = await isIndividualPro();
  const { system, user } = buildFeedbackPrompt({
    question, answer, type,
    jobDescription: (body.jobDescription || "").trim(),
    resume: (body.resume || "").trim(),
    detailed,
  });
  let gate: GuestGate | null = null;
  if (!userId) {
    const reserved = await guestReserve(req, "interview-feedback");
    if (!reserved.ok) return reserved.response;
    gate = reserved.gate;
  }

  try {
    const msg = await anthropic.messages.create({ model: CLAUDE_MODEL, max_tokens: detailed ? 900 : 400, system, messages: [{ role: "user", content: user }] });
    await gate?.recordUsage(msg.usage);
    const block = msg.content[0];
    const feedback = normalizeFeedback(extractJson(block && block.type === "text" ? block.text : ""));
    if (!feedback) throw new Error("bad feedback json");
    // Enforce the free-tier shape server-side (belt-and-suspenders).
    if (!detailed) {
      feedback.strengths = feedback.strengths.slice(0, 1);
      feedback.improvements = feedback.improvements.slice(0, 1);
      feedback.modelAnswer = "";
    }
    return NextResponse.json({ feedback, pro: detailed });
  } catch (err) {
    await gate?.refund();
    const message = isProviderUnavailable(err) ? "AI is temporarily busy. Try again in 30 seconds." : "Could not score that answer. Please try again.";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

export const POST = withGuestCookie(handle);
