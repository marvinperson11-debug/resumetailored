/**
 * The ONE place the PDF.js document options live. The in-browser viewer (pdf-viewer.tsx) and the CI
 * fidelity gate (scripts/test-resume-fidelity.cjs) both call this, so the gate exercises exactly the
 * configuration a recruiter's browser runs — a font or CMap option tweaked here is tested, not assumed.
 *
 * - isEvalSupported:false  — PDF.js < 4.2.67 could run attacker-controlled script via a crafted font
 *   (CVE-2024-4367). Resumes are untrusted uploads, so eval-based font compilation stays off even on
 *   a patched version.
 * - cMapUrl / standardFontDataUrl — what lets a PDF with NON-embedded fonts (a Chinese resume that
 *   names SimSun without shipping it, a Word export that leaves Arial out) render with substitutes
 *   instead of blank or garbled text. `scripts/copy-pdfjs-assets.mjs` publishes both under /pdfjs/.
 * - enableScripting:false / no XFA — a resume is a read-only document; no embedded JavaScript runs.
 */
export interface PdfjsAssetBase {
  /** Base URL (or filesystem path) of the directory holding `cmaps/` and `standard_fonts/`, with a trailing slash. */
  base: string;
}

export function pdfjsDocOptions({ base }: PdfjsAssetBase) {
  return {
    isEvalSupported: false,
    enableXfa: false,
    useSystemFonts: true,
    cMapUrl: `${base}cmaps/`,
    cMapPacked: true,
    standardFontDataUrl: `${base}standard_fonts/`,
  } as const;
}

/** Where the browser finds the assets published by scripts/copy-pdfjs-assets.mjs. */
export const PDFJS_ASSET_BASE = "/pdfjs/";

/** The worker file published by scripts/copy-pdfjs-assets.mjs; the version in the name keeps API and worker in step. */
export function pdfjsWorkerSrc(version: string): string {
  return `${PDFJS_ASSET_BASE}pdf.worker.min.${version}.mjs`;
}
