# Website Creator — holding for merge (Q6 `/data` volume)

Acknowledged: the Website Creator is **complete and ready as-is**. No further creator changes. I'm **holding** until you confirm the Railway `/data` volume is mounted.

## Status
- **Phases 1–7 done**, committed and pushed on `claude/resumetailored-pricing-plan-iwy6un` (draft PR #263).
- All checks currently green: `server.js` syntax, inline scripts, EN/中文 i18n parity, render goldens (`link` + `site` byte-identical; `site-grid` re-baselined), and end-to-end tests across every phase.

## The only blocker (yours)
- **Q6 — mount the Railway volume at `/data`** (with `DATA_DIR=/data`). Without it, uploaded media is lost on each redeploy. You're on it.
- **Q7 — `RESEND_API_KEY`** stays optional (lead-notification emails; leads persist and list without it). Not a blocker.

## What I'll do the moment you say "go ahead"
1. **Rebase check** — `git fetch origin main` and confirm the branch is clean on top of the latest `main` (rebasing if `main` has moved; resolving any conflicts).
2. **Goldens + E2E pass** — re-run `node test/render-snapshot.js` (expect link/site/site-grid all PASS) and the phase E2E smoke checks (asset APIs, media upload/serve/quota, grid/blocks render, case studies, lead capture, QR, analytics, Back Office duplicate + publish/unpublish, background persistence).
3. **Ready + merge** — mark PR #263 ready for review and **squash-merge to `main`**, which triggers the Railway build/deploy.
4. **Post-merge verify** — once Railway is live, curl-check the new endpoints/pages on production and confirm the creator works end-to-end there (this is the step the static Netlify preview can't cover).

## After merge (follow-ups, not blockers)
- **5b** — plain-text video generator + record/upload voiceover (deferred nice-to-have; the video block already covers the basic video hero).
- Any real-world polish that surfaces once it's live for you and subscribers.

Just reply "go ahead" (ideally once `/data` is mounted) and I'll run the merge sequence above.
