import { NextResponse } from "next/server";
import { requireEmployerId } from "@/lib/employer-auth";
import {
  uploadCareerAsset,
  deleteCareerAsset,
  assetPathFromUrl,
  ALLOWED_IMAGE_TYPES,
  MAX_ASSET_BYTES,
} from "@/lib/career-site-store";

export const runtime = "nodejs";
export const maxDuration = 30;

/** POST — multipart image upload for a career-site logo/banner. Returns { url }
 *  of the public CDN URL. jpeg/png/webp only, ≤ 2 MB. */
export async function POST(req: Request) {
  const employerId = await requireEmployerId();
  if (!employerId) return NextResponse.json({ error: "forbidden" }, { status: 403 });

  let form: FormData;
  try {
    form = await req.formData();
  } catch {
    return NextResponse.json({ error: "Invalid upload." }, { status: 400 });
  }
  const file = form.get("file");
  if (!(file instanceof File)) return NextResponse.json({ error: "No file provided." }, { status: 400 });

  if (!(ALLOWED_IMAGE_TYPES as readonly string[]).includes(file.type)) {
    return NextResponse.json({ error: "Please upload a PNG, JPEG, or WebP image." }, { status: 400 });
  }
  if (file.size > MAX_ASSET_BYTES) {
    return NextResponse.json({ error: "Image is too large — keep it under 2 MB." }, { status: 400 });
  }

  try {
    const data = await file.arrayBuffer();
    const result = await uploadCareerAsset(employerId, { data, contentType: file.type, filename: file.name || "image" });
    if (!result) return NextResponse.json({ error: "Upload failed. Please try again." }, { status: 500 });
    return NextResponse.json(result);
  } catch (error) {
    console.error("[career-site upload POST]", error);
    return NextResponse.json({ error: "Upload failed. Please try again." }, { status: 500 });
  }
}

/** DELETE — remove a previously uploaded asset (must be in the caller's folder).
 *  Body: { path } or { url }. */
export async function DELETE(req: Request) {
  const employerId = await requireEmployerId();
  if (!employerId) return NextResponse.json({ error: "forbidden" }, { status: 403 });
  const b = (await req.json().catch(() => ({}))) as { path?: string; url?: string };
  const path = b.path || (b.url ? assetPathFromUrl(b.url) : "");
  if (!path) return NextResponse.json({ error: "Nothing to delete." }, { status: 400 });
  try {
    const ok = await deleteCareerAsset(employerId, path);
    return NextResponse.json({ ok });
  } catch (error) {
    console.error("[career-site upload DELETE]", error);
    return NextResponse.json({ error: "Could not delete the file." }, { status: 500 });
  }
}
