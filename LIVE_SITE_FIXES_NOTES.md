# Live Site Fixes — Summary

Branch: `claude/live-site-fixes-2ffkxa`

All four requested fixes are done. Colours only where colour was asked for; no
new features, no navigation/Stripe/tier/backend-logic changes.

## 1. Colour consistency — navy #0a1628 / emerald #1a4d3a / gold #c9a227 / cream — A‑to‑Z ✅
The whole site now renders on the navy palette. Verified in‑browser (effective
`body` background) across every page type:
- **~340 SEO/blog/tool/static pages** — the shared `theme.css` (linked by 342
  pages) was a cream editorial theme whose `body{background:var(--bg)!important}`
  overrode even the role pages' own dark inline styles, so the entire long tail
  actually rendered **cream**. Flipped `theme.css`'s `:root` + nav + the ≤820px
  "darken‑for‑cream" mobile overrides to navy. This fixes role pages,
  `/alternatives/*`, `/resume-examples`, `/cover-letter-examples`, `/zh/`, blog
  articles, `/success`, `/cancel`, `/terms`, `/privacy`, `/reset-password`,
  `/404`, `/help/`, and the interactive tools (`/ats-score-checker`,
  `/resume-analyzer`, `/ai-resume-tailor`, …) at once.
- **Serve‑time hex remap** (`_luxuryRepaint` in `server.js`) shifts the legacy
  green accents (`#1F5C3D/#2E7D53/#8FD3AC`) onto emerald + gold on every served
  page (app shells excluded).
- **Homepage** (`index.html`) — flipped its variable‑driven `:root`; the
  pillar band, promo band, job‑boards box, footer CTA and feature mockups are
  navy. Resume‑template paper thumbnails deliberately stay white.
- **Dashboards** — job‑seeker (`app.html`) + New Tools/What's New modals +
  Career Hub (`career-hub.css`); employer portal; `/corporate` admin board.
- **Bespoke pages** — `login`, `pro-tools`, `job-tracker`, `interview-coach`,
  `blog`, and the `/tools/*` hub (`tools-hub.css`) + `/score` catalog.
- **Global chrome** — cookie‑consent bar and the language toggle.

## 2. Card‑based layout ✅
- Homepage "how it works" steps and feature rows are now distinct navy cards
  with spacing and a gold hairline (no more flat wall).
- Dashboard tools: the "New Tools" catalog is a navy card grid; the SEO role
  pages were already card‑based.

## 3. Dashboard buttons now clickable ✅ (root cause found & fixed)
The global language‑toggle/shared‑nav injectors inserted their `<script>` at the
**first** `</body>`. `app.html` builds a full HTML document string in a JS
template literal containing `</body>` long before the page's own — so the
injected `<script>…</script>` landed inside that JS string; the browser
terminated the whole inline app script at that stray `</script>`
("Unexpected end of input"), leaving `showTab()` and every handler undefined and
every dashboard button dead. Fixed by injecting before the **last** `</body>`
(`_insertBeforeLastBody`). Verified in a headless browser: `showTab` is defined
and clicking a sidebar tool switches the tab. New test:
`test/dashboard-script-integrity.js`.

## 4. Chinese language toggle is white ✅
The homepage nav toggle, the footer toggle, and the global fallback toggle now
use a white/high‑contrast treatment so they're clearly visible on navy.

## Tests
Full Node suite: **59 pass, 1 fail**. The single failure — `audit-regressions.js`
— is only its two ATS/LinkedIn subtests that require a live `ANTHROPIC_API_KEY`
(absent in this sandbox); pre‑existing and unrelated. Added
`test/luxury-global-repaint.js`, `test/dashboard-script-integrity.js`; updated
`test/homepage-a11y.js` to check `--ink-faint` against the navy surfaces it now
sits on.

## Not touched (per your rules)
Stripe checkout, pricing, tiers, tool assignments, navigation structure, and
backend API logic are unchanged.
