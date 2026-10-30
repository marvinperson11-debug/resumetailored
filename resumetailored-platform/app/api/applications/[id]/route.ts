import { NextResponse } from "next/server";

export const runtime = "nodejs";

/** The legacy applications table is read-only from app code now — edit/delete
 *  through the Tracker (/api/tracker/[id]) instead. See
 *  supabase/migrations/0081_migrate_legacy_applications.sql. */
export async function PATCH() {
  return NextResponse.json({ error: "legacy_read_only", message: "This list no longer accepts edits — use the Tracker." }, { status: 410 });
}

export async function DELETE() {
  return NextResponse.json({ error: "legacy_read_only", message: "This list no longer accepts deletes — use the Tracker." }, { status: 410 });
}
