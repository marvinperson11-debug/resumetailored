import { NextResponse } from "next/server";
import { employeeContext } from "@/lib/employee-auth";
import { getFeedPost, setFeedPostResolved } from "@/lib/feed-store";
import { canResolveFeedPost } from "@/lib/feed-hub";

export const runtime = "nodejs";

/** PATCH resolve/unresolve — only the post's own author may, from this side
 *  (the employer side can resolve any post). Body: { resolved: boolean }. */
export async function PATCH(req: Request, { params }: { params: { id: string } }) {
  const ctx = await employeeContext();
  if (!ctx) return NextResponse.json({ error: "forbidden" }, { status: 403 });
  const id = Number(params.id);
  if (!Number.isFinite(id) || id <= 0) return NextResponse.json({ error: "not_found" }, { status: 404 });

  const post = await getFeedPost(ctx.employerId, id);
  if (!post) return NextResponse.json({ error: "not_found" }, { status: 404 });
  if (!canResolveFeedPost(post, { kind: "employee", id: String(ctx.employeeId) })) {
    return NextResponse.json({ error: "Only the original poster can resolve this." }, { status: 403 });
  }

  const b = (await req.json().catch(() => ({}))) as { resolved?: boolean };
  if (typeof b.resolved !== "boolean") return NextResponse.json({ error: "bad_request" }, { status: 400 });
  const ok = await setFeedPostResolved(ctx.employerId, id, b.resolved);
  if (!ok) return NextResponse.json({ error: "Could not update the post." }, { status: 500 });
  return NextResponse.json({ ok: true });
}
