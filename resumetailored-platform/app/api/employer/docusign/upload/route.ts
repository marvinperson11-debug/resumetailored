import { NextResponse } from "next/server";
import { employerContext } from "@/lib/employer-auth";
import { uploadEsignDocument, MAX_ESIGN_PDF_BYTES } from "@/lib/docusign-store";

export const runtime = "nodejs";
export const maxDuration = 30;

/**
 * Upload a custom PDF to send for signature. Multipart form with `file` (PDF,
 * ≤ 10 MB). Stored in the private `esign-documents` bucket under the employer's
 * own folder; returns { path, name } for the send route to reference.
 */
export async function POST(req: Request) {
  const ctx = await employerContext();
  if (!ctx) return NextResponse.json({ error: "forbidden" }, { status: 403 });

  let form: FormData;
  try {
    form = await req.formData();
  } catch {
    return NextResponse.json({ error: "Invalid upload." }, { status: 400 });
  }
  const file = form.get("file");
  if (!(file instanceof File)) return NextResponse.json({ error: "No file provided." }, { status: 400 });

  const isPdf = file.type === "application/pdf" || (file.name || "").toLowerCase().endsWith(".pdf");
  if (!isPdf) return NextResponse.json({ error: "Please upload a PDF." }, { status: 400 });
  if (file.size > MAX_ESIGN_PDF_BYTES) {
    return NextResponse.json({ error: "That PDF is too large (max 10 MB)." }, { status: 400 });
  }

  // Magic-byte check: a real PDF starts with %PDF-.
  const buf = Buffer.from(await file.arrayBuffer());
  if (buf.subarray(0, 5).toString("latin1") !== "%PDF-") {
    return NextResponse.json({ error: "This file isn't a valid PDF." }, { status: 400 });
  }

  const result = await uploadEsignDocument(ctx.employerId, { data: buf, filename: file.name || "document.pdf" });
  if (!result) return NextResponse.json({ error: "Upload failed. Please try again." }, { status: 500 });
  return NextResponse.json({ path: result.path, name: (file.name || "document.pdf").replace(/\.pdf$/i, "") });
}
