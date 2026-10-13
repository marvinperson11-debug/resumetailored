# Employer resume viewer (PDF.js + annotations)

In-portal review of a candidate's resume PDF, with private highlights and notes. **Ships OFF**
(`RESUME_VIEWER_ENABLED = false`, `lib/resume-viewer-flag.ts`) until the fidelity gate passes on a corpus that includes
real exports — see *Launch checklist*. Decision record: the PDFCraft evaluation chose PDF.js; PDFCraft is an alpha,
non-embeddable app and is not used.

## What an employer sees

Candidate drawer → **Resume (PDF)**: the PDF paged and zoomable, with tools to **highlight** (drag a rectangle) and
**add a note** (click to drop a pin), four colours, edit / recolour / delete, an Expand button. "Only your team sees
annotations — the candidate never does, and the PDF itself is never changed." Nothing renders for an applicant with no PDF
on file (a pasted resume, a public-board application). The signed-out **demo** pipeline gets a "View resume" button per sample
candidate: the same viewer on a fixture PDF, **read-only**, with sample annotations.

## Data path

```
add-applicant form ─ upload PDF ─▶ POST /api/employer/candidates/extract ─▶ private bucket `applicant-resumes`
                                      (already existed)                     {employerId}/resume/{ts}-{name}.pdf
        │ returns { path }                                                  
        ▼
POST /api/employer/candidates { …, resumePath }  ─ isOwnResumePath() ─▶ applicant_resume_files(applicant_id → path)   [0049]

drawer opens ─▶ GET /api/employer/candidates/:id/resume
                  resolveResumeAccess: employerContext → flag → applicant belongs to caller's job? (else 403)
                  ─▶ createSignedUrl(path, 60 s)  +  the team's annotations
              ─▶ dynamic import("./pdf-viewer")  (PDF.js, its own chunk)  ─▶ canvas per page + our AnnotationLayer
              ─▶ add / edit / delete ─▶ /api/employer/candidates/:id/annotations[/:annId] ─▶ resume_annotations   [0049]
```

* **No public URL anywhere.** The bucket is private; the signed-URL route is the only way a browser gets bytes; the URL
  lives 60 s and the response is `no-store`. The raw storage path is never a response field.
* **Wrong employer → 403**, and a non-existent applicant answers identically (no existence oracle). A guest or any
  non-employer account is 403. With the flag off a signed-in employer gets 404. Negative (demo) ids are never valid on the live routes.
* **Annotations never touch the PDF** and are **never visible to candidates**: they live in `resume_annotations`
  (employer_id, candidate_resume_id, page, page-normalised 0..1 `x y w h`, kind, text, colour, created_by, created_at),
  which only `lib/resume-annotations-store.ts` reads, only employer-authenticated routes import, RLS-on with anon /
  authenticated *revoked* and no policy, and a composite FK so an annotation's employer must equal its file's. Page-normalised
  coordinates survive zoom, phone vs desktop, and a renderer swap. The workspace shares annotations (a team member's
  are recorded under their own user id); 500 per resume.
* **Demo**: static fixtures `public/demo-resumes/<key>.pdf` (fictional, built by `scripts/build-demo-resumes.py`), negative
  ids, no network call, no signed URL, create/update/delete refuse. Fixtures are in `lib/employer-demo.ts`; the sample note text is `resumeViewer.demo.*`.

## Migration `0049_resume_annotations.sql` — new tables only

`applicant_resume_files` (applicant → private-bucket path; the add-applicant form archived the file but never recorded the
link, so there was nothing to open) and `resume_annotations`. Nothing existing is altered; no env vars; the service-role
pattern is the existing one. Verified against Postgres 16 (idempotent re-run, every CHECK, the composite FK, unique-per-applicant,
anon/authenticated denied, service_role allowed, cascade delete).

## Lazy loading and fallback

