# Website Creator — Phase 7 status (backgrounds, degrade gate, i18n) + merge readiness

This pass did the "i18n copy pass + polish" — and closed a real gap I found: the **5 background themes** from the original customization plan hadn't been built yet, and "animated-bg degrade testing" on the polish list depended on them. So this covers backgrounds + the degrade gate + the public-site i18n copy.

## What shipped

**Background themes (5) + degrade gate**
- **Midnight** (default) — mirrors the platform homepage (`#030712` + subtle indigo glow). *Static.*
- **Aurora** — animated drifting gradient. *Animated.*
- **Paper** — clean light. *Static.*
- **Mesh** — static multi-stop light gradient. *Static.*
- **Particles** — animated lightweight canvas field. *Animated.*
- Themes drive the background **and** adaptive `--fg`/`--muted` text colors, so text on the background stays legible on both dark and light themes (the resume/case-study/contact **cards** keep their own light styling).
- **`shouldAnimate()` gate** (mandatory, per your call): animated themes fall back to a **static** background when `prefers-reduced-motion`, `hardwareConcurrency <= 4`, or viewport `< 768px`; the particle canvas also **pauses on a hidden tab**. An unknown theme falls back to Midnight.
- Editor: a **background picker** (5 swatches with an "animated" tag); the choice persists in `config.background` and round-trips through publish **and** live preview.

**Public-site i18n copy pass**
- A shared `_SITE_I18N` dictionary (EN/中文). The **contact block** placeholders/buttons and the **lead** success/error messages render in the **site's language server-side**, and the on-page **language toggle** now also swaps form placeholders. So a Chinese site is fully Chinese for visitors, not just the editor.

**i18n QA**
- Audited EN/中文 key parity across the whole creator + Back Office — all `wc_`/`bo_` keys are paired (the only audit "misses" were false positives from ordinary words followed by colons inside string values).

## Verified
- `server.js` syntax ✓; inline scripts parse ✓; EN/中文 i18n parity ✓
- Render goldens: `link.html` + `site.html` **byte-identical**; `site-grid.html` **re-baselined** (theme system) ✓
- Theme render checks: dark/light `--fg`, animated keyframes + canvas, `shouldAnimate` present, invalid-theme fallback ✓
- E2E: a chosen background **persists via publish and renders** on `/site`; the **preview endpoint honors the background** too ✓

## Build status: essentially merge-ready
The polish list is effectively done — the animated-bg **degrade gate** is implemented (that was the main polish item), media **quota limits** and **spam guards** (honeypot + rate limit) landed in Phases 4–5. Phases **1–7** are complete.

### The one remaining blocker is yours: **Q6 — mount the Railway `/data` volume**
Media uploads (Phase 4) and any persisted files need the volume at `/data` (with `DATA_DIR=/data`) or they're lost on redeploy. Once it's mounted, this is ready to **merge to `main`** → Railway deploy → live for subscribers.

- **Q7 — `RESEND_API_KEY`** remains optional (lead emails; leads persist and list without it).

## After merge (follow-ups, not blockers)
- **5b** — plain-text video generator + record/upload voiceover (the one deferred nice-to-have; the video block already covers the basic video hero).
- Any real-world polish that surfaces once you and subscribers use it live.

## Recommended next step
When the `/data` volume is mounted, tell me and I'll:
1. Do a final rebase/merge check on the branch,
2. Confirm goldens + a full E2E pass,
3. Mark PR #263 ready and merge to `main` (squash), triggering the Railway deploy.

Want me to hold for the volume, or is there anything else you'd like adjusted in the creator first?
