import { NextResponse } from "next/server";
import { requireEmployerId } from "@/lib/employer-auth";
import { deleteLearning, correctLearning } from "@/lib/assistant-employer-learning";

export const runtime = "nodejs";

/** PATCH — correct one learned item to an explicit value (the learning
 *  panel's "Correct" control). Pins the item so a later batch of new
 *  observations can never silently overwrite the employer's own
 *  correction (lib/assistant-employer-learning.ts `correctLearning`). */
export async function PATCH(req: Request, { params }: { params: { id: string } }) {
  const employerId = await requireEmployerId();
  if (!employerId) return NextResponse.json({ error: "forbidden" }, { status: 403 });
  const body = (await req.json().catch(() => ({}))) as { value?: unknown };
  const value = typeof body.value === "string" ? body.value : "";
  if (!value.trim()) return NextResponse.json({ error: "bad_value" }, { status: 400 });
  const result = await correctLearning(employerId, String(params.id || ""), value);
  if (!result.found) return NextResponse.json({ error: "not_found" }, { status: 404 });
  return NextResponse.json({ ok: true });
}

/** DELETE — remove one learned item outright (the learning panel's
 *  "Delete" control). A full reset, not a dismissal flag: a later batch of
 *  new observations starts this signal's tally over from zero. */
export async function DELETE(_req: Request, { params }: { params: { id: string } }) {
  const employerId = await requireEmployerId();
  if (!employerId) return NextResponse.json({ error: "forbidden" }, { status: 403 });
  const result = await deleteLearning(employerId, String(params.id || ""));
  if (!result.found) return NextResponse.json({ error: "not_found" }, { status: 404 });
  return NextResponse.json({ ok: true });
}