* PDF.js (`pdfjs-dist` **4.10.38**, pinned; the *legacy* build for older Safari/Android) is imported in exactly one file,
  `resume-viewer/pdf-viewer.tsx`, which is only ever reached by `import()` from `resume-section.tsx`, itself loaded with
  `next/dynamic` by the two callers. First measured build: PDF.js is one 108 kB-gzip lazy chunk; main bundle +0.05%;
  `/employer/candidates` first load +1.5 kB gzip (the dynamic wrapper). `npm run check:bundle` asserts PDF.js is in **no**
  route's initial JS (and that it *is* in the build, so the check can't pass vacuously), main bundle within ±0.5% of
  `scripts/bundle-baseline.json`, and the route within +2 kB. Refresh the baseline deliberately:
  `node scripts/check-bundle-size.cjs --update` (or `--baseline-from <checkout>`).
* The worker, CMaps and standard fonts are copied to `public/pdfjs/` (gitignored) by `scripts/copy-pdfjs-assets.mjs`
  (`prebuild` / `predev`); the worker's file name carries the version so API and worker can't mismatch. (Bundling the worker
  breaks Next's Terser pass.) `isEvalSupported:false` — CVE-2024-4367 is fixed in ≥ 4.2.67 and eval stays off regardless.
* If the chunk fails to load, the worker won't start, the file is corrupt, or a page won't paint, the section falls back
  to the browser's own PDF viewer in an `<iframe>` on a **fresh** signed URL, with a notice that highlights and notes
  aren't available, and a *Try the full viewer again* button.

## Fidelity gate (launch condition)

`npm run test:resume-fidelity` → `fidelity/README.md`, `fidelity/report.json`. 22 documents (Word-, Google-Docs-,
Canva-style, non-embedded fonts incl. Chinese, two scans, five Chinese-language), rendered with the shipped PDF.js options,
judged on load / text / layout / fonts / paint-vs-poppler; **mangled > 2% ⇒ the feature stays off**, and CI fails if the flag is
on while the gate fails. Current result: **0 / 22 mangled** in Node, and 22 / 22 in real Chromium (manual
`scripts/e2e-fidelity-browser.cjs`). **Honest caveat: the corpus is synthetic stand-ins** (no genuine Word/Canva/Google Docs
exports were obtainable), so the flag stays off and CI refuses `true` until the corpus has real exports.

## Tests

| command | what |
|---|---|
| `npm run test:resume-viewer` | real handlers + stores + components: flag, signed-URL access control (guest / non-employer / wrong employer → 403, 60 s, private bucket, no public URL), annotation CRUD + validation + scoping (other employer, team member, composite FK), candidates-never-see structure, add-applicant link safety, demo read-only (no network), fallback paths, the annotation layer's gestures and read-only mode, lazy-import structure, i18n parity |
| `npm run test:resume-fidelity` | the gate above, with four negative controls |
| `npm run check:bundle` | after `npm run build`: PDF.js out of every initial bundle, main-bundle delta ~0 |
| `scripts/e2e-resume-viewer.cjs`, `scripts/e2e-fidelity-browser.cjs` | **manual**, real Chromium (see headers) |
| `npm run test:guest-gate` | the employer-route classification test now knows `resolveResumeAccess` is a session gate; every new route is refused for a guest |

## Launch checklist

1. Apply `supabase/migrations/0049_resume_annotations.sql`.
2. Add real resume exports (with consent) to `fidelity/corpus/`, per `fidelity/README.md`; the gate must pass at ≤ 2%.
3. Run the two manual browser scripts with the flag temporarily on.
4. Set `RESUME_VIEWER_ENABLED = true` in `lib/resume-viewer-flag.ts` (one reviewed line).

## Known limits / not in this phase

Highlights are rectangles (no text-selection highlight, no search / copy text layer); only applicants whose PDF was uploaded
through the add-applicant form have a viewable file (public-board applicants submit text only — a follow-up if wanted);
annotations are shared across the employer workspace; a Chinese résumé whose font is not embedded needs a system CJK font
on the viewer's machine (every desktop has one) — otherwise the fallback iframe is what they see.
