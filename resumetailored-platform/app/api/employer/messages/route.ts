import { NextResponse } from "next/server";
import { requireEmployerId } from "@/lib/employer-auth";
import { listConversations, getThread, sendMessage } from "@/lib/employer-collab-store";
import { notifyCandidateOfMessage } from "@/lib/employer-notify";
import type { MessageAttachment } from "@/lib/employer-ai";

export const runtime = "nodejs";

/** GET — with ?applicantId= returns that candidate's full thread; without it
 *  returns the inbox (latest message + unread count per candidate). */
export async function GET(req: Request) {
  const employerId = await requireEmployerId();
  if (!employerId) return NextResponse.json({ error: "forbidden" }, { status: 403 });

  const applicantId = Number(new URL(req.url).searchParams.get("applicantId"));
  if (Number.isFinite(applicantId) && applicantId > 0) {
    const messages = await getThread(employerId, applicantId);
    return NextResponse.json({ messages });
  }
  const conversations = await listConversations(employerId);
  return NextResponse.json({ conversations });
}

/** POST — send a message from the employer to a candidate. */
export async function POST(req: Request) {
  const employerId = await requireEmployerId();
  if (!employerId) return NextResponse.json({ error: "forbidden" }, { status: 403 });

  const b = (await req.json().catch(() => ({}))) as {
    applicantId?: number;
    content?: string;
    attachments?: MessageAttachment[];
  };
  const applicantId = Number(b.applicantId);
  if (!Number.isFinite(applicantId)) return NextResponse.json({ error: "Pick a candidate to message." }, { status: 400 });
  if (!(b.content || "").trim() && !(b.attachments || []).length)
    return NextResponse.json({ error: "Write a message first." }, { status: 400 });

  const message = await sendMessage(employerId, applicantId, b.content || "", b.attachments || []);
  if (!message) return NextResponse.json({ error: "Could not send the message (is this candidate yours?)." }, { status: 400 });
  // Best-effort: email the candidate (they have no in-app inbox yet).
  notifyCandidateOfMessage(employerId, applicantId, message).catch(() => {});
  return NextResponse.json({ message });
}
