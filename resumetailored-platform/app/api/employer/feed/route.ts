import { NextResponse } from "next/server";
import { employerContext } from "@/lib/employer-auth";
import { getEmployerProfile } from "@/lib/employer-store";
import { listFeedPosts, createFeedPost } from "@/lib/feed-store";
import { isFeedPostKind, normalizeFeedBody } from "@/lib/feed-hub";
import { logActivityForEmployees } from "@/lib/notifications-store";
import { listEmployees } from "@/lib/employees-store";

export const runtime = "nodejs";

/** GET the shared team feed. */
export async function GET() {
  const ctx = await employerContext();
  if (!ctx) return NextResponse.json({ error: "forbidden" }, { status: 403 });
  const posts = await listFeedPosts(ctx.employerId);
  return NextResponse.json({ posts });
}

/** POST a new post/issue/win from the employer side. Body: { kind, body }. */
export async function POST(req: Request) {
  const ctx = await employerContext();
  if (!ctx) return NextResponse.json({ error: "forbidden" }, { status: 403 });
  const b = (await req.json().catch(() => ({}))) as { kind?: string; body?: string };
  const kind = isFeedPostKind(b.kind) ? b.kind : "post";
  const body = normalizeFeedBody(b.body);
  if (!body) return NextResponse.json({ error: "Write something first." }, { status: 400 });

  const profile = await getEmployerProfile(ctx.employerId);
  const post = await createFeedPost(ctx.employerId, {
    authorKind: "employer",
    authorId: ctx.userId,
    authorName: profile?.companyName || "Management",
    kind,
    body,
  });
  if (!post) return NextResponse.json({ error: "Could not post." }, { status: 500 });

  const employees = await listEmployees(ctx.employerId);
  const active = employees.filter((e) => e.status !== "offboarded");
  logActivityForEmployees(ctx.employerId, active.map((e) => e.id), {
    eventType: "feed_post",
    title: `New on the team feed: ${post.body.slice(0, 80)}`,
    link: "/employee/feed",
  }).catch(() => {});

  return NextResponse.json({ post });
}
