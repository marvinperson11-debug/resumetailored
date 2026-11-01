import { NextResponse } from "next/server";
import { employerContext } from "@/lib/employer-auth";
import { canUseSms } from "@/lib/employer-plan";
import { getSmsNumber, saveSmsNumber } from "@/lib/sms-store";
import { markSmsEnabled } from "@/lib/bgc-store";
import { isTwilioConfigured, provisionLocalNumber } from "@/lib/twilio";

export const runtime = "nodejs";

/** GET — this org's Twilio number, if any (null if not provisioned yet). */
export async function GET() {
  const ctx = await employerContext();
  if (!ctx) return NextResponse.json({ error: "forbidden" }, { status: 403 });
  if (!canUseSms(ctx.access)) return NextResponse.json({ error: "plan_required", feature: "sms" }, { status: 402 });
  const number = await getSmsNumber(ctx.employerId);
  return NextResponse.json({ number });
}

/** POST — provision one US local number for this org (idempotent: returns
 *  the existing number rather than buying a second one). */
export async function POST() {
  const ctx = await employerContext();
  if (!ctx) return NextResponse.json({ error: "forbidden" }, { status: 403 });
  if (!canUseSms(ctx.access)) return NextResponse.json({ error: "plan_required", feature: "sms" }, { status: 402 });

  const existing = await getSmsNumber(ctx.employerId);
  if (existing) return NextResponse.json({ number: existing });

  if (!isTwilioConfigured()) return NextResponse.json({ error: "sms_not_configured" }, { status: 501 });

  const result = await provisionLocalNumber();
  if (!result.ok || !result.phoneNumber || !result.sid) {
    return NextResponse.json({ error: "provision_failed", message: result.errorMessage }, { status: 502 });
  }
  const saved = await saveSmsNumber(ctx.employerId, result.phoneNumber, result.sid);
  if (!saved) return NextResponse.json({ error: "save_failed" }, { status: 500 });
  await markSmsEnabled(ctx.employerId);
  return NextResponse.json({ number: { phoneNumber: result.phoneNumber, status: "active" } });
}
