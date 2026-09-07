# AI Resume Builder — four fixes (signature, inline edit, .docx, disclaimer)

`next build` green. Signature verified rendering in all 104 templates × screen+print
(208/208). .docx generation verified at runtime (valid file). Built on
`claude/candidate-dashboard-tool-dock-c4k29d`.

---

## FIX 1 — signature placement (highest priority)
The signature no longer floats/overlays. It's now rendered **inside** each layout's
content flow instead of being appended over the whole card:

- **Classic / Executive / Minimal (linear):** at the end of the content, inside the card.
- **Sidebar:** in the **main content column** (never over the colored sidebar).
- **Two-Column:** **full width below both columns**.
- **Modern / Banner:** below the sections, inside the content padding.
- **Cover letters:** as a "Sincerely," sign-off at the end of the letter body.

The signature block carries no horizontal padding of its own, so it inherits each
container's padding and lines up with the body. The horizontal rule sits directly
under the signature text. Same code path drives the live preview and the PDF, so
they match.

## FIX 2 — inline editing
After the AI generates, the preview pane has an **Edit text / Preview** toggle:
- **Edit** shows the resume text in an editable field; changes are **live**.
- Because edits update the source text, they flow into the template preview, the
  signature placement, and **every download (PDF, TXT, .docx)** — and autosave
  captures the edited version.
- **Reset to AI version** appears once you've edited, and restores the original
  AI output.

Design note: I made the editable surface the resume *text* (not a raw
contentEditable on the styled template). That's the reliable way to guarantee
"edited content is what gets downloaded" and that the signature still lands
correctly — editing the rendered template HTML directly can't round-trip back
through the template engine (especially multi-column layouts) without corrupting
section order. If you'd specifically prefer click-in-place contentEditable on the
rendered document (accepting that it works cleanly only on single-column
templates), tell me and I'll layer that on for those layouts.

## FIX 3 — .docx export
New **.docx** button next to PDF and TXT. Server route `/api/download-docx` builds
the Word file with the `docx` library (signed-in only):
- Includes the **photo** (if uploaded), all **sections**, the **signature**, and
  the **chosen body font**.
- Uses the same `parseAIOutput` parser as the on-screen renderer, so section
  structure matches the preview.
- **Approximates** the template: the template's primary color drives the name and
  section headers, the accent color the sub-rules/dates.

Honest limitation (this is why the disclaimer exists): Word has no equivalent of
the CSS sidebar/two-column layouts, so the .docx is a clean **single-column**
document in the template's colors/font rather than a pixel copy. The **PDF**
remains the layout-faithful export. Photo is inserted square (Word can't
circle-crop without image pre-processing).

## FIX 4 — disclaimer
Added below the preview panel, above the download buttons, in small subtle gray:

> "PDF and Word downloads may look slightly different from the on-screen preview
> due to browser rendering vs. document engine differences. For best results,
> review your download before sending."

(While editing, that line swaps to a short hint that edits flow into every download.)

---

## Files
- `lib/resume-templates.ts` — signature threaded into every renderer with correct placement.
- `app/api/download-docx/route.ts` — new Word export route (docx lib).
- `lib/pdf.ts` — `downloadDocx()` client helper.
- `app/candidate/tools/resume-tailor.tsx` — edit toggle + editable field + Reset, .docx button, disclaimer.
- `package.json` — added `docx`.

## Verify after deploy
Generate a resume → **Edit text**, tweak a line → **Preview** (change persists) →
switch template to Sidebar / TwoCol / Banner and confirm the signature sits at the
bottom of the content (not over the sidebar) → **Download .docx**, open in Word and
check the photo, sections, signature, and font.

## One open question
- **contentEditable vs text edit** (see FIX 2 note): keep the reliable text editor,
  or add true click-in-place editing for single-column templates too?
