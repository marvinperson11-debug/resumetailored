import { NextResponse } from "next/server";
import { employerContext } from "@/lib/employer-auth";
import { uploadApplicantFile } from "@/lib/employer-store";
// pdf-parse's index.js runs a debug block on import that crashes when bundled;
// the lib entry skips it (same import the candidate-side /api/extract-text uses).
// eslint-disable-next-line @typescript-eslint/no-require-imports
import pdfParse from "pdf-parse/lib/pdf-parse.js";
import mammoth from "mammoth";

export const runtime = "nodejs";
export const maxDuration = 30;

const MAX_BYTES = 5 * 1024 * 1024; // 5 MB

function magicOk(ext: string, buf: Buffer): boolean {
  if (ext === "txt") return true;
  if (ext === "pdf") return buf.subarray(0, 5).toString("latin1") === "%PDF-";
  if (ext === "docx" || ext === "doc") {
    const pk = buf[0] === 0x50 && buf[1] === 0x4b;
    const ole = buf[0] === 0xd0 && buf[1] === 0xcf && buf[2] === 0x11 && buf[3] === 0xe0;
    return pk || ole;
  }
  return false;
}

/**
 * Employer add-applicant helper: accept an uploaded resume/cover file
 * (pdf/docx/txt, ≤ 5 MB), archive it in the private applicant-resumes bucket,
 * and return the extracted plain text to prefill the editable field. Best-effort
 * archive (a failed upload never blocks extraction).
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
  const kind = form.get("kind") === "cover" ? "cover" : "resume";
  if (!(file instanceof File)) return NextResponse.json({ error: "No file uploaded." }, { status: 400 });
  if (file.size > MAX_BYTES) return NextResponse.json({ error: "That file is too large (max 5MB)." }, { status: 413 });

  const ext = (file.name || "").toLowerCase().split(".").pop() || "";
  const buf = Buffer.from(await file.arrayBuffer());
  if (!magicOk(ext, buf)) {
    return NextResponse.json({ error: "This file's contents don't match a real .txt, .pdf, or .docx document." }, { status: 400 });
  }

  let text = "";
  try {
    if (ext === "txt") text = buf.toString("utf-8");
    else if (ext === "pdf") text = (await pdfParse(buf)).text;
    else if (ext === "docx" || ext === "doc") text = (await mammoth.extractRawText({ buffer: buf })).value;
    else return NextResponse.json({ error: "Unsupported file type. Upload a .txt, .pdf, or .docx." }, { status: 400 });
  } catch (err) {
    console.error("[candidates/extract]", err);
    return NextResponse.json({ error: "Failed to read the file. Please paste the text instead." }, { status: 500 });
  }
  if (!text.trim()) {
    return NextResponse.json({ error: "Could not extract text from this file. Try pasting instead." }, { status: 400 });
  }

  // Archive the original (best-effort; ignore failures).
  const archived = await uploadApplicantFile(ctx.employerId, {
    data: buf,
    contentType: file.type || "application/octet-stream",
    filename: file.name || `${kind}.${ext}`,
    kind,
  });

  return NextResponse.json({ text: text.trim(), path: archived?.path || null });
}
