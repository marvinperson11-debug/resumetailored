import { NextResponse, type NextRequest } from "next/server";
import type { EnvelopeAttachment } from "@/lib/employer-ai";
import {
  getEnvelopeBySignToken,
  getEnvelopeByEnvelopeId,
  uploadEnvelopeAttachment,
  appendAttachment,
  attachmentExt,
  MAX_ENVELOPE_ATTACH_BYTES,
  MAX_ENVELOPE_ATTACHMENTS,
} from "@/lib/docusign-store";
import { notifySignerOfUpload, notifyEmployerOfUpload } from "@/lib/esign-delivery";

export const runtime = "nodejs";
export const maxDuration = 30;

/**
 * Login-less signer upload. One file per request (so each successful upload can
 * send exactly one confirmation email). Authenticated ONLY by the `key` token in
 * the link, matched against the envelope id. Accepts pdf/jpg/png/doc/docx ≤ 10MB.
 * Stores the file in the private envelope-attachments bucket, appends it to the
 * envelope, marks the matching requested slot uploaded, then (best-effort) emails
 * both the signer (confirmation) and the employer (new document arrived).
 */
export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  const token = req.nextUrl.searchParams.get("key") || "";
  const env = await getEnvelopeBySignToken(params.id, token);
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
  if (!ext) {
    return NextResponse.json({ error: "Unsupported file type. Upload a PDF, image (JPG/PNG), or Word document." }, { status: 400 });
  }
  if (file.size > MAX_ENVELOPE_ATTACH_BYTES) {
    return NextResponse.json({ error: "That file is too large (max 10 MB)." }, { status: 400 });
  }
  if (env.attachments.length >= MAX_ENVELOPE_ATTACHMENTS) {
    return NextResponse.json({ error: "This envelope already has the maximum number of files." }, { status: 400 });
  }

  const buf = Buffer.from(await file.arrayBuffer());
  if (!buf.length) return NextResponse.json({ error: "That file is empty." }, { status: 400 });
  // Magic-byte sanity check for PDFs (cheap, prevents a mislabelled PDF).
  if (ext === "pdf" && buf.subarray(0, 5).toString("latin1") !== "%PDF-") {
    return NextResponse.json({ error: "This file isn't a valid PDF." }, { status: 400 });
  }

  const note = String(form.get("note") || "").trim().slice(0, 500);
  const rawRequest = String(form.get("requestName") || "").trim();
  // A request name only counts as "requested" when it matches an open slot.
  const matched = env.requestedDocs.find((d) => d.name.trim().toLowerCase() === rawRequest.toLowerCase());
  const requestName = matched ? matched.name : "";

  const stored = await uploadEnvelopeAttachment(env.employerId, env.envelopeId, {
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
    kind: requestName ? "requested" : "other",
    by: "signer",
  };
  const ok = await appendAttachment(
    env.id,
    { requestedDocs: env.requestedDocs, attachments: env.attachments },
    attachment,
    requestName || undefined
  );
  if (!ok) return NextResponse.json({ error: "Couldn't save the upload. Please try again." }, { status: 500 });

  // Confirmation (signer) + notification (employer), both best-effort. Re-read the
  // envelope so the pending-docs list in the emails reflects this upload.
  void getEnvelopeByEnvelopeId(env.envelopeId).then((fresh) => {
    const target = fresh || env;
    void notifySignerOfUpload(target, filename, requestName || undefined);
    void notifyEmployerOfUpload(target, filename, requestName || undefined);
  });

  return NextResponse.json({ ok: true, name: filename, kind: attachment.kind, requestName });
}
