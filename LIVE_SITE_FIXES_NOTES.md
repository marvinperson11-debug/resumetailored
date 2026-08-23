# Live Site Fixes — Full Session Report

**Branch:** `claude/live-site-fixes-2ffkxa`
**Pull request:** [#406 (draft)](https://github.com/marvinperson11-debug/resumetailored/pull/406)
**Live deploy preview (all changes, clickable):** https://deploy-preview-406--mellow-macaron-463353.netlify.app
**Pushed to:** the feature branch only — **nothing pushed to `main`, nothing deployed to production.**

All four requested fixes are done. Colours were only changed where colour was asked for. No new features, and no changes to Stripe checkout, pricing, tiers, tool assignments, navigation structure, or backend API logic.

---

## 1. Colour consistency — navy `#0a1628` / emerald `#1a4d3a` / gold `#c9a227` / cream — every page ✅

The whole site now renders on the navy palette. I verified this in a headless browser by reading each page's **effective** `body` background, not just the source — across every page type.

**The key discovery:** the shared `theme.css` (linked by **342** pages) was a *cream* editorial theme whose `body{background:var(--bg)!important}` overrode even the role pages' own dark inline styles — so the entire long tail was actually rendering **cream**, regardless of what its own CSS said. Flipping that one file's palette fixed ~340 pages at once.

What was repainted:
- **~340 SEO / blog / tool / static pages** — flipped `theme.css`'s `:root`, its `.nav`, and its `≤820px` "darken-for-cream" mobile overrides (which would otherwise have made text/headings *dark on navy*). Fixes the role pages, `/alternatives/*`, `/resume-examples`, `/cover-letter-examples`, `/zh/` (Chinese homepage), blog articles, `/success`, `/cancel`, `/terms`, `/privacy`, `/reset-password`, `/404`, `/help/`, and the interactive tools (`/ats-score-checker`, `/resume-analyzer`, `/ai-resume-tailor`, `/free-ats-resume-checker`, …).
- **Serve-time hex remap** (`_luxuryRepaint` in `server.js`) — shifts the legacy green accents (`#1F5C3D` / `#2E7D53` / `#8FD3AC`) onto emerald + gold on every served page (the three app shells are excluded, since they self-manage their palette and embed live resume/template colour pickers).
- **Homepage** (`index.html`) — flipped its variable-driven `:root`; gave the pillar band, the Free-Tools promo band, the job-boards box, the footer CTA, and the feature preview mockups explicit navy. Resume-template *paper* thumbnails are deliberately left white.
- **Dashboards** — job-seeker (`app.html`) + the "New Tools" and "What's New" modals + the Career Hub (`career-hub.css`); the employer portal; and the `/corporate` admin board.
- **Bespoke light pages** — `login`, `pro-tools`, `job-tracker` (incl. its JS-rendered kanban), `interview-coach`, `blog`, plus the `/tools/*` hub (`tools-hub.css`) and the `/score` free-tools catalog.
- **Global chrome** — the cookie-consent bar and the language toggle.

## 2. Card-based layout ✅
- The homepage "How it works" steps and the feature rows are now distinct navy cards with spacing and a subtle gold hairline (no more flat wall of text).
- Dashboard tools: the "New Tools" catalog is a navy **card grid**; the SEO role pages were already card-based.
- I read "dashboard tools card-grid" as the New Tools catalog rather than restructuring the sidebar, because the sidebar *is* the navigation and you asked me not to change navigation structure. Say the word if you'd rather the sidebar itself become cards.

## 3. Job-seeker dashboard buttons — dead buttons fixed (real root cause) ✅
The buttons weren't missing handlers — a JavaScript **syntax error** was killing the whole script.

The global language-toggle / shared-nav injectors inserted their `<script>` at the **first** `</body>` in the served HTML. But `app.html` builds a full HTML document string inside a JS template literal that contains `</body>` **long before** the page's own closing tag. So the injected `<script>…</script>` landed *inside that JS string*; the browser's HTML parser terminated the entire inline app script at that stray `</script>` (error: *"Unexpected end of input"*), which left `showTab()` and every other handler **undefined** — so every dashboard button did nothing.

**Fix:** inject before the **last** `</body>` (`_insertBeforeLastBody` in `server.js`). Verified in a headless browser: `showTab` is now defined, and clicking a sidebar tool actually switches the tab (e.g. Tailor → ATS panel). Added a regression test, `test/dashboard-script-integrity.js`.

## 4. Chinese language toggle is white ✅
The homepage nav toggle, the footer toggle, and the global fallback toggle now use a white / high-contrast treatment so they're clearly visible against the navy background (previously navy-on-navy / beige / dark-ink, effectively invisible).

---

## Commits on this branch
```
be0725c  Make Chinese language toggle visible against navy background
cdd56bc  Repaint all public pages onto the canonical navy/emerald/gold palette
c957858  Convert remaining light-themed pages to the navy luxury palette
e791d57  Repaint homepage to navy palette and card-based layout (items 1 & 2)
5f72527  Fix dead job-seeker dashboard buttons; repaint dashboard tool modals
cd0fc92  Flip shared editorial theme to navy — fixes ~350 pages at once
06525c3  Repaint the /corporate admin-panel board to navy
3a897fd  Repaint the Career Hub UI to navy
f22233c  Add live-site-fixes summary notes
eef2014  Document CI status: red test check is pre-existing (missing ANTHROPIC_API_KEY)
```

## Tests
Full Node suite: **59 pass, 1 fail**. Added `test/luxury-global-repaint.js` and `test/dashboard-script-integrity.js`; updated `test/homepage-a11y.js` to check `--ink-faint` against the navy surfaces it now sits on.

## CI status on PR #406 — the red `test` check is pre-existing, NOT from this PR
GitHub Actions `test` is red on two subtests in `test/audit-regressions.js`:
- `anonymous ATS generation is publicly usable`
- `anonymous LinkedIn generation is publicly usable`

Both fail with *"Could not resolve authentication method"* — they POST to the ATS / LinkedIn routes, which call the Anthropic API, and CI has no `ANTHROPIC_API_KEY` secret.

**Proof it isn't this PR's fault:**
- This diff changes neither `test/audit-regressions.js` nor those routes.
- Running the same test against `origin/main` fails on the **exact same two subtests** — so `main` is red here too.
- It can't self-recover: it's a missing CI secret, not a code issue.

**Decision:** not fixing it here — that would widen a colours/buttons PR into unrelated test infra. I posted the same explanation as a comment on the PR.

**Options to make CI green (separate change):**
1. Add `ANTHROPIC_API_KEY` as a repo Actions secret and pass it into the `Run test suite` step, or
2. Have those two subtests skip (or assert a graceful 5xx) when `ANTHROPIC_API_KEY` is unset, so keyless CI stays green.

Everything else in the suite passes (58/58). The PR's Netlify deploy preview built successfully.

## Not touched (per your rules)
Stripe checkout, pricing, tiers, tool assignments, navigation structure, and backend API logic are unchanged.

## One open question for you
For item 2, I carded the **New Tools catalog** rather than the dashboard **sidebar**, to respect "don't change navigation structure." If you actually want the sidebar tool list rendered as cards, tell me and I'll do it.
