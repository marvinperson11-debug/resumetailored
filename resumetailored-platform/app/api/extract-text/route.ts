import { NextResponse } from "next/server";
import { currentUser } from "@clerk/nextjs/server";
// Import pdf-parse's internal module directly: the package's index.js runs a
// debug block on import (reading a bundled test PDF) that crashes in a bundled
// server. The lib entry skips it. (Ported behavior from the old site.)
// eslint-disable-next-line @typescript-eslint/no-require-imports
import pdfParse from "pdf-parse/lib/pdf-parse.js";
import mammoth from "mammoth";

export const runtime = "nodejs";
export const maxDuration = 30;

const MAX_BYTES = 10 * 1024 * 1024; // 10MB

/** Magic-byte check so a renamed/MIME-spoofed file can't slip through. */
function magicOk(ext: string, buf: Buffer): boolean {
  if (ext === "txt") return true; // plain text has no signature
  if (ext === "pdf") return buf.subarray(0, 5).toString("latin1") === "%PDF-";
  if (ext === "docx" || ext === "doc") {
    // .docx is a zip (PK\x03\x04). Legacy .doc is an OLE compound file (D0 CF 11 E0).
    const pk = buf[0] === 0x50 && buf[1] === 0x4b;
    const ole = buf[0] === 0xd0 && buf[1] === 0xcf && buf[2] === 0x11 && buf[3] === 0xe0;
    return pk || ole;
  }
  return false;
}

/**
 * Extract plain text from an uploaded resume file (FIX: "upload my resume").
 * Accepts .txt / .pdf / .docx (and legacy .doc via mammoth), signed-in only.
 * Ported from the old site's `/api/extract-text`.
 */
export async function POST(req: Request) {
  const user = await currentUser();
  if (!user) return NextResponse.json({ error: "not_signed_in" }, { status: 401 });

  let file: File | null = null;
  try {
    const form = await req.formData();
    const f = form.get("file");
    if (f instanceof File) file = f;
  } catch {
    return NextResponse.json({ error: "Invalid upload." }, { status: 400 });
  }
  if (!file) return NextResponse.json({ error: "No file uploaded." }, { status: 400 });
  if (file.size > MAX_BYTES) {
    return NextResponse.json({ error: "That file is too large (max 10MB)." }, { status: 413 });
  }

  const ext = (file.name || "").toLowerCase().split(".").pop() || "";
  const buf = Buffer.from(await file.arrayBuffer());
  if (!magicOk(ext, buf)) {
    return NextResponse.json(
      { error: "This file's contents don't match a real .txt, .pdf, or .docx document." },
      { status: 400 }
    );
  }

  try {
    let text = "";
    if (ext === "txt") {
      text = buf.toString("utf-8");
    } else if (ext === "pdf") {
      const data = await pdfParse(buf);
      text = data.text;
    } else if (ext === "docx" || ext === "doc") {
      const result = await mammoth.extractRawText({ buffer: buf });
      text = result.value;
    } else {
      return NextResponse.json({ error: "Unsupported file type. Upload a .txt, .pdf, or .docx." }, { status: 400 });
    }
    if (!text.trim()) {
      return NextResponse.json({ error: "Could not extract text from this file. Try pasting instead." }, { status: 400 });
    }
    return NextResponse.json({ text: text.trim() });
  } catch (err) {
    console.error("extract-text error:", err);
    return NextResponse.json({ error: "Failed to read the file. Please paste your resume instead." }, { status: 500 });
  }
}
