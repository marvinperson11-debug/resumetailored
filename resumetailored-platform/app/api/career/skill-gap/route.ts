import { NextResponse } from "next/server";
import { rateLimit } from "@/lib/rate-limit";
import { auth } from "@clerk/nextjs/server";
import { getAnthropic, CLAUDE_MODEL, isProviderUnavailable } from "@/lib/ai";
import { extractJson } from "@/lib/tools-ai";
import { buildSkillGapPrompt, normalizeSkillGap } from "@/lib/career-ai";
import { guestReserve, withGuestCookie, type GuestGate } from "@/lib/guest";

export const runtime = "nodejs";
export const maxDuration = 60;

/** AI skill-gap analysis. Open to every signed-in user. */
async function handle(req: Request) {
  const limited = rateLimit(req, "career-skill-gap");
  if (limited) return limited;
  const { userId } = await auth(); // no userId = a guest: 1 use a day (lib/guest.ts), reserved below after validation

  const b = (await req.json().catch(() => ({}))) as { currentSkills?: string[]; targetRole?: string; industry?: string };
  if (!(b.targetRole || "").trim()) return NextResponse.json({ error: "Set a target role first." }, { status: 400 });

  const anthropic = getAnthropic();
  if (!anthropic) return NextResponse.json({ error: "not_configured", message: "AI is not configured." }, { status: 501 });

  const { system, user } = buildSkillGapPrompt({
    currentSkills: Array.isArray(b.currentSkills) ? b.currentSkills.map(String) : [],
    targetRole: (b.targetRole || "").trim(), industry: (b.industry || "").trim(),
  });
  let gate: GuestGate | null = null;
  if (!userId) {
    const reserved = await guestReserve(req, "career-skill-gap");
    if (!reserved.ok) return reserved.response;
    gate = reserved.gate;
  }

  try {
    const msg = await anthropic.messages.create({ model: CLAUDE_MODEL, max_tokens: 1800, system, messages: [{ role: "user", content: user }] });
    await gate?.recordUsage(msg.usage);
    const block = msg.content[0];
    const gap = normalizeSkillGap(extractJson(block && block.type === "text" ? block.text : ""));
    if (!gap) throw new Error("bad gap");
    return NextResponse.json({ ...gap });
  } catch (err) {
    await gate?.refund();
    const message = isProviderUnavailable(err) ? "AI is temporarily busy. Try again in 30 seconds." : "Could not analyze the skill gap. Please try again.";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

export const POST = withGuestCookie(handle);
