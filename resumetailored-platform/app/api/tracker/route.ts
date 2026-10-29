import { NextResponse } from "next/server";
import { auth } from "@clerk/nextjs/server";
import { listTrackedApplications, createTrackedApplication, logEvent, type CreateTrackedApplicationInput } from "@/lib/tracker-store";

export const runtime = "nodejs";

/** GET — list the signed-in candidate's tracked applications (Kanban board
 *  data), newest-updated first. Free tier — no tier/quota check. */
export async function GET() {
  const { userId } = await auth();
  if (!userId) return NextResponse.json({ error: "not_signed_in" }, { status: 401 });
  const applications = await listTrackedApplications(userId);
  return NextResponse.json({ applications });
}

/** POST — manual add (the third clip path). Paste-URL and share-target both
 *  go through POST /api/tracker/clip instead, which extracts fields first;
 *  this route is for a candidate typing everything in by hand, or for
 *  finishing a card the extractor only partly filled. */
export async function POST(req: Request) {
  const { userId } = await auth();
  if (!userId) return NextResponse.json({ error: "not_signed_in" }, { status: 401 });
  const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;
  const jobTitle = String(body.jobTitle || "").trim();
  const company = String(body.company || "").trim();
  if (!jobTitle && !company) return NextResponse.json({ error: "Job title or company is required." }, { status: 400 });

  const input: CreateTrackedApplicationInput = {
    jobTitle,
    company,
    location: typeof body.location === "string" ? body.location : null,
    postingUrl: typeof body.postingUrl === "string" ? body.postingUrl : null,
    description: typeof body.description === "string" ? body.description : null,
    salaryMin: typeof body.salaryMin === "number" ? body.salaryMin : null,
    salaryMax: typeof body.salaryMax === "number" ? body.salaryMax : null,
    source: "manual",
    stage: "Clipped",
  };
  const application = await createTrackedApplication(userId, input);
  if (!application) return NextResponse.json({ error: "Could not save (is the tracker set up?)." }, { status: 500 });
  await logEvent(userId, application.id, "created", { source: "manual" });
  return NextResponse.json({ application });
}
