import { NextResponse } from "next/server";
import { requireEmployerId } from "@/lib/employer-auth";
import { getEmployerProfile, saveEmployerProfile } from "@/lib/employer-store";

export const runtime = "nodejs";

/** GET the company profile (null until onboarding is completed). */
export async function GET() {
  const employerId = await requireEmployerId();
  if (!employerId) return NextResponse.json({ error: "forbidden" }, { status: 403 });
  const profile = await getEmployerProfile(employerId);
  return NextResponse.json({ profile });
}

/** POST onboarding / profile edit. */
export async function POST(req: Request) {
  const employerId = await requireEmployerId();
  if (!employerId) return NextResponse.json({ error: "forbidden" }, { status: 403 });
  const body = (await req.json().catch(() => ({}))) as {
    companyName?: string;
    companyWebsite?: string;
    industry?: string;
    companySize?: string;
  };
  const companyName = (body.companyName || "").trim();
  if (companyName.length < 2) return NextResponse.json({ error: "Company name is required." }, { status: 400 });
  const ok = await saveEmployerProfile(employerId, {
    companyName,
    companyWebsite: (body.companyWebsite || "").trim(),
    industry: (body.industry || "").trim(),
    companySize: (body.companySize || "").trim(),
  });
  if (!ok) return NextResponse.json({ error: "Could not save. Is the database configured?" }, { status: 500 });
  const profile = await getEmployerProfile(employerId);
  return NextResponse.json({ ok: true, profile });
}
