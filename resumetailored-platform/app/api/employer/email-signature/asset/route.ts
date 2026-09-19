import { NextResponse } from "next/server";
import { employerContext } from "@/lib/employer-auth";
import { isEmployer } from "@/lib/plan";
import { uploadEmailSignatureAsset, EMAIL_ASSET_ALLOWED_TYPES, EMAIL_ASSET_MAX_BYTES } from "@/lib/employer-store";

export const runtime = "nodejs";
export const maxDuration = 30;

/** POST — multipart image upload for the email-signature logo/photo. Returns
 *  { url } of the PUBLIC CDN URL (email clients need an unauthenticated URL).
 *  jpeg/png/webp only, ≤ 2 MB. Owner-only, mirroring signature edits. */
export async function POST(req: Request) {
  const ctx = await employerContext();
  if (!ctx) return NextResponse.json({ error: "forbidden" }, { status: 403 });
  // Owner (plan "employer") OR platform admin — matches the Settings page gate.
  if (!isEmployer(ctx.access)) return NextResponse.json({ error: "Only the account owner can edit the signature." }, { status: 403 });

  let form: FormData;
  try {
    form = await req.formData();
  } catch {
    return NextResponse.json({ error: "Invalid upload." }, { status: 400 });
  }
  const file = form.get("file");
  if (!(file instanceof File)) return NextResponse.json({ error: "No file provided." }, { status: 400 });

  if (!(EMAIL_ASSET_ALLOWED_TYPES as readonly string[]).includes(file.type)) {
    return NextResponse.json({ error: "Please upload a PNG, JPEG, or WebP image." }, { status: 400 });
  }
  if (file.size > EMAIL_ASSET_MAX_BYTES) {
    return NextResponse.json({ error: "Image is too large — keep it under 2 MB." }, { status: 400 });
  }

  try {
    const data = await file.arrayBuffer();
    const result = await uploadEmailSignatureAsset(ctx.employerId, { data, contentType: file.type, filename: file.name || "logo" });
    if (!result) return NextResponse.json({ error: "Upload failed. Please try again." }, { status: 500 });
    return NextResponse.json(result);
  } catch (error) {
    console.error("[email-signature asset POST]", error);
    return NextResponse.json({ error: "Upload failed. Please try again." }, { status: 500 });
  }
}
