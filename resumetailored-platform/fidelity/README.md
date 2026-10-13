# Resume-viewer fidelity corpus

The launch condition for the employer resume viewer: **a viewer that mangles resumes is worse than no viewer.**
`scripts/test-resume-fidelity.cjs` (CI, `npm run test:resume-fidelity`) renders every PDF here with the PDF.js build and
document options the viewer ships (`app/employer/components/resume-viewer/pdfjs-config.ts`) and judges each one. The
mangled rate must be **≤ 2%** — with 22 documents that means no failures at all. The result is committed as
`fidelity/report.json`; while the gate fails (or while the corpus holds no real exports) `RESUME_VIEWER_ENABLED` in
`lib/resume-viewer-flag.ts` must stay `false`, and CI enforces that.

## What is judged, per document

| check | how |
|---|---|
| load | opens; page count equals poppler's (an independent reader) |
| text | ≥ 90% of the expected phrases — taken from the content the PDF was built from, not from PDF.js's own output — are in the extracted text. Chinese documents are judged per Han character (≥ 70%): Chromium/Skia subset fonts map some glyphs to Kangxi-radical or traditional code points in ToUnicode, so the text layer can say 戶/長 where the page paints 户/长. The painted page is judged strictly below. |
| layout | anchor phrases sit in the right horizontal band of the right page (sidebars, columns); no text outside the page; ≤ 2% of text runs overlap another |
| fonts | PDF.js raised no font / CMap / glyph warning |
| render | the page paints on a canvas without throwing; and its **ink agrees ≥ 85%** (recall *and* precision, 2 px tolerance) with poppler's golden render in `golden/`. Scans have no text layer: they are judged on PDF.js's own decode of the image (not blank, not black). |

Four **negative controls** run on every CI pass (absent text, a non-embedded Chinese font *without* the CMaps, a wrong
page count, a wrong reference render) and must all be judged mangled, so the gate cannot go vacuous.

## What is in it — and what is not

22 documents, every person fictional: Word-style (DOCX → PDF via LibreOffice: single column, sidebar table, multi-page
with header/footer, skills table, Chinese, bilingual), Google-Docs-style (HTML → PDF via Chromium's Skia backend, the
producer Google Docs exports with: links, two-column grid, tables, multi-page, two Chinese), Canva-style (absolute
positioned shapes/sidebars/rotated labels/word-by-word runs), **non-embedded fonts** (Helvetica, Times two-column,
Courier, and an Adobe-GB1 Chinese CID font), and two **scans** (image-only, skewed, noisy). Five are Chinese-language.

**These are structural stand-ins, not genuine exports.** A PDF saved by Microsoft Word, Canva or Google Docs themselves
could not be obtained in the build sandbox. They exercise the same *PDF structures* (font embedding, run granularity,
tables vs absolute positioning, image-only pages) but not those products' own quirks. The corpus is therefore **not yet
sufficient to turn the feature on** — add real exports first (below). `fidelity/report.json` says so in
`corpusProvenance`.

## Adding real resumes

Never commit a real person's resume without their written consent. Use a volunteer's, or one you wrote yourself.

1. Drop the PDF in `fidelity/corpus/`, and add an entry to `fidelity/manifest.json`:
   `{ "id", "file", "family": "word|gdocs|canva|nonembed|scan|real", "lang": "en|zh|zh+en", "pages", "expectText": [short phrases that must be extractable], "anchors": [{"text","page","band":[x0,x1]}], "scan": false, "real": true }`
2. `pdftoppm -r 72 -gray -png -f N -l N -singlefile file.pdf fidelity/golden/<id>-N` for each page (not for scans).
3. `npm run fidelity:report`, then commit the corpus entry, the golden PNGs and the regenerated `report.json`.
4. Only when the corpus includes real exports **and** the gate passes may `RESUME_VIEWER_ENABLED` become `true`.

`build-corpus.py` regenerates the synthetic documents (needs reportlab, python-docx, Pillow, LibreOffice, Chromium).

## Real-browser run (manual)

`scripts/e2e-fidelity-browser.cjs` runs the same corpus through real Chromium with the same options and the same
ink comparison, and saves every rendered page. It is the only place the one document Node cannot paint — a Chinese
résumé whose font is **not embedded** (`nonembedded-zh-stsong`, judged text-only in CI) — is judged visually, using the
machine's system CJK font. Last run (Chromium 141, system Noto Sans SC): **22 / 22 faithful**; lowest ink agreement
86% (Chromium-printed Google-Docs-style pages, thin 72 dpi strokes); the Chinese non-embedded page paints correctly.
