import { NextResponse } from "next/server";
import { auth } from "@clerk/nextjs/server";
import { rateLimit } from "@/lib/rate-limit";
import { createVacancy } from "@/lib/docs/store";

export const runtime = "nodejs";

/** Saves the vacancy a document run is for. Employer + position here are the ONLY source the cover letter's employer name comes from. */
export async function POST(req: Request) {
  const limited = rateLimit(req, "vacancies");
  if (limited) return limited;
  const { userId } = await auth();
  if (!userId) return NextResponse.json({ error: "Sign in required." }, { status: 401 });
  const b = (await req.json().catch(() => ({}))) as { employer?: unknown; position?: unknown; description?: unknown; employerAddress?: unknown };
  const employer = typeof b.employer === "string" ? b.employer.trim() : "";
  const position = typeof b.position === "string" ? b.position.trim() : "";
  const description = typeof b.description === "string" ? b.description : "";
  if (!employer || !position) return NextResponse.json({ error: "Employer and position are required." }, { status: 400 });
  if (employer.length > 200 || position.length > 200 || description.length > 50000) return NextResponse.json({ error: "Too long." }, { status: 400 });
  const addr = Array.isArray(b.employerAddress) ? b.employerAddress.filter((x): x is string => typeof x === "string").slice(0, 5) : undefined;
  const v = await createVacancy(userId, { employer, position, description, employerAddress: addr });
  if (!v) return NextResponse.json({ error: "Could not save the vacancy." }, { status: 503 });
  return NextResponse.json({ vacancy: v });
}
