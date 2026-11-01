import { NextResponse } from "next/server";
import { employerContext } from "@/lib/employer-auth";
import { canUseBackgroundChecks } from "@/lib/employer-plan";
import { getApplicant } from "@/lib/employer-store";
import { isValidPackageId } from "@/lib/bgc-packages";
import { createOrder, listOrders, getEmployerSettings } from "@/lib/bgc-store";

export const runtime = "nodejs";

/** GET — this org's background-check orders (optionally filtered to one
 *  candidate via ?applicantId=). */
export async function GET(req: Request) {
  const ctx = await employerContext();
  if (!ctx) return NextResponse.json({ error: "forbidden" }, { status: 403 });
  if (!canUseBackgroundChecks(ctx.access)) return NextResponse.json({ error: "plan_required", feature: "background_checks" }, { status: 402 });
  const applicantId = Number(new URL(req.url).searchParams.get("applicantId"));
  const orders = await listOrders(ctx.employerId, Number.isFinite(applicantId) && applicantId > 0 ? applicantId : undefined);
  return NextResponse.json({ orders });
}

/**
 * POST — order a background check. Requires `confirm: true` — the UI's
 * confirmation modal shows the package, price + pass-through-fee notice,
 * and the "the candidate will be contacted by Checkr" disclosure BEFORE
 * this is ever called with confirm set.
 */
export async function POST(req: Request) {
  const ctx = await employerContext();
  if (!ctx) return NextResponse.json({ error: "forbidden" }, { status: 403 });
  if (!canUseBackgroundChecks(ctx.access)) return NextResponse.json({ error: "plan_required", feature: "background_checks" }, { status: 402 });

  let body: { applicantId?: number; packageId?: string; candidateStateCode?: string; confirm?: boolean };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "bad_request" }, { status: 400 });
  }
  if (body.confirm !== true) return NextResponse.json({ error: "confirmation_required" }, { status: 400 });
  const applicantId = Number(body.applicantId);
  if (!Number.isFinite(applicantId)) return NextResponse.json({ error: "bad_applicant" }, { status: 400 });
  if (!body.packageId || !isValidPackageId(body.packageId)) return NextResponse.json({ error: "bad_package" }, { status: 400 });

  const applicant = await getApplicant(ctx.employerId, applicantId);
  if (!applicant) return NextResponse.json({ error: "not_found" }, { status: 404 });

  const settings = await getEmployerSettings(ctx.employerId);
  const nameParts = applicant.name.trim().split(/\s+/);
  const firstName = nameParts[0] || applicant.name;
  const lastName = nameParts.slice(1).join(" ") || "-";

  const result = await createOrder({
    employerId: ctx.employerId,
    applicantId,
    packageId: body.packageId,
    orderedBy: ctx.userId,
    candidateFirstName: firstName,
    candidateLastName: lastName,
    candidateEmail: applicant.email,
    candidatePhone: applicant.phoneNormalized,
    candidateStateCode: body.candidateStateCode,
    billingMode: settings.bgcBillingMode,
  });

  if (!result.ok) return NextResponse.json({ error: result.error || "order_failed", order: result.order }, { status: 502 });
  return NextResponse.json({ ok: true, order: result.order });
}
