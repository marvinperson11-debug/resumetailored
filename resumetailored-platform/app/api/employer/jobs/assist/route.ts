import { NextResponse } from "next/server";
import { auth } from "@clerk/nextjs/server";
import { requireEmployerId } from "@/lib/employer-auth";
import { getAnthropic, CLAUDE_MODEL, isProviderUnavailable } from "@/lib/ai";
import { buildJobAssistPrompt } from "@/lib/employer-ai";
import { guestReserve, withGuestCookie, type GuestGate } from "@/lib/guest";

export const runtime = "nodejs";
export const maxDuration = 60;

/** AI job-description assist: rough notes → polished, inclusive description.
 *  Available to every employer (no extra gate), and — as the one AI tool of the anonymous employer
 *  taste (app/employer demo mode) — to a signed-OUT visitor, once a day (`employer-jd`). The guest
 *  path takes nothing from the request but the notes it writes from, reads no stored data and
 *  persists nothing; a signed-in user who is not an employer is still refused exactly as before. */
async function handle(req: Request) {
  const { userId } = await auth();
  const guest = !userId;
  if (!guest && !(await requireEmployerId())) return NextResponse.json({ error: "forbidden" }, { status: 403 });

  const b = (await req.json().catch(() => ({}))) as {
    title?: string;
    notes?: string;
    department?: string;
    location?: string;
    employmentType?: string;
  };
  // A guest's input is capped so one anonymous call cannot be an arbitrarily large prompt.
  const notes = (guest ? (b.notes || "").slice(0, 6000) : b.notes || "").trim();
  if (notes.length < 12) return NextResponse.json({ error: "Add a few notes for the AI to work from." }, { status: 400 });

  const anthropic = getAnthropic();
  if (!anthropic) return NextResponse.json({ error: "not_configured", message: "AI is not configured." }, { status: 501 });

  // Reserved after validation and before the call, refunded below if the call fails.
  let gate: GuestGate | null = null;
  if (guest) {
    const r = await guestReserve(req, "employer-jd");
    if (!r.ok) return r.response;
    gate = r.gate;
  }

  const { system, user } = buildJobAssistPrompt({
    title: (b.title || "").trim(),
    notes,
    department: (b.department || "").trim(),
    location: (b.location || "").trim(),
    employmentType: (b.employmentType || "").trim(),
  });
  try {
    const msg = await anthropic.messages.create({ model: CLAUDE_MODEL, max_tokens: 1500, system, messages: [{ role: "user", content: user }] });
    await gate?.recordUsage(msg.usage);
    const block = msg.content[0];
    const description = block && block.type === "text" ? block.text.trim() : "";
    if (!description) throw new Error("empty");
    return NextResponse.json({ description, ...(guest ? { guest: true } : {}) });
  } catch (err) {
    await gate?.refund();
    const message = isProviderUnavailable(err)
      ? "AI is temporarily busy. Try again in 30 seconds."
      : "Could not improve that description. Please try again.";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

/** Whatever goes wrong inside, the caller gets a JSON error (the UI shows `error`), never a bare 500 —
 *  and the cause is in the server log with the route's name on it. */
async function safeHandle(req: Request): Promise<Response> {
  try {
    return await handle(req);
  } catch (e) {
    console.error("[employer/jobs/assist] unhandled error:", e instanceof Error ? (e.stack || e.message) : e);
    return NextResponse.json({ error: "Could not improve that description. Please try again." }, { status: 500 });
  }
}

export const POST = withGuestCookie(safeHandle);
