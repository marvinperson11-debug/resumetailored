import { NextResponse } from "next/server";
import { employerContext } from "@/lib/employer-auth";
import { listCertsForEmployer } from "@/lib/cert-store";

export const runtime = "nodejs";

/** GET every certification for the employer's workforce — used to flag
 *  expiring/expired certs on the Directory without a per-employee fetch. */
export async function GET() {
  const ctx = await employerContext();
  if (!ctx) return NextResponse.json({ error: "forbidden" }, { status: 403 });
  const certs = await listCertsForEmployer(ctx.employerId);
  return NextResponse.json({ certs });
}
