import { NextResponse } from "next/server";
import { auth } from "@clerk/nextjs/server";
// Import pdf-parse's internal module directly: the package's index.js runs a
// debug block on import (reading a bundled test PDF) that crashes in a bundled
// server. The lib entry skips it. (Ported behavior from the old site.)
// eslint-disable-next-line @typescript-eslint/no-require-imports
import pdfParse from "pdf-parse/lib/pdf-parse.js";
import mammoth from "mammoth";
import { rateLimit } from "@/lib/rate-limit";
import { guestReserve, withGuestCookie, type GuestGate } from "@/lib/guest";

export const runtime = "nodejs";
export const maxDuration = 30;

const MAX_BYTES = 10 * 1024 * 1024; // 10MB
/** Signed-out uploads are held to 2MB (a resume is a few hundred KB) and 5 a minute. */
const GUEST_MAX_BYTES = 2 * 1024 * 1024;
const GUEST_PER_MINUTE = 5;

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
 * Accepts .txt / .pdf / .docx (and legacy .doc via mammoth). Ported from the old site's
 * `/api/extract-text`.
 *
 * Signed-out visitors may upload too (lib/guest.ts): 2MB, 5 a minute, 3 readable uploads a day.
 * The parse is local (no model), so the only cost is CPU — the caps are what keep it fair.
 */
async function handle(req: Request) {
  const { userId } = await auth(); // no userId = a guest
  const guest = !userId;
  if (guest) {
    const limited = rateLimit(req, "extract-text-guest", GUEST_PER_MINUTE);
    if (limited) return limited;
    // Refuse an oversized body before buffering it (formData() reads the whole upload).
    const declared = Number(req.headers.get("content-length"));
    if (Number.isFinite(declared) && declared > GUEST_MAX_BYTES + 64 * 1024) {
      return NextResponse.json({ error: "That file is too large (max 2MB without an account)." }, { status: 413 });
    }
  }

  let file: File | null = null;
  try {
    const form = await req.formData();
    const f = form.get("file");
    if (f instanceof File) file = f;
  } catch {
    return NextResponse.json({ error: "Invalid upload." }, { status: 400 });
  }
  if (!file) return NextResponse.json({ error: "No file uploaded." }, { status: 400 });
  if (guest && file.size > GUEST_MAX_BYTES) {
    return NextResponse.json({ error: "That file is too large (max 2MB without an account)." }, { status: 413 });
  }
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

  // Guest: count the upload now that it is a plausible resume file; give it back if it cannot be read.
  let gate: GuestGate | null = null;
  if (guest) {
    const reserved = await guestReserve(req, "extract-text");
    if (!reserved.ok) return reserved.response;
    gate = reserved.gate;
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
      await gate?.refund();
      return NextResponse.json({ error: "Unsupported file type. Upload a .txt, .pdf, or .docx." }, { status: 400 });
    }
    if (!text.trim()) {
      await gate?.refund();
      return NextResponse.json({ error: "Could not extract text from this file. Try pasting instead." }, { status: 400 });
    }
    return NextResponse.json({ text: text.trim() });
  } catch (err) {
    await gate?.refund();
    console.error("extract-text error:", err);
    return NextResponse.json({ error: "Failed to read the file. Please paste your resume instead." }, { status: 500 });
  }
}

export const POST = withGuestCookie(handle);
