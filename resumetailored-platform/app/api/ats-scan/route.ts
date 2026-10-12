import { rateLimit } from "@/lib/rate-limit";
import { NextResponse } from "next/server";
import { auth } from "@clerk/nextjs/server";
import { scoreResume } from "@/lib/ats-scan";
import { recordGeneration } from "@/lib/generations";
import { guestReserve, withGuestCookie, type GuestGate } from "@/lib/guest";

export const runtime = "nodejs";
export const maxDuration = 60;

/**
 * Scores a resume against a job description and surfaces matched/missing
 * keywords + rewrite suggestions. Ported from the old site's `/api/ats-scan`
 * (same prompt, model, and keyword-overlap fallback). The ATS scanner is a
 * free-tier feature and unlimited for everyone — no per-day cap (only the
 * Pro-only tools, Resume Video and Web Studio, are gated).
 *
 * Signed-out visitors get 3 scans a day (lib/guest.ts), on text capped like the tailor's.
 */
async function handle(req: Request) {
  const limited = rateLimit(req, "ats-scan");
  if (limited) return limited;
  const { userId } = await auth(); // no userId = a guest, gated below after validation

  const body = (await req.json().catch(() => ({}))) as { resume?: string; jobPosting?: string };
  const { resume, jobPosting } = body;
  if (!resume || !jobPosting) {
    return NextResponse.json({ error: "Resume and job posting are required." }, { status: 400 });
  }

  let gate: GuestGate | null = null;
  if (!userId) {
    // The signed-in path has no size cap; a guest's text is capped like the tailor's.
    if (resume.length > 50000 || jobPosting.length > 50000) {
      return NextResponse.json({ error: "Text is too long. Please paste the resume/job posting text only." }, { status: 400 });
    }
    const reserved = await guestReserve(req, "ats-scan");
    if (!reserved.ok) return reserved.response;
    gate = reserved.gate;
  }

  // What Claude cost, captured so a guest's spend is recorded (awaited, below) even when the
  // reply then fails to parse.
  let usage: { input_tokens?: number | null; output_tokens?: number | null } | null = null;
  try {
    const result = await scoreResume(resume, jobPosting, (u) => {
      usage = u;
    });
    if (gate) {
      await gate.recordUsage(usage);
      // The local keyword-overlap fallback costs nothing and is not what the guest came for: give the scan back.
      if (!usage) await gate.refund();
    }
    if (userId) await recordGeneration(userId, "ats", result);
    return NextResponse.json(gate ? { ...result, ...(await gate.usage()) } : result);
  } catch (err) {
    if (gate) {
      await gate.recordUsage(usage);
      await gate.refund();
    }
    const e = err as { message?: string };
    console.error("ATS scan error:", e?.message || err);
    return NextResponse.json({ error: "Analysis failed. Please try again." }, { status: 500 });
  }
}

export const POST = withGuestCookie(handle);
