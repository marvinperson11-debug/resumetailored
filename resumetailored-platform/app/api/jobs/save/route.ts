import { NextResponse } from "next/server";
import { auth } from "@clerk/nextjs/server";
import { saveJob, listSavedJobs } from "@/lib/job-saves";

export const runtime = "nodejs";

/** List the user's saved jobs ("My Jobs"). */
export async function GET() {
  const { userId } = await auth();
  if (!userId) return NextResponse.json({ error: "not_signed_in" }, { status: 401 });
  const jobs = await listSavedJobs(userId);
  return NextResponse.json({ jobs });
}

/** Save one job. */
export async function POST(req: Request) {
  const { userId } = await auth();
  if (!userId) return NextResponse.json({ error: "not_signed_in" }, { status: 401 });
  const body = (await req.json().catch(() => ({}))) as { job?: Record<string, unknown> };
  if (!body.job || typeof body.job !== "object") return NextResponse.json({ error: "No job data." }, { status: 400 });
  const ok = await saveJob(userId, body.job);
  return NextResponse.json({ ok, persisted: ok });
}
