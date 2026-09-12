"use client";

/**
 * Client-side PDF export via the browser's print engine — the same approach as
 * the old site's `downloadPdf`. It renders the chosen template in print mode
 * (`renderAIOutput` with printMode) into a new window and calls `window.print()`,
 * so the user saves as PDF. No server, no headless Chromium — works everywhere
 * and reproduces the on-screen template exactly.
 */
import { renderAIOutput, findTemplate, type Mode, type CoverMeta } from "./resume-templates";

const WATERMARK = "Made with ResumeTailored AI · resumetailored.com";

export function downloadPdf(opts: {
  text: string;
  tplId: string;
  mode: Exclude<Mode, "both">;
  title?: string;
  isPro?: boolean;
  docFont?: string;
  coverMeta?: CoverMeta;
  photo?: string;
  signature?: string;
  sigFont?: string;
  accentColor?: string;
}): boolean {
  const { text, tplId, mode, title = "Resume", isPro = false, docFont, coverMeta, photo, signature, sigFont, accentColor } = opts;
  if (!text || !text.trim()) return false;

  const cat = mode === "cover_letter" ? "cover" : "resume";
  const tpl = findTemplate(cat, tplId);
  // Honor a custom accent colour for the print-only band colours too.
  const validAccent = accentColor && /^#[0-9a-fA-F]{6}$/.test(accentColor) ? accentColor : null;
  const cP = validAccent || tpl.c.p;
  const cA = validAccent || tpl.c.a;
  const font = tpl.serif ? "Georgia,'Times New Roman',serif" : "'Helvetica Neue',Arial,sans-serif";
  const printContent = renderAIOutput(text, tplId, mode, { printMode: true, docFont, coverMeta, photo, signature, sigFont, accentColor });

  const win = window.open("", "_blank");
  if (!win) return false;

  const isCoverBanner = ["cModern", "cBold", "cSplit", "rModern", "rSidebar"].includes(tpl.layout);
  const isSidebar = tpl.layout === "rSidebar";
  const isTwoCol = tpl.layout === "rTwoCol";
  // "Banded" layouts have a full-height left column (a colored sidebar, or the
  // two-column divider). In print, an element's background does NOT stretch to
  // fill each page fragment, so a long resume showed the band only where the
  // text reached. Fix: paint the band as a FIXED page background — a fixed
  // background in paged media is repainted on every page, so the band reaches
  // the bottom of every page regardless of where the content ends. Banded
  // layouts print full-bleed (margin 0) so the band's x-offsets line up with
  // the column. Covers all 8 sidebar color variants (shared rSidebar layout).
  const pageBand = isSidebar
    ? `linear-gradient(to right, ${cP} 215px, #fff 215px)`
    : isTwoCol
    ? `linear-gradient(to right, #fff 218px, ${cA}55 218px, ${cA}55 220px, #fff 220px)`
    : null;
  const fullBleed = isCoverBanner || isTwoCol;
  const bodyBg = tpl.layout === "cClean" ? (validAccent ? "#fff" : tpl.c.l) : "#fff";

  const safeTitle = title.replace(/</g, "&lt;");
  win.document.write(`<!DOCTYPE html>
<html>
<head>
  <meta charset="UTF-8">
  <title>${safeTitle}</title>
  <link rel="preconnect" href="https://fonts.googleapis.com">
  <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
  <link href="https://fonts.googleapis.com/css2?family=Dancing+Script:wght@600&family=Great+Vibes&display=swap" rel="stylesheet">
  <style>
    *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; -webkit-print-color-adjust: exact !important; print-color-adjust: exact !important; }
    @page { size: letter; margin: ${fullBleed ? "0" : "0.5in"}; }
    .rt-watermark { position: fixed; bottom: 6px; left: 0; right: 0; text-align: center; font-size: 8px; color: #9aa3af; letter-spacing: .3px; font-family: Arial, sans-serif; }
    html { background: ${pageBand || "#fff"}; ${pageBand ? "background-attachment: fixed; background-repeat: no-repeat; background-size: 100% 100%;" : ""} -webkit-print-color-adjust: exact !important; print-color-adjust: exact !important; }
    body { font-family: ${font}; color: #222; background: ${pageBand ? "transparent" : bodyBg}; overflow-wrap: anywhere; word-break: normal; hyphens: none; }
    .page { width: 100%; min-width: 0; }
    p, li { page-break-inside: avoid; break-inside: avoid; overflow-wrap: anywhere; }
    div { overflow-wrap: anywhere; word-break: normal; hyphens: none; min-width: 0; }
  </style>
</head>
<body>
  <div class="page">${printContent}</div>
  ${isPro ? "" : `<div class="rt-watermark">${WATERMARK}</div>`}
  <script>window.onload = function(){
    ${
      mode === "cover_letter"
        ? `var p = document.querySelector('.page'); if (p) { var ph = ${isCoverBanner ? 1056 : 960}, ch = p.scrollHeight; if (ch > ph) document.documentElement.style.zoom = ph / ch; }`
        : ""
    }
    setTimeout(function(){ window.print(); }, ${mode === "cover_letter" ? 700 : 400});
  };<\/script>
</body>
</html>`);
  win.document.close();
  return true;
}

// Word (.docx) export now lives in `lib/docx.ts` — a zero-dependency,
// fully client-side generator (no server round-trip). Import `downloadDocx`
// from there.

export function downloadTxt(text: string, filename: string, isPro: boolean) {
  let out = text;
  if (!isPro) out += "\n\n—\n" + WATERMARK;
  const blob = new Blob([out], { type: "text/plain" });
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = filename.replace(/[^a-z0-9-_ ]/gi, "_") + ".txt";
  a.click();
  URL.revokeObjectURL(a.href);
}
