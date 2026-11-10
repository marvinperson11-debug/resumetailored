import { NextResponse } from "next/server";
import { employerContext } from "@/lib/employer-auth";
import { isEmployer } from "@/lib/plan";
import { canManageHandbookVersions } from "@/lib/employer-plan";
import { replaceHandbookDoc } from "@/lib/handbook";
import { sanitizeDocumentHtml } from "@/lib/documents-store";

export const runtime = "nodejs";

/**
 * POST — replace the handbook's content in place (Corporate only). Body:
 * { bodyHtml: string }. Unlike the generic Training tab's delete-then-
 * recreate, this bumps the SAME doc's `version` rather than losing every
 * past hire's signing history (see lib/handbook.ts, migration 0097).
 *
 * Every tier can SEE the current handbook (the Training tab, and the
 * onboarding page's handbook row) — only this replace action is gated, and
 * only at the moment it's attempted (free-tier UX rule: no lock badge on
 * the button itself).
 */
export async function POST(req: Request) {
  const ctx = await employerContext();
  if (!ctx) return NextResponse.json({ error: "forbidden" }, { status: 403 });
  if (!isEmployer(ctx.access)) return NextResponse.json({ error: "Only the account owner can replace the handbook." }, { status: 403 });
  if (!canManageHandbookVersions(ctx.access)) {
    return NextResponse.json({ error: "Replacing the handbook (with version history) is part of the Corporate plan. Portal and Scale keep the starter handbook you can still have employees sign." }, { status: 403 });
  }

  const b = (await req.json().catch(() => ({}))) as { bodyHtml?: string };
  const bodyHtml = (b.bodyHtml || "").trim();
  if (!bodyHtml) return NextResponse.json({ error: "Handbook content is required." }, { status: 400 });

  const doc = await replaceHandbookDoc(ctx.employerId, sanitizeDocumentHtml(bodyHtml));
  if (!doc) return NextResponse.json({ error: "Could not replace the handbook. Is the database configured?" }, { status: 500 });
  return NextResponse.json({ doc });
}
