import { NextResponse } from "next/server";
import { employerContext } from "@/lib/employer-auth";
import { getEmployerProfile } from "@/lib/employer-store";
import { getFeedPost, listFeedComments, createFeedComment } from "@/lib/feed-store";
import { normalizeFeedBody, MAX_COMMENT_BODY } from "@/lib/feed-hub";
import { logActivityForEmployees } from "@/lib/notifications-store";
import { listEmployees } from "@/lib/employees-store";

export const runtime = "nodejs";

export async function GET(_req: Request, { params }: { params: { id: string } }) {
  const ctx = await employerContext();
  if (!ctx) return NextResponse.json({ error: "forbidden" }, { status: 403 });
  const postId = Number(params.id);
  const comments = await listFeedComments(ctx.employerId, postId);
  return NextResponse.json({ comments });
}

export async function POST(req: Request, { params }: { params: { id: string } }) {
  const ctx = await employerContext();
  if (!ctx) return NextResponse.json({ error: "forbidden" }, { status: 403 });
  const postId = Number(params.id);
  const post = await getFeedPost(ctx.employerId, postId);
  if (!post) return NextResponse.json({ error: "not_found" }, { status: 404 });

  const b = (await req.json().catch(() => ({}))) as { body?: string };
  const body = normalizeFeedBody(b.body, MAX_COMMENT_BODY);
  if (!body) return NextResponse.json({ error: "Write something first." }, { status: 400 });

  const profile = await getEmployerProfile(ctx.employerId);
  const comment = await createFeedComment(ctx.employerId, postId, {
    authorKind: "employer",
    authorId: ctx.userId,
    authorName: profile?.companyName || "Management",
    body,
  });
  if (!comment) return NextResponse.json({ error: "Could not post the comment." }, { status: 500 });

  // Only notify the post's own author (an employee) about a new comment —
  // not the whole roster, unlike a new post.
  if (post.authorKind === "employee") {
    const employeeId = Number(post.authorId);
    if (Number.isFinite(employeeId) && employeeId > 0) {
      const employees = await listEmployees(ctx.employerId);
      if (employees.some((e) => e.id === employeeId)) {
        logActivityForEmployees(ctx.employerId, [employeeId], {
          eventType: "feed_comment",
          title: "New reply on your team feed post",
          link: "/employee/feed",
        }).catch(() => {});
      }
    }
  }

  return NextResponse.json({ comment });
}
