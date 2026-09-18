import { NextResponse } from "next/server";
import { employerContext } from "@/lib/employer-auth";
import { getEmployerProfile, saveEmployerSignature } from "@/lib/employer-store";
import type { EmailSignature } from "@/lib/employer-ai";

export const runtime = "nodejs";

/** GET the saved email signature (null until configured). */
export async function GET() {
  const ctx = await employerContext();
  if (!ctx) return NextResponse.json({ error: "forbidden" }, { status: 403 });
  const profile = await getEmployerProfile(ctx.employerId);
  return NextResponse.json({ signature: profile?.emailSignature ?? null });
}

const str = (v: unknown, max: number): string => (typeof v === "string" ? v.trim().slice(0, max) : "");

/** POST save (or clear) the email signature. Owner-only, mirroring profile edits. */
export async function POST(req: Request) {
  const ctx = await employerContext();
  if (!ctx) return NextResponse.json({ error: "forbidden" }, { status: 403 });
  if (ctx.access.plan !== "employer") return NextResponse.json({ error: "Only the account owner can edit the signature." }, { status: 403 });

  const b = (await req.json().catch(() => ({}))) as Partial<EmailSignature> & { clear?: boolean };
  if (b.clear) {
    const ok = await saveEmployerSignature(ctx.employerId, null);
    if (!ok) return NextResponse.json({ error: "Could not save. Is the database configured?" }, { status: 500 });
    return NextResponse.json({ ok: true, signature: null });
  }

  const sig: EmailSignature = {
    displayName: str(b.displayName, 120),
    title: str(b.title, 120),
    phone: str(b.phone, 60),
    address: str(b.address, 200),
    footer: str(b.footer, 200),
    // Only persist an http(s) logo URL (it is set by the asset-upload route).
    logoUrl: /^https?:\/\//i.test(str(b.logoUrl, 600)) ? str(b.logoUrl, 600) : "",
  };
  const ok = await saveEmployerSignature(ctx.employerId, sig);
  if (!ok) return NextResponse.json({ error: "Could not save. Is the database configured?" }, { status: 500 });
  const profile = await getEmployerProfile(ctx.employerId);
  return NextResponse.json({ ok: true, signature: profile?.emailSignature ?? null });
}
