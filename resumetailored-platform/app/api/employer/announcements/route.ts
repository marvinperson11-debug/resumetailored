import { NextResponse } from "next/server";
import { employerContext } from "@/lib/employer-auth";
import { listAnnouncements, createAnnouncement } from "@/lib/announcements-store";

export const runtime = "nodejs";

/** GET all announcements (active + retired) for the management view. */
export async function GET() {
  const ctx = await employerContext();
  if (!ctx) return NextResponse.json({ error: "forbidden" }, { status: 403 });
  const announcements = await listAnnouncements(ctx.employerId);
  return NextResponse.json({ announcements });
}

/** POST a new announcement, broadcast to every invited employee's portal home. */
export async function POST(req: Request) {
  const ctx = await employerContext();
  if (!ctx) return NextResponse.json({ error: "forbidden" }, { status: 403 });
  const b = (await req.json().catch(() => ({}))) as { title?: string; body?: string; pinned?: boolean };
  const created = await createAnnouncement(ctx.employerId, {
    title: b.title || "",
    body: b.body,
    pinned: b.pinned,
    createdBy: ctx.userId,
  });
  if (!created) return NextResponse.json({ error: "Give the announcement a title." }, { status: 400 });
  return NextResponse.json({ announcement: created });
}
