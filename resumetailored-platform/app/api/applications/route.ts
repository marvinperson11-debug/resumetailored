import { NextResponse } from "next/server";
import { auth } from "@clerk/nextjs/server";
import { listApplications } from "@/lib/applications";

export const runtime = "nodejs";

/** List the signed-in user's LEGACY applications (read-only — superseded by
 *  /api/tracker; see supabase/migrations/0081_migrate_legacy_applications.sql). */
export async function GET() {
  const { userId } = await auth();
  if (!userId) return NextResponse.json({ error: "not_signed_in" }, { status: 401 });
  const applications = await listApplications(userId);
  return NextResponse.json({ applications });
}

/** The legacy applications table is read-only from app code now — the
 *  Kanban tracker (/api/tracker) is the one surface that writes application
 *  data. See supabase/migrations/0081_migrate_legacy_applications.sql. */
export async function POST() {
  return NextResponse.json({ error: "legacy_read_only", message: "This list no longer accepts new entries — use the Tracker." }, { status: 410 });
}
