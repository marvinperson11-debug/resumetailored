import { NextResponse } from "next/server";
import { requireEmployerId } from "@/lib/employer-auth";
import { listShortlists, createShortlist } from "@/lib/employer-collab-store";

export const runtime = "nodejs";

/** GET — all shortlists for this employer, with member counts. */
export async function GET() {
  const employerId = await requireEmployerId();
  if (!employerId) return NextResponse.json({ error: "forbidden" }, { status: 403 });
  const shortlists = await listShortlists(employerId);
  return NextResponse.json({ shortlists });
}

/** POST — create a shortlist. Body: { name, description? }. */
export async function POST(req: Request) {
  const employerId = await requireEmployerId();
  const b = (await req.json().catch(() => ({}))) as { name?: string; description?: string };
  console.log("[shortlists POST] userId:", employerId, "name:", String(b.name || "").slice(0, 80));
  if (!employerId) return NextResponse.json({ error: "forbidden" }, { status: 403 });
  if (!(b.name || "").trim()) return NextResponse.json({ error: "Give the shortlist a name." }, { status: 400 });
  try {
    const shortlist = await createShortlist(employerId, b.name || "", b.description || "");
    if (!shortlist) return NextResponse.json({ error: "Could not create the shortlist. Please try again." }, { status: 500 });
    return NextResponse.json({ shortlist });
  } catch (error) {
    console.error("[shortlists POST] error:", error);
    return NextResponse.json({ error: "Could not create the shortlist. Please try again." }, { status: 500 });
  }
}
