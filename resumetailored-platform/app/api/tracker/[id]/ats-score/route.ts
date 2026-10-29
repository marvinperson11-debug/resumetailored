import { NextResponse } from "next/server";
import { auth } from "@clerk/nextjs/server";
import { getTrackedApplication, recordAtsScore, listAtsScores } from "@/lib/tracker-store";
import { scoreResume } from "@/lib/ats-scan";

export const runtime = "nodejs";
export const maxDuration = 30;

/** GET — score history for one tracked application (Combined Build,
 *  Section 4) — score-only link: this never reinterprets the ATS checker's
 *  own verdict, just stores a reference to each run. */
export async function GET(_req: Request, { params }: { params: { id: string } }) {
  const { userId } = await auth();
  if (!userId) return NextResponse.json({ error: "not_signed_in" }, { status: 401 });
  const application = await getTrackedApplication(userId, params.id);
  if (!application) return NextResponse.json({ error: "not found" }, { status: 404 });
  const history = await listAtsScores(userId, params.id);
  return NextResponse.json({ history });
}

/** POST — run an ATS scan against this tracked application's posting (or an
 *  explicitly-supplied job posting text) and attach the result to its score
 *  history. Offered again whenever the candidate's resume changes — the
 *  route itself doesn't try to detect that; the client re-calls this after
 *  an edit. */
export async function POST(req: Request, { params }: { params: { id: string } }) {
  const { userId } = await auth();
  if (!userId) return NextResponse.json({ error: "not_signed_in" }, { status: 401 });
  const application = await getTrackedApplication(userId, params.id);
  if (!application) return NextResponse.json({ error: "not found" }, { status: 404 });

  const body = (await req.json().catch(() => ({}))) as { resumeText?: string; resumeId?: string; resumeLabel?: string; jobPosting?: string };
  const resumeText = (body.resumeText || "").trim();
  const jobPosting = (body.jobPosting || application.description || "").trim();
  if (!resumeText) return NextResponse.json({ error: "resumeText is required." }, { status: 400 });
  if (!jobPosting) return NextResponse.json({ error: "No job posting text to score against — this application has no description captured, and none was supplied." }, { status: 400 });

  try {
    const result = await scoreResume(resumeText, jobPosting);
    const entry = await recordAtsScore(userId, params.id, { score: result.score, verdict: result.verdict, resumeId: body.resumeId || null, resumeLabel: body.resumeLabel || null });
    if (!entry) return NextResponse.json({ error: "Could not save this score." }, { status: 500 });
    return NextResponse.json({ entry, result });
  } catch (e) {
    console.error("[tracker ats-score] scoreResume failed", e);
    return NextResponse.json({ error: "Could not score this resume right now. Please try again." }, { status: 502 });
  }
}
