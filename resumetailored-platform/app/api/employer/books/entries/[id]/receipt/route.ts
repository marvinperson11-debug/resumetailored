import { NextResponse } from "next/server";
import { employerContext } from "@/lib/employer-auth";
import { canUseBooks } from "@/lib/employer-plan";
import { getEntry, uploadReceipt, signReceiptUrl, MAX_RECEIPT_BYTES } from "@/lib/books-store";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 30;

const ALLOWED_TYPES: Record<string, string> = { "image/png": "png", "image/jpeg": "jpg", "image/webp": "webp", "application/pdf": "pdf" };

/** POST — multipart receipt/photo upload for one entry. Field name "file". */
export async function POST(req: Request, { params }: { params: { id: string } }) {
  const ctx = await employerContext();
  if (!ctx) return NextResponse.json({ error: "forbidden" }, { status: 403 });
  if (!canUseBooks(ctx.access)) return NextResponse.json({ error: "Books is available on the Portal plan and above." }, { status: 403 });

  const entry = await getEntry(ctx.employerId, params.id);
  if (!entry) return NextResponse.json({ error: "Entry not found." }, { status: 404 });

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
  if (file.size > MAX_RECEIPT_BYTES) return NextResponse.json({ error: "File is too large — keep it under 8 MB." }, { status: 400 });

  const data = new Uint8Array(await file.arrayBuffer());
  const path = await uploadReceipt(ctx.employerId, params.id, { data, contentType: file.type }, ext);
  if (!path) return NextResponse.json({ error: "Upload failed. Please try again." }, { status: 500 });
  const url = await signReceiptUrl(ctx.employerId, path);
  return NextResponse.json({ path, url });
}

/** GET — a fresh short-lived signed URL for an entry's already-uploaded receipt. */
export async function GET(_req: Request, { params }: { params: { id: string } }) {
  const ctx = await employerContext();
  if (!ctx) return NextResponse.json({ error: "forbidden" }, { status: 403 });
  if (!canUseBooks(ctx.access)) return NextResponse.json({ error: "Books is available on the Portal plan and above." }, { status: 403 });

  const entry = await getEntry(ctx.employerId, params.id);
  if (!entry || !entry.receiptPath) return NextResponse.json({ url: null });
  const url = await signReceiptUrl(ctx.employerId, entry.receiptPath);
  return NextResponse.json({ url });
}
