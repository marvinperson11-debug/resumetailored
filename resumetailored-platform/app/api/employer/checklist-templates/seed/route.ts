import { NextResponse, type NextRequest } from "next/server";
import { employerContext } from "@/lib/employer-auth";
import { isEmployer } from "@/lib/plan";
import { ensureDefaultTemplate } from "@/lib/checklist-store";
import { DEFAULT_CHECKLIST_ITEMS } from "@/lib/checklist-hub";

export const runtime = "nodejs";

/**
 * Idempotent, code-seeded default onboarding checklist template — same shape
 * as the Training Library's admin seed route (GET for status, GET ?do=1 or
 * POST to seed), except scoped to the calling employer's own workspace rather
 * than shared platform content: each employer gets their own "Default
 * onboarding checklist" template the first time this runs. The Onboarding tab
 * calls it automatically when a workspace has no templates yet, so a fresh
 * employer never has to find the URL by hand; it stays safe to re-run by hand
 * too (a second call is a no-op once the default exists).
 */
export async function GET(req: NextRequest) {
  const ctx = await employerContext();
  if (!ctx) return NextResponse.json({ error: "forbidden" }, { status: 403 });
  if (!isEmployer(ctx.access)) return NextResponse.json({ error: "Only the account owner can seed checklist templates." }, { status: 403 });

  if (req.nextUrl.searchParams.get("do") === "1") return run(ctx.employerId);

  const result = await ensureDefaultTemplate(ctx.employerId);
  // ensureDefaultTemplate is idempotent, so a plain GET (no ?do=1) still tells
  // the caller the true state without a second write.
  return NextResponse.json({
    ok: true,
    exists: !!result.template,
    expected: DEFAULT_CHECKLIST_ITEMS.length,
    hint: result.template ? "Default template is present." : "Open this URL with ?do=1 to create it.",
  });
}

export async function POST() {
  const ctx = await employerContext();
  if (!ctx) return NextResponse.json({ error: "forbidden" }, { status: 403 });
  if (!isEmployer(ctx.access)) return NextResponse.json({ error: "Only the account owner can seed checklist templates." }, { status: 403 });
  return run(ctx.employerId);
}

async function run(employerId: string): Promise<NextResponse> {
  const result = await ensureDefaultTemplate(employerId);
  if (!result.template) {
    return NextResponse.json(
      { ok: false, code: "seed_error", error: "Could not create the default template. Has migration 0034 been applied?" },
      { status: 200 }
    );
  }
  return NextResponse.json({ ok: true, status: result.created ? "seeded" : "already_seeded", template: result.template });
}
