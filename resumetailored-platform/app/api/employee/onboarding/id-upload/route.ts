import { NextResponse } from "next/server";
import { employeeContext } from "@/lib/employee-auth";
import { uploadIdDocument, MAX_ID_DOC_BYTES } from "@/lib/paperwork-store";

export const runtime = "nodejs";
export const maxDuration = 30;

const ALLOWED_TYPES: Record<string, string> = { "image/png": "png", "image/jpeg": "jpg", "image/webp": "webp", "application/pdf": "pdf" };

/** POST — multipart ID/work-authorization document upload for I-9 Section
 *  1. Field name "file". Returns a private Storage path (never a public
 *  URL) to pass to POST /api/employee/onboarding/i9. */
export async function POST(req: Request) {
  const ctx = await employeeContext();
  if (!ctx) return NextResponse.json({ error: "forbidden" }, { status: 403 });

  let form: FormData;
  try {
    form = await req.formData();
  } catch {
    return NextResponse.json({ error: "Invalid upload." }, { status: 400 });
  }
  const file = form.get("file");
  if (!(file instanceof File)) return NextResponse.json({ error: "No file provided." }, { status: 400 });
  const ext = ALLOWED_TYPES[file.type];
  if (!ext) return NextResponse.json({ error: "Please upload a PNG, JPEG, WebP, or PDF file." }, { status: 400 });
  if (file.size > MAX_ID_DOC_BYTES) return NextResponse.json({ error: "File is too large — keep it under 8 MB." }, { status: 400 });

  const data = new Uint8Array(await file.arrayBuffer());
  const path = await uploadIdDocument(ctx.employerId, ctx.employeeId, { data, contentType: file.type }, ext);
  if (!path) return NextResponse.json({ error: "Upload failed. Please try again." }, { status: 500 });
  return NextResponse.json({ path });
}
