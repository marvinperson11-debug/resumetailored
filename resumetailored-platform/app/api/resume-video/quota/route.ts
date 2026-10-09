import { NextResponse } from "next/server";
import { auth } from "@clerk/nextjs/server";
import { isIndividualPro } from "@/lib/plan";
import { getVideoContext } from "@/lib/video-quota-server";

export const runtime = "nodejs";

/** This month's Resume Video allowance for the signed-in Pro member: { kind, limit, used, remaining, period }. */
export async function GET() {
  const { userId } = await auth();
  if (!userId) return NextResponse.json({ error: "not_signed_in" }, { status: 401 });
  if (!(await isIndividualPro())) return NextResponse.json({ error: "pro_required" }, { status: 402 });
  const { quota } = await getVideoContext(userId);
  return NextResponse.json({ quota });
}
