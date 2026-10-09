import { NextResponse } from "next/server";
import { auth } from "@clerk/nextjs/server";
import { supabaseVideoBackend } from "@/lib/saved-videos-store";
import { videoUrlFor } from "@/lib/saved-videos";

export const runtime = "nodejs";

/** Play (default) or download (?download=1) a saved video: the owner is checked here, then the browser is sent
 *  to a short-lived signed URL for the private file. Anyone else gets a 404. */
export async function GET(req: Request, { params }: { params: { id: string } }) {
  const { userId } = await auth();
  if (!userId) return NextResponse.json({ error: "not_signed_in" }, { status: 401 });
  const be = supabaseVideoBackend();
  const download = new URL(req.url).searchParams.get("download") === "1";
  const url = be ? await videoUrlFor(be, userId, params.id, download) : null;
  if (!url) return NextResponse.json({ error: "not_found" }, { status: 404 });
  return NextResponse.redirect(url, 302);
}
