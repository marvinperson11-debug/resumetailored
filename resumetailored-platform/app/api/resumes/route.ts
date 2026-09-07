import { NextResponse } from "next/server";
import { currentUser } from "@clerk/nextjs/server";
import { listDrafts, saveDraft } from "@/lib/resume-drafts";
import type { ResumeDraftContent } from "@/lib/draft-types";

export const runtime = "nodejs";

/** List the signed-in user's saved resumes (FIX 8 / version history). */
export async function GET() {
  const user = await currentUser();
  if (!user) return NextResponse.json({ error: "not_signed_in" }, { status: 401 });
  const drafts = await listDrafts(user.id);
  return NextResponse.json({ drafts });
}

/** Create/update one saved resume (autosave every 30s + on Build — FIX 7 #6). */
export async function POST(req: Request) {
  const user = await currentUser();
  if (!user) return NextResponse.json({ error: "not_signed_in" }, { status: 401 });

  const body = (await req.json().catch(() => ({}))) as {
    id?: string;
    title?: string;
    content?: ResumeDraftContent;
  };
  const { id, title = "Untitled resume", content } = body;
  if (!id || !content || typeof content !== "object") {
    return NextResponse.json({ error: "id and content are required." }, { status: 400 });
  }
  // Guard against oversized payloads (a photo data URL is the only large field).
  if (JSON.stringify(content).length > 3_000_000) {
    return NextResponse.json({ error: "Draft is too large. Try a smaller photo." }, { status: 413 });
  }

  const res = await saveDraft(user.id, id, title, content);
  if (!res.ok) {
    const status = res.error === "not_configured" ? 200 : 500;
    // When persistence isn't configured we don't treat it as a hard error — the
    // builder keeps working, it just won't have server-side history.
    return NextResponse.json({ ok: false, persisted: false, error: res.error }, { status });
  }
  return NextResponse.json({ ok: true, persisted: true, id });
}
