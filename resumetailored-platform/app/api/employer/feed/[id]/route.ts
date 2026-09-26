import { NextResponse } from "next/server";
import { employerContext } from "@/lib/employer-auth";
import { setFeedPostPinned, setFeedPostResolved } from "@/lib/feed-store";

export const runtime = "nodejs";

/** PATCH pin (employer-only) and/or resolve a feed post. Body:
 *  { pinned?: boolean, resolved?: boolean }. */
export async function PATCH(req: Request, { params }: { params: { id: string } }) {
  const ctx = await employerContext();
  if (!ctx) return NextResponse.json({ error: "forbidden" }, { status: 403 });
  const id = Number(params.id);
  if (!Number.isFinite(id) || id <= 0) return NextResponse.json({ error: "not_found" }, { status: 404 });

  const b = (await req.json().catch(() => ({}))) as { pinned?: boolean; resolved?: boolean };
  let ok = true;
  if (typeof b.pinned === "boolean") ok = (await setFeedPostPinned(ctx.employerId, id, b.pinned)) && ok;
  if (typeof b.resolved === "boolean") ok = (await setFeedPostResolved(ctx.employerId, id, b.resolved)) && ok;
  if (!ok) return NextResponse.json({ error: "Could not update the post." }, { status: 500 });
  return NextResponse.json({ ok: true });
}
