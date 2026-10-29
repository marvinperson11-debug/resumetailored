import { NextResponse } from "next/server";
import { auth } from "@clerk/nextjs/server";
import { rateLimit } from "@/lib/rate-limit";
import { clipFromUrl } from "@/lib/tracker-clip";

export const runtime = "nodejs";
export const maxDuration = 30;

/** POST — clip path (a): paste a posting URL. Signed-in only (the tracker is
 *  personal data, same account requirement as the rest of the candidate
 *  tools). Rate-limited independent of the guest/sign-in caps elsewhere —
 *  this route makes the server fetch an arbitrary candidate-supplied URL
 *  (SSRF-guarded by lib/safe-fetch.ts, but still worth throttling so the
 *  endpoint can't be used as a general-purpose scraping proxy). */
export async function POST(req: Request) {
  const { userId } = await auth();
  if (!userId) return NextResponse.json({ error: "not_signed_in" }, { status: 401 });
  const limited = rateLimit(req, "tracker-clip", 20);
  if (limited) return limited;

  const body = (await req.json().catch(() => ({}))) as { url?: string };
  const result = await clipFromUrl(userId, body.url || "");
  if (!result.ok) return NextResponse.json({ error: result.message, code: result.code }, { status: 422 });
  return NextResponse.json({ application: result.application });
}
