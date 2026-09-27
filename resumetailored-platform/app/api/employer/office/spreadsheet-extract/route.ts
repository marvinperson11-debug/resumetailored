import { NextResponse } from "next/server";
import { employerContext } from "@/lib/employer-auth";
import { isScalePlusTier } from "@/lib/employer-plan";
import { getAnthropic, CLAUDE_MODEL, isProviderUnavailable } from "@/lib/ai";
import { extractJson } from "@/lib/tools-ai";
import { buildSpreadsheetPrompt, parseCsvTable, sanitizeGrid, type SpreadsheetGrid } from "@/lib/office-hub";
// Import pdf-parse's internal module directly, same fix as /api/extract-text:
// the package's index.js runs a debug block on import that crashes in a
// bundled server.
// eslint-disable-next-line @typescript-eslint/no-require-imports
import pdfParse from "pdf-parse/lib/pdf-parse.js";
import mammoth from "mammoth";

export const runtime = "nodejs";
export const maxDuration = 60;

const MAX_BYTES = 10 * 1024 * 1024; // 10MB, same cap as /api/extract-text
const MAX_DESCRIPTION = 2000;

/** Magic-byte check so a renamed/MIME-spoofed file can't slip through — same
 *  approach as /api/extract-text, extended with a CSV case (plain text, no
 *  signature, like .txt). */
function magicOk(ext: string, buf: Buffer): boolean {
  if (ext === "txt" || ext === "csv") return true;
  if (ext === "pdf") return buf.subarray(0, 5).toString("latin1") === "%PDF-";
  if (ext === "docx" || ext === "doc") {
    const pk = buf[0] === 0x50 && buf[1] === 0x4b;
    const ole = buf[0] === 0xd0 && buf[1] === 0xcf && buf[2] === 0x11 && buf[3] === 0xe0;
    return pk || ole;
  }
  return false;
}

/**
 * POST multipart { file, description? } → a structured spreadsheet grid, for
 * the Spreadsheet Creator's "Upload sources" path. A .csv is parsed directly
 * (no AI call needed — it's already tabular); .pdf/.docx/.doc/.txt are
 * text-extracted the same way the resume parser does, then handed to the AI
 * to structure into rows. Scale+ only, same gate as Charts.
 */
export async function POST(req: Request) {
  const ctx = await employerContext();
  if (!ctx) return NextResponse.json({ error: "forbidden" }, { status: 403 });
  if (!isScalePlusTier(ctx.access)) return NextResponse.json({ error: "The Spreadsheet Creator is available on the Scale+ plan." }, { status: 403 });

  let file: File | null = null;
  let description = "";
  try {
    const form = await req.formData();
    const f = form.get("file");
    if (f instanceof File) file = f;
    description = String(form.get("description") || "").trim().slice(0, MAX_DESCRIPTION);
  } catch {
    return NextResponse.json({ error: "Invalid upload." }, { status: 400 });
  }
  if (!file) return NextResponse.json({ error: "No file uploaded." }, { status: 400 });
  if (file.size > MAX_BYTES) return NextResponse.json({ error: "That file is too large (max 10MB)." }, { status: 413 });

  const ext = (file.name || "").toLowerCase().split(".").pop() || "";
  const buf = Buffer.from(await file.arrayBuffer());
  if (!magicOk(ext, buf)) {
    return NextResponse.json({ error: "This file's contents don't match a real .csv, .txt, .pdf, or .docx document." }, { status: 400 });
  }

  if (ext === "csv") {
    const grid = parseCsvTable(buf.toString("utf-8"));
    if (grid.headers.length === 0) return NextResponse.json({ error: "Could not find any columns in that CSV." }, { status: 400 });
    return NextResponse.json({ grid });
  }

  let text = "";
  try {
    if (ext === "txt") {
      text = buf.toString("utf-8");
    } else if (ext === "pdf") {
      text = (await pdfParse(buf)).text;
    } else if (ext === "docx" || ext === "doc") {
      text = (await mammoth.extractRawText({ buffer: buf })).value;
    } else {
      return NextResponse.json({ error: "Unsupported file type. Upload a .csv, .txt, .pdf, or .docx." }, { status: 400 });
    }
  } catch (err) {
    console.error("[spreadsheet-extract] extraction failed:", err);
    return NextResponse.json({ error: "Failed to read the file." }, { status: 500 });
  }
  if (!text.trim()) return NextResponse.json({ error: "Could not extract any text from this file." }, { status: 400 });

  const anthropic = getAnthropic();
  if (!anthropic) return NextResponse.json({ error: "not_configured", message: "AI generation isn't configured on this server." }, { status: 501 });

  const { system, user } = buildSpreadsheetPrompt({ description, extractedText: text });
  try {
    const msg = await anthropic.messages.create({ model: CLAUDE_MODEL, max_tokens: 4000, system, messages: [{ role: "user", content: user }] });
    console.log("[spreadsheet-extract] usage", { employerId: ctx.employerId, ext, ...msg.usage });
    const block = msg.content[0];
    const raw = extractJson<Record<string, unknown>>(block && block.type === "text" ? block.text : "");
    const grid: SpreadsheetGrid | null = raw ? sanitizeGrid(raw) : null;
    if (!grid) return NextResponse.json({ error: "Could not structure a spreadsheet from that file. Try pasting the description instead." }, { status: 502 });
    return NextResponse.json({ grid });
  } catch (err) {
    console.error("[spreadsheet-extract]", err);
    const message = isProviderUnavailable(err) ? "The AI provider is temporarily overloaded. Please try again." : "Could not structure the spreadsheet. Please try again.";
    return NextResponse.json({ error: message }, { status: 502 });
  }
}
