import { NextResponse } from "next/server";
import { auth } from "@clerk/nextjs/server";
import { listApplications, createApplication, type ApplicationInput } from "@/lib/applications";

export const runtime = "nodejs";

/** List the signed-in user's applications (newest first). */
export async function GET() {
  const { userId } = await auth();
  if (!userId) return NextResponse.json({ error: "not_signed_in" }, { status: 401 });
  const applications = await listApplications(userId);
  return NextResponse.json({ applications });
}

/** Create one application. */
export async function POST(req: Request) {
  const { userId } = await auth();
  if (!userId) return NextResponse.json({ error: "not_signed_in" }, { status: 401 });
  const body = (await req.json().catch(() => ({}))) as ApplicationInput;
  if (!body.company?.trim() || !body.role?.trim()) {
    return NextResponse.json({ error: "Company and role are required." }, { status: 400 });
  }
  const application = await createApplication(userId, body);
  if (!application) return NextResponse.json({ error: "Could not save (is the applications table set up?)." }, { status: 500 });
  return NextResponse.json({ application });
}
