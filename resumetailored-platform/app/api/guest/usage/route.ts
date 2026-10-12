import { NextResponse } from "next/server";
import { auth } from "@clerk/nextjs/server";
import { rateLimit } from "@/lib/rate-limit";
import { GUEST_TOOLS, guestUsedToday, type GuestTool } from "@/lib/guest";

export const runtime = "nodejs";

/**
 * How many of today's free runs of one tool this guest has taken — so the "free runs left" note can
 * show on page load, not only after the next run. Read-only: it reserves nothing, calls no model,
 * mints no cookie (a visitor with no rt_guest cookie simply has used 0), and a store error reads as 0
 * (the note then stays hidden). Signed-in users get `{ guest: false }` and nothing is read.
 *
 * GET /api/guest/usage?tool=ats-scan  ->  { guest: true, tool, used, limit }
 */
export async function GET(req: Request) {
  const limited = rateLimit(req, "guest-usage", 60);
  if (limited) return limited;
  const tool = new URL(req.url).searchParams.get("tool") ?? "";
  if (!Object.prototype.hasOwnProperty.call(GUEST_TOOLS, tool)) return NextResponse.json({ error: "unknown_tool" }, { status: 400 });
  const { userId } = await auth();
  const headers = { "Cache-Control": "no-store" };
  if (userId) return NextResponse.json({ guest: false }, { headers });
  const def = GUEST_TOOLS[tool as GuestTool];
  const used = Math.min(await guestUsedToday(req, tool as GuestTool), def.limit);
  return NextResponse.json({ guest: true, tool, used, limit: def.limit }, { headers });
}
