import { execFile } from "child_process";
import { mkdtemp, readFile, rm, writeFile } from "fs/promises";
import { tmpdir } from "os";
import { join } from "path";

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
