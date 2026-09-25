import { NextResponse } from "next/server";
import { employerContext } from "@/lib/employer-auth";
import { isEmployer } from "@/lib/plan";
import { updateCert, deleteCert } from "@/lib/cert-store";

export const runtime = "nodejs";

/** PATCH edit a certification. Body: { name?, issuedDate?, expiryDate? }. */
export async function PATCH(req: Request, { params }: { params: { id: string } }) {
  const ctx = await employerContext();
  if (!ctx) return NextResponse.json({ error: "forbidden" }, { status: 403 });
  if (!isEmployer(ctx.access)) return NextResponse.json({ error: "Only the account owner can edit certifications." }, { status: 403 });
  const id = Number(params.id);
  if (!Number.isFinite(id)) return NextResponse.json({ error: "bad id" }, { status: 400 });

  const b = (await req.json().catch(() => ({}))) as { name?: string; issuedDate?: string; expiryDate?: string };
  const cert = await updateCert(ctx.employerId, id, {
    ...(b.name !== undefined ? { name: b.name } : {}),
    ...(b.issuedDate !== undefined ? { issuedDate: b.issuedDate } : {}),
    ...(b.expiryDate !== undefined ? { expiryDate: b.expiryDate } : {}),
  });
  if (!cert) return NextResponse.json({ error: "Could not update the certification." }, { status: 400 });
  return NextResponse.json({ cert });
}

/** DELETE a certification (employer side). */
export async function DELETE(_req: Request, { params }: { params: { id: string } }) {
  const ctx = await employerContext();
  if (!ctx) return NextResponse.json({ error: "forbidden" }, { status: 403 });
  if (!isEmployer(ctx.access)) return NextResponse.json({ error: "Only the account owner can delete certifications." }, { status: 403 });
  const id = Number(params.id);
  const ok = await deleteCert(ctx.employerId, id);
  return NextResponse.json({ ok });
}
