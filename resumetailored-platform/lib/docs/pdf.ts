import { execFile } from "child_process";
import { mkdtemp, readFile, rm, writeFile } from "fs/promises";
import { tmpdir } from "os";
import { join } from "path";
import { craftPost } from "../craft/client";
import { docxHasCjk } from "../craft/cjk";
import { wordCraftMode, type WordCraftMode } from "../craft/config";
import { ACCENT_MIN_PIXELS, accentPixels, decodePng, docxExpectsAccent } from "../craft/fidelity";
import { DOCX_MIME } from "./docx-render";
import { describeError } from "./pipeline";
import { shouldWatermark, WATERMARK_TEXT, type Tier } from "./tier";

/**
 * PDF from the finished DOCX, server-side, with LibreOffice headless. Never the browser's print engine,
 * so there are no URL/date/page-number header or footer artifacts. Returns null when LibreOffice is not
 * installed (the caller answers 501 instead of falling back to client printing).
 */
export async function docxToPdf(docx: Buffer, timeoutMs = 45_000): Promise<Buffer | null> {
  const dir = await mkdtemp(join(tmpdir(), "rt-pdf-"));
  try {
    const src = join(dir, "document.docx");
    await writeFile(src, docx);
    const profile = `file://${join(dir, "lo-profile")}`;
    const ok = await new Promise<boolean>((resolve) => {
      execFile("soffice", ["--headless", "--norestore", `-env:UserInstallation=${profile}`, "--convert-to", "pdf", "--outdir", dir, src], { timeout: timeoutMs }, (err) => resolve(!err));
    });
    if (!ok) return null;
    return await readFile(join(dir, "document.pdf")).catch(() => null);
  } finally {
    await rm(dir, { recursive: true, force: true }).catch(() => {});
  }
}

export interface PdfDeps {
  libreoffice: (docx: Buffer) => Promise<Buffer | null>;
  craft: typeof craftPost;
  mode: () => WordCraftMode;
}
const DEFAULT_DEPS: PdfDeps = { libreoffice: (docx) => docxToPdf(docx), craft: craftPost, mode: wordCraftMode };

/**
 * THE export-PDF entry point (app/api/documents/export). WORDCRAFT_PDF_MODE (lib/craft/config.ts):
 *  - off (default): exactly docxToPdf() — LibreOffice, nothing else is touched.
 *  - benchmark: the user still gets LibreOffice; free-tier documents are ALSO converted by WordCraft in the
 *    background and the outcome is logged (shadow traffic for the pilot decision; the result is discarded).
 *  - pilot: free-tier documents go to WordCraft first; ANY failure falls back to LibreOffice for that document.
 * Paid documents always take LibreOffice. Not enabled anywhere until the benchmark report has been reviewed.
 */
export async function exportPdf(docx: Buffer, opts: { tier: Tier }, deps: PdfDeps = DEFAULT_DEPS): Promise<Buffer | null> {
  const mode = deps.mode();
  if (mode === "off") return deps.libreoffice(docx);
  if (mode === "pilot" && opts.tier === "free") {
    const wc = await wordCraftPdf(docx, opts.tier, mode, deps);
    return wc ?? deps.libreoffice(docx);
  }
  const pdf = await deps.libreoffice(docx);
  if (mode === "benchmark" && opts.tier === "free") void wordCraftPdf(docx, opts.tier, mode, deps);
  return pdf;
}

/**
 * WordCraft conversion through the Craft sidecar, or null (and one log line saying why) — never throws.
 * Guards, in order: CJK text (WordCraft's documented tofu bug) -> LibreOffice; sidecar unavailable / CLI error /
 * timeout / not a PDF -> LibreOffice; then the output must honour the same rules as the LibreOffice PDF: the
 * free-tier footer line present exactly when tier.ts says so, and the Professional navy on page 1 whenever the
 * document uses the accent styles. Logs carry reasons and codes only, never document text.
 */
async function wordCraftPdf(docx: Buffer, tier: Tier, mode: WordCraftMode, deps: PdfDeps): Promise<Buffer | null> {
  const t0 = Date.now();
  const fallback = (reason: string, extra: Record<string, unknown> = {}): null => {
    console.error("[docs/pdf] wordcraft fallback to LibreOffice", JSON.stringify({ mode, tier, reason, ms: Date.now() - t0, ...extra }));
    return null;
  };
  try {
    if (await docxHasCjk(docx)) return fallback("cjk");
    const conv = await deps.craft("/docx/convert", docx, { filename: "document.docx", mime: DOCX_MIME });
    if (conv.kind === "unavailable") return fallback(`sidecar_${conv.reason}`, { detail: conv.detail });
    if (conv.status !== 200) return fallback("convert_failed", { status: conv.status, code: conv.code });
    const pdf = conv.body;
    if (!pdf.subarray(0, 1024).includes("%PDF-")) return fallback("not_pdf");

    const text = await deps.craft("/pdf/text", pdf, { filename: "document.pdf", mime: "application/pdf" });
    if (text.kind === "unavailable") return fallback(`verify_${text.reason}`);
    if (text.status !== 200) return fallback("verify_failed", { status: text.status, code: text.code });
    if (text.body.toString("utf8").replace(/\s+/g, " ").includes(WATERMARK_TEXT) !== shouldWatermark(tier, "pdf")) return fallback("watermark_mismatch");

    if (await docxExpectsAccent(docx)) {
      const page = await deps.craft("/pdf/preview", pdf, { filename: "document.pdf", mime: "application/pdf", query: { maxPages: "1", dpi: "72" } });
      if (page.kind === "unavailable") return fallback(`verify_${page.reason}`);
      if (page.status !== 200) return fallback("verify_failed", { status: page.status, code: page.code });
      const navy = accentPixels(decodePng(page.body));
      if (navy < ACCENT_MIN_PIXELS) return fallback("accent_missing", { navy });
    }
    console.log("[docs/pdf] wordcraft pdf", JSON.stringify({ mode, tier, ms: Date.now() - t0, bytes: pdf.length }));
    return pdf;
  } catch (e) {
    return fallback("error", describeError(e));
  }
}
