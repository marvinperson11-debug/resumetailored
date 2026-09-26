import { NextResponse } from "next/server";
import { employeeContext } from "@/lib/employee-auth";
import { getFeedPost, listFeedComments, createFeedComment } from "@/lib/feed-store";
import { normalizeFeedBody, MAX_COMMENT_BODY } from "@/lib/feed-hub";
import { logActivityForEmployer } from "@/lib/notifications-store";

export const runtime = "nodejs";

export async function GET(_req: Request, { params }: { params: { id: string } }) {
  const ctx = await employeeContext();
  if (!ctx) return NextResponse.json({ error: "forbidden" }, { status: 403 });
  const postId = Number(params.id);
  const comments = await listFeedComments(ctx.employerId, postId);
  return NextResponse.json({ comments });
}

export async function POST(req: Request, { params }: { params: { id: string } }) {
  const ctx = await employeeContext();
  if (!ctx) return NextResponse.json({ error: "forbidden" }, { status: 403 });
  const postId = Number(params.id);
  const post = await getFeedPost(ctx.employerId, postId);
  if (!post) return NextResponse.json({ error: "not_found" }, { status: 404 });

  const b = (await req.json().catch(() => ({}))) as { body?: string };
  const body = normalizeFeedBody(b.body, MAX_COMMENT_BODY);
  if (!body) return NextResponse.json({ error: "Write something first." }, { status: 400 });

  const comment = await createFeedComment(ctx.employerId, postId, {
    authorKind: "employee",
    authorId: String(ctx.employeeId),
    authorName: ctx.employee.name || "Employee",
    body,
  });
  if (!comment) return NextResponse.json({ error: "Could not post the comment." }, { status: 500 });

  logActivityForEmployer(ctx.employerId, {
    eventType: "feed_comment",
    title: `${ctx.employee.name || "An employee"} replied on the team feed`,
    body: comment.body.slice(0, 200),
    link: "/employer/employees?tab=feed",
  }).catch(() => {});

  return NextResponse.json({ comment });
}
