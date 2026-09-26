import { NextResponse } from "next/server";
import { employeeContext } from "@/lib/employee-auth";
import { listFeedPosts, createFeedPost } from "@/lib/feed-store";
import { isFeedPostKind, normalizeFeedBody } from "@/lib/feed-hub";
import { logActivityForEmployer } from "@/lib/notifications-store";

export const runtime = "nodejs";

/** GET the shared team feed — same wall the employer side sees. */
export async function GET() {
  const ctx = await employeeContext();
  if (!ctx) return NextResponse.json({ error: "forbidden" }, { status: 403 });
  const posts = await listFeedPosts(ctx.employerId);
  return NextResponse.json({ posts });
}

/** POST a new post/issue/win from the employee side. Body: { kind, body }. */
export async function POST(req: Request) {
  const ctx = await employeeContext();
  if (!ctx) return NextResponse.json({ error: "forbidden" }, { status: 403 });
  const b = (await req.json().catch(() => ({}))) as { kind?: string; body?: string };
  const kind = isFeedPostKind(b.kind) ? b.kind : "post";
  const body = normalizeFeedBody(b.body);
  if (!body) return NextResponse.json({ error: "Write something first." }, { status: 400 });

  const post = await createFeedPost(ctx.employerId, {
    authorKind: "employee",
    authorId: String(ctx.employeeId),
    authorName: ctx.employee.name || "Employee",
    kind,
    body,
  });
  if (!post) return NextResponse.json({ error: "Could not post." }, { status: 500 });

  logActivityForEmployer(ctx.employerId, {
    eventType: "feed_post",
    title: `${ctx.employee.name || "An employee"} posted on the team feed`,
    body: post.body.slice(0, 200),
    link: "/employer/employees?tab=feed",
  }).catch(() => {});

  return NextResponse.json({ post });
}
