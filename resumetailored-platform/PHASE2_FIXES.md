# Phase 2 tool fixes — ATS upload, Interview Practice, Job Finder empty search

`next build` green. Three fixes.

## FIX 1 — ATS Scanner: resume upload
Added an **Upload resume** button above the resume field (`ats-scanner.tsx`). It
accepts `.pdf` / `.docx` / `.doc` / `.txt`, posts to the existing
`/api/extract-text` route, and drops the extracted text into the textarea — which
stays fully editable. 10MB cap; shows the imported filename. (Same flow the
Resume Builder already uses.)

## FIX 2 — Interview Coach: Practice flow
The route and state were already correct, but the Practice tab only showed a
dropdown + a footer button, so it read as "nothing happens." Reworked the
Practice panel (`interview-coach.tsx`) to the spec:
1. the **selected question is shown at the top** in a highlighted card (with its
   behavioral/technical tag),
2. a **"Switch question"** dropdown (only when >1 question),
3. the **answer textarea**,
4. an **inline "Get feedback" button** right under it (no longer dependent on the
   footer), which POSTs `action: "feedback"` and
5. renders the **scored feedback** — overall /5, structure/relevance/keywords,
   strengths, improvements.

"Practice this →" on the Questions tab still selects the question and switches
tabs. The `/api/interview-coach` feedback format was verified to match what the
UI renders (`{ overall, scores:{structure,relevance,keywords}, strengths,
improvements, summary }`).

## FIX 3 — Job Finder: empty-keyword search
`/api/jobs/search` now **omits the `what` parameter when the keyword is blank**,
so a location-only search returns all jobs in that location (and no keyword +
no location is the only blocked case). If **both** keyword and location are
empty it returns `Enter a keyword, location, or both to search.` The client
(`job-finder.tsx`) was relaxed to allow a location-only search and shows the
same message when both are empty.

## Files changed
- `app/candidate/tools/ats-scanner.tsx` — upload button + extract-text wiring.
- `app/candidate/tools/interview-coach.tsx` — reworked Practice panel + inline button.
- `app/api/jobs/search/route.ts` — optional `what`, require ≥1 field.
- `app/candidate/tools/job-finder.tsx` — allow location-only search.

## Verify after deploy
- **ATS:** open ATS Scanner → Upload resume (pick a PDF) → text fills in → edit → Scan.
- **Interview:** generate questions → Practice tab (or "Practice this →") → the
  question shows at top → type an answer → Get feedback → scores appear.
- **Job Finder:** search with location only (blank keyword) → results; blank both → message.

## Note
I can't drive the Clerk-authed UI from here, so these are verified via the
production build. If anything still misbehaves live, tell me exactly what you see
and I'll fix it.
