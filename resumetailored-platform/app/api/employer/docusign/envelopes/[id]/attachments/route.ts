import { NextResponse } from "next/server";
import type { EnvelopeAttachment } from "@/lib/employer-ai";
import { employerContext } from "@/lib/employer-auth";
import {
  getEnvelopeLookupOwned,
  uploadEnvelopeAttachment,
  appendAttachment,
  attachmentExt,
  MAX_ENVELOPE_ATTACH_BYTES,
  MAX_ENVELOPE_ATTACHMENTS,
} from "@/lib/docusign-store";

export const runtime = "nodejs";
export const maxDuration = 30;

/**
 * Employer attaches their own file to an envelope record (kind 'other',
 * by 'employer' — so it never shows on the signer's page). Multipart `file`,
 * pdf/jpg/png/doc/docx ≤ 10MB. Owner-scoped.
 */
export async function POST(req: Request, { params }: { params: { id: string } }) {
  const ctx = await employerContext();
  if (!ctx) return NextResponse.json({ error: "forbidden" }, { status: 403 });

  const id = Number(params.id);
  if (!Number.isFinite(id) || id <= 0) return NextResponse.json({ error: "not_found" }, { status: 404 });

  const env = await getEnvelopeLookupOwned(ctx.employerId, id);
  if (!env) return NextResponse.json({ error: "not_found" }, { status: 404 });

  let form: FormData;
  try {
    form = await req.formData();
  } catch {
    return NextResponse.json({ error: "Invalid upload." }, { status: 400 });
  }
  const file = form.get("file");
  if (!(file instanceof File)) return NextResponse.json({ error: "No file provided." }, { status: 400 });

  const ext = attachmentExt(file.name || "", file.type);
  if (!ext) return NextResponse.json({ error: "Unsupported file type." }, { status: 400 });
  if (file.size > MAX_ENVELOPE_ATTACH_BYTES) return NextResponse.json({ error: "That file is too large (max 10 MB)." }, { status: 400 });
  if (env.attachments.length >= MAX_ENVELOPE_ATTACHMENTS) {
    return NextResponse.json({ error: "This envelope already has the maximum number of files." }, { status: 400 });
  }

  const buf = Buffer.from(await file.arrayBuffer());
  if (!buf.length) return NextResponse.json({ error: "That file is empty." }, { status: 400 });
  if (ext === "pdf" && buf.subarray(0, 5).toString("latin1") !== "%PDF-") {
    return NextResponse.json({ error: "This file isn't a valid PDF." }, { status: 400 });
  }

  const note = String(form.get("note") || "").trim().slice(0, 500);
  const stored = await uploadEnvelopeAttachment(ctx.employerId, env.envelopeId, {
    data: buf,
    filename: file.name || `document.${ext}`,
    ext,
  });
  if (!stored) return NextResponse.json({ error: "Upload failed. Please try again." }, { status: 500 });

  const filename = (file.name || `document.${ext}`).slice(0, 200);
  const attachment: EnvelopeAttachment = {
    name: filename,
    url: stored.path,
    note,
    uploadedAt: new Date().toISOString(),
    kind: "other",
    by: "employer",
  };
  const ok = await appendAttachment(env.id, { requestedDocs: env.requestedDocs, attachments: env.attachments }, attachment);
  if (!ok) return NextResponse.json({ error: "Couldn't save the file. Please try again." }, { status: 500 });

  return NextResponse.json({ ok: true, name: filename });
}
