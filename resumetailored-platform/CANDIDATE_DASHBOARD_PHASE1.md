# Candidate Dashboard — Phase 1 build notes, decisions & open questions

**Where it was built:** the Next.js app (`resumetailored-platform/`), on branch
`claude/candidate-dashboard-tool-dock-c4k29d`. Nothing was added to the old
static site (`public/…`). The old site's logic/prompts/templates were *read* and
ported.

---

## What's done (Phase 1)

**Architecture**
- **Floating tool dock** (`app/candidate/components/tool-dock.tsx`) — persistent
  glass bar, bottom-center, all 10 tool icons + labels, active highlight,
  horizontally scrollable on mobile. Free tools plain; Pro tools (Video, Studio)
  carry a gold lock + "PRO"; Phase-2 tools carry a small teal dot.
- **Tool modal shell** (`tool-modal.tsx`) — dark backdrop, centered glass card,
  header (name + ✕), scrollable body, sticky footer for actions; full-screen on
  mobile, centered on desktop; closes on Esc / backdrop; locks body scroll.
- **Dashboard home** (`dashboard-home.tsx`) — time-based "Good morning, {name}"
  (from Clerk), quick-stat cards, quick actions, and the primary
  **Start with Resume Tailor** CTA. Every CTA opens the relevant tool modal.
- State/glue: `tools-context.tsx` (open/close, Pro flag, tool registry),
  `tool-host.tsx` (renders the active tool). Wired into `app/candidate/layout.tsx`.

**Phase-1 tools (fully built)**
1. **Resume Tailor** — Content/Templates tabs on the left, live preview on the
   right, footer actions (Tailor → PDF / TXT). Calls `POST /api/tailor`.
2. **ATS Score Checker** — resume + JD form, results panel (conic score gauge,
   matched/missing keyword chips, suggestions). Free = **1 scan/day** (enforced
   server-side), then an in-panel upgrade CTA. Calls `POST /api/ats-scan`.
3. **Cover Letter** — structured form (name, contact, company, role, highlights,
   JD) + Templates tab + live preview + PDF/TXT. Calls `POST /api/cover-letter`.

The other dock tools (LinkedIn, Interview, Jobs, Career, Decoder, Video, Studio)
open in the same modal shell with a "coming soon" body, so the dock feels
complete ahead of Phases 2–3.

**Templates — all 104 ported exactly**
- `lib/resume-templates.ts` is a faithful TypeScript port of the old site's
  `OUT_TPLS` (56 resume + 48 cover) **and** the real render pipeline
  (`renderAIOutput` + `parseAIOutput`/`parseCoverOutput` + the Sidebar / Modern /
  TwoCol / Banner / Formal / Bold / Boxed / Split / Clean / Letter-Modern
  renderers, plus the linear Classic/Executive/Minimal path). Same colors, same
  fonts, same markup.
- `lib/template-preview.ts` ports `makeStaticPreview` for the picker thumbnails.
- Free set matches the server gate (resume `r1/r5/r17`, cover `c1/c5/c17`); every
  other template shows a lock and routes free users to `?upgrade=pro`.
- **Verified:** a runtime pass rendered **all 104 templates → 104 OK / 0 fail**
  with real content, and I sent you a `gallery.html` showing every thumbnail plus
  a full render of each resume layout.

**API routes** (`app/api/{tailor,ats-scan,cover-letter}/route.ts`)
- Prompts ported **verbatim** from `server.js` (`lib/ai.ts`), model
  `claude-sonnet-4-6`, same ATS keyword-overlap fallback.
- All require a signed-in Clerk user. ATS free-tier day limit is enforced via
  Clerk `privateMetadata` (`lib/usage.ts`) — no new DB needed.

**PDF** (`lib/pdf.ts`) — client-side print-to-PDF, a direct port of the old
`downloadPdf` (opens the print-mode template in a new window and calls
`window.print()`). Works for **all** templates, resume and cover; non-Pro gets the
footer watermark. TXT export included too.

**Build:** `next build` is green (all 4 API routes + enlarged candidate bundle),
`next lint` clean.

---

## Decisions I made (so I didn't stall) — please confirm

1. **AI access = direct Anthropic call from Next API routes** (new
   `ANTHROPIC_API_KEY`), rather than proxying the old site. It's self-contained
   and swappable. **If you'd rather the app never hold the Anthropic key** and
   instead proxy a new shared-secret endpoint on the old site (like checkout /
   entitlement already do), say so and I'll switch the 3 routes.
2. **PDF = client-side print**, not a server route. The task listed
   `app/api/pdf/`, but the old site itself uses browser print and it reproduces
   every template with zero server/Chromium cost. I did **not** create a
   non-functional `/api/pdf` stub. Want a true server-rendered PDF (e.g.
   Puppeteer/`@react-pdf`) or the `.docx` export ported too?
3. **Design tokens = the app's real ones** (charcoal `navy` / `violet` primary /
   `teal` / `gold`), per "use the existing app design tokens" — **not** the
   slate-950 + gold-primary summary in the brief (the app has no such tokens).
   Flag if you want me to retheme toward gold-primary.
4. **File layout** — I used shared components (`tools/template-picker.tsx`,
   `tools/doc-preview.tsx`) + one file per tool, rather than the deep
   `resume-tailor/{page,template-picker,resume-form,preview}.tsx` folders in the
   brief. Same pieces, less duplication. Happy to reshape to the exact tree if
   you want it literally.
5. **ATS free limit = 1/day, server-enforced.** Note this **diverges from the old
   site**, where `CLAUDE.md` says ATS is now unlimited/free. I followed the
   brief's "Free: 1 scan/day". Confirm which wins.

---

## Open questions / blockers before I call Phase 1 "shipped"

1. **Deploy + live verify** — I can't deploy or run the authed dashboard end-to-end
   here: `/candidate` is Clerk-protected and I have no real Clerk/Anthropic keys
   in this environment (I used throwaway placeholders only to compile). To finish
   "Deploy and verify" I need either the deploy target (Vercel/Railway project)
   with `ANTHROPIC_API_KEY` + Clerk keys set, or your go-ahead to open the PR and
   let your CI/preview env run it. **How do you want to deploy the Next app?**
2. **Where should generated resumes/scans be saved?** Right now nothing persists
   (the dashboard stats are placeholders showing 0/6). The old site saves to
   SQLite; the new app has Supabase wired but no schema. Do you want
   Phase 1 to persist tailored resumes / scan history (and drive the stat cards),
   or keep it stateless until Phase 2?
3. **Job-posting URL import** — the brief mentions "paste JD **or URL**" for ATS
   and "job posting URL" for cover letters. The old site extracts JD text from a
   URL server-side. I built paste-only for now. Port the URL extractor too?
4. **`.docx` export** — the old site has a rich server-side `.docx` generator
   (`/api/download-docx`). Phase 1 ships PDF + TXT. Want `.docx` in Phase 1?
5. **Sidebar vs dock** — the candidate layout still has the old left sidebar with
   its own nav list *and* the new dock. Keep both, or should the dock replace the
   sidebar's tool links?
6. **Resume video / personal website (Video, Studio)** — confirmed as Phase 3
   Pro-locked placeholders for now, per the brief. ✔

---

## How to run locally
```bash
cd resumetailored-platform
cp .env.example .env.local   # fill in Clerk + ANTHROPIC_API_KEY
npm install
npm run dev                  # http://localhost:3000/candidate
```
