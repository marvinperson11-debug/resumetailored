import { NextResponse } from "next/server";
import { auth } from "@clerk/nextjs/server";
import { cleanInstructions, CUSTOM_INSTRUCTIONS_MAX, CUSTOM_INSTRUCTIONS_MAX_PRO } from "@/lib/instructions";
import { isIndividualPro } from "@/lib/plan";
import { getCustomInstructions, saveCustomInstructions } from "@/lib/user-prefs-store";

export const runtime = "nodejs";

/** Saved custom writing instructions for the signed-in user. */
export async function GET() {
  const { userId } = await auth();
  if (!userId) return NextResponse.json({ error: "not_signed_in", message: "Your session expired. Please refresh and sign in again." }, { status: 401 });
  // Free keeps 2,000 chars; Pro is effectively unlimited (safety ceiling only).
  const max = (await isIndividualPro()) ? CUSTOM_INSTRUCTIONS_MAX_PRO : CUSTOM_INSTRUCTIONS_MAX;
  const { instructions, updatedAt } = await getCustomInstructions(userId, max);
  return NextResponse.json({ instructions, updatedAt, maxLength: max, unlimited: max === CUSTOM_INSTRUCTIONS_MAX_PRO });
}

export async function PUT(req: Request) {
  const { userId } = await auth();
  if (!userId) return NextResponse.json({ error: "not_signed_in", message: "Your session expired. Please refresh and sign in again." }, { status: 401 });
  const body = (await req.json().catch(() => ({}))) as { instructions?: unknown };
  if (typeof body.instructions !== "string") return NextResponse.json({ error: "instructions must be a string." }, { status: 400 });
  const max = (await isIndividualPro()) ? CUSTOM_INSTRUCTIONS_MAX_PRO : CUSTOM_INSTRUCTIONS_MAX;
  const cleaned = cleanInstructions(body.instructions, max);
  const saved = await saveCustomInstructions(userId, cleaned);
  if (!saved.ok) {
    return NextResponse.json({ error: "storage_unavailable", message: "Could not save right now. Please try again shortly." }, { status: 503 });
  }
  return NextResponse.json({
    success: true,
    instructions: cleaned,
    updatedAt: saved.updatedAt,
    truncated: body.instructions.trim().length > max,
    maxLength: max,
  });
}
