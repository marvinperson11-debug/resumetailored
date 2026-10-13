"use client";

/**
 * Client-side PDF export via the browser's print engine — the same approach as
 * the old site's `downloadPdf`. It renders the chosen template in print mode
 * (`renderAIOutput` with printMode) into a new window and calls `window.print()`,
 * so the user saves as PDF. No server, no headless Chromium — works everywhere
 * and reproduces the on-screen template exactly.
 */

const WATERMARK = "Made with ResumeTailored AI · resumetailored.com";

/**
 * Generic PDF export for a Documents Creator document (any kind whose body is
 * already plain HTML — composed docs, the Spreadsheet Creator's saved table,
 * the Report Writer's generated report). Same browser-print approach as
 * `downloadPdf` above, minus the resume-template machinery: it prints the
 * sanitized `body_html` as-is, since that's exactly what the viewer already
 * renders.
 */
export function downloadDocumentPdf(title: string, bodyHtml: string): boolean {
  const win = window.open("", "_blank");
  if (!win) return false;
  const safeTitle = (title || "Document").replace(/</g, "&lt;");
  win.document.write(`<!DOCTYPE html>
<html>
<head>
  <meta charset="UTF-8">
  <title>${safeTitle}</title>
  <style>
    *, *::before, *::after { box-sizing: border-box; }
    @page { size: letter; margin: 0.75in; }
    body { font-family: Arial, Helvetica, sans-serif; color: #1a1a2e; margin: 0; }
    h1 { font-size: 1.5rem; font-weight: 800; margin: 0 0 0.5rem; }
    h2 { font-size: 1.2rem; font-weight: 700; margin: 1rem 0 0.4rem; }
    p { margin: 0 0 0.6rem; line-height: 1.5; }
    ul, ol { margin: 0 0 0.6rem; padding-left: 1.4rem; }
    table { border-collapse: collapse; width: 100%; }
    p, li, tr { page-break-inside: avoid; break-inside: avoid; }
    a { color: #4f46e5; }
  </style>
</head>
<body>
  ${bodyHtml}
  <script>window.onload = function(){ setTimeout(function(){ window.print(); }, 300); };<\/script>
</body>
</html>`);
  win.document.close();
  return true;
}

/**
 * PDF export for the Presentation Builder — one slide per printed page,
 * landscape, dark theme matching the in-app Present mode. Same
 * `window.print()` approach as `downloadPdf`/`downloadDocumentPdf`; each
 * `.slide` is sized to exactly one page and separated with
 * `page-break-after`, so a 5-slide deck prints as a 5-page PDF.
 */
export function downloadPresentationPdf(deck: { title: string; slides: { title: string; bullets: string[] }[] }): boolean {
  const win = window.open("", "_blank");
  if (!win) return false;
  const esc = (s: string) => String(s || "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
  const safeTitle = esc(deck.title || "Presentation");
  const slidesHtml = deck.slides
    .map(
      (s, i) => `<section class="slide">
    <h1>${esc(s.title)}</h1>
    <ul>${s.bullets.map((b) => `<li>${esc(b)}</li>`).join("")}</ul>
    <div class="counter">${i + 1} / ${deck.slides.length}</div>
  </section>`
    )
    .join("\n");

  win.document.write(`<!DOCTYPE html>
<html>
<head>
  <meta charset="UTF-8">
  <title>${safeTitle}</title>
  <style>
    *, *::before, *::after { box-sizing: border-box; -webkit-print-color-adjust: exact !important; print-color-adjust: exact !important; }
    @page { size: letter landscape; margin: 0; }
    body { margin: 0; font-family: Arial, Helvetica, sans-serif; background: #0B0F19; }
    .slide {
      position: relative; width: 100%; height: 100vh; padding: 12% 10%;
      display: flex; flex-direction: column; justify-content: center;
      background: #0B0F19; color: #fff;
      page-break-after: always; break-after: page;
    }
    .slide:last-child { page-break-after: auto; break-after: auto; }
    .slide h1 { font-size: 2.4rem; font-weight: 700; margin: 0 0 1.2rem; color: #fff; }
    .slide ul { margin: 0; padding-left: 1.2em; font-size: 1.3rem; line-height: 1.7; color: #e5e5e5; }
    .slide li { margin: 0 0 0.5em; }
    .slide .counter { position: absolute; bottom: 6%; right: 8%; font-size: 0.9rem; color: #ffffff66; }
  </style>
</head>
<body>
  ${slidesHtml}
  <script>window.onload = function(){ setTimeout(function(){ window.print(); }, 300); };<\/script>
</body>
</html>`);
  win.document.close();
  return true;
}

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
