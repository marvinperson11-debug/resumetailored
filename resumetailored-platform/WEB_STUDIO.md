# Personal Website (Web Studio) — Pro-gated build

The Web Studio tool now matches the spec: **fully Pro-gated**, with a card template picker, 9 named color swatches, typography controls, social links, **resume-video embedding**, a **mobile/desktop live preview** (debounced), OG meta tags on the public page, and **publish / update-in-place**. `next build` is green.

> **Heads-up (important):** a Web Studio tool already shipped in PR #457, including the `personal_sites` table (migration `0006`) which is **live in production**. I built on that base rather than replacing it. See "Migration decision" below — I did **not** apply the spec's alternative SQL, because it would break the live table and the code that reads it.

The free **share-as-link** resume page (`/r/:slug` on the legacy site) is untouched — this is a separate feature.

---

## Pro gate (fully locks the tool for free users)
- **`tools-context.tsx`** — `studio` is now `kind: "pro"`, so `openTool()` redirects free users to `/candidate?upgrade=pro` from every entry point (sidebar, dashboard, deep links).
- **`candidate-sidebar.tsx`** — "Personal Website" shows a 🔒 for free users (reuses the `locked` flag added for Resume Video); clicking opens the upgrade flow.
- **`personal-website.tsx`** — backstop effect redirects a free user who somehow reaches the tool and `return null` before render.
- **`/api/personal-website/copy`** and the two new GET routes are **Pro-gated server-side (402)**; **`/api/personal-website/publish`** was already 402.

## Left column — form
- **Template picker** — 4 cards (Portfolio / Resume / Creative / Minimal) with tiny CSS mock thumbnails tinted by the current accent; selected = violet border + glow + check.
- **Color theme** — 9 named swatches: Navy, Violet, Teal, Gold, Slate, Emerald, Rose, Midnight, Cream. Click updates the preview instantly (CSS custom property `--accent`).
- **Typography** — Heading font (Sans / Serif / Mono), Body font (Sans / Serif), Size scale (Compact / Normal / Spacious). All via CSS vars (`--heading`, `--body`, `--scale`).
- **Photo** — optional upload, client-downscaled to ≤512px JPEG.
- **Include my Resume Video** — toggle + dropdown populated from `video_generations` (via the new list route); the selected MP4 is embedded on the site with a native `<video>` player.
- **Personal info** — Name, Headline, Email, Location, LinkedIn, GitHub, Portfolio (URLs optional; only `http(s)` links are emitted onto the public page).
- **About / bio** — textarea + **Generate from resume** (AI) using a saved resume or pasted text.
- **Sections** — show/hide + editable title/items; a "Skills"-type section renders as tag pills on the site.

## Right column — live preview
- iframe of the generated HTML, **debounced 300ms** so typing doesn't thrash it.
- **Desktop / Mobile** toggle (mobile renders in a 390px frame) — shows the real site as visitors see it.

## Footer actions
- **Download HTML** — standalone `.html` (client-side blob download).
- **Publish website** / **Update published site** — the button label flips to "Update" when the tool detects you already have a published site (via the new `/mine` route). Server upserts one site per user, so publishing again updates the same slug.

---

## Templates
Four self-contained pages (inline CSS, no external deps) from one generator, differentiated by hero treatment, max-width, alignment and section style, all driven by CSS custom properties so theme/font/scale switches are instant:
- **Portfolio** — accent top-bar hero, avatar, showcase sections.
- **Resume** — tight single column, accent underline, timeline-style list.
- **Creative** — gradient hero, centered big type, bold accent.
- **Minimal** — whitespace, serif default, subtle borders, em-dash bullets.

Skills render as pills; the resume video renders as an embedded player; social links appear in the hero contact row.

## AI copy — `POST /api/personal-website/copy`
Pro-gated. Input `{ resume }`; returns `{ copy: { name, headline, about, sections[] } }` (Experience / Skills / Projects) via Claude. (Kept the existing sections shape — see note on structured data below.)

## Publish — `POST /api/personal-website/publish`
Pro-gated. Renders HTML **server-side** (can't be tampered with), upserts one row per user (`onConflict: user_id`), returns `{ slug, url }`. Because it upserts, "Update published site" reuses the same slug automatically.

## Public page — `GET /site/[slug]`
No auth. Serves the stored, fully-rendered HTML. The generated document now carries `<title>Name | Headline</title>`, `meta description`, and `og:title` / `og:description` / `og:image` (photo, when it's a real URL) / `twitter:card`. Missing slug → a clean branded 404 with a "Build your own →" link back to the app.

## New support routes
- **`GET /api/resume-video/list`** (Pro) — the user's saved resume videos `[{ id, title, videoUrl }]` for the embed dropdown.
- **`GET /api/personal-website/mine`** (Pro) — the user's published site `{ slug, url, config }` to prefill the form and switch to Update mode.

---

## Files
**Changed:** `lib/site-templates.ts` (9 themes, typography, links, video, OG, richer templates), `lib/site-store.ts` (`getUserSite`), `lib/video-generations.ts` (`listVideoGenerations`), `app/api/personal-website/copy/route.ts` (Pro gate), `app/candidate/tools/personal-website.tsx` (full rework), `app/candidate/components/tools-context.tsx` (`studio` → pro), `components/candidate-sidebar.tsx` (lock), `app/site/[slug]/route.ts` (404).
**Added:** `app/api/resume-video/list/route.ts`, `app/api/personal-website/mine/route.ts`.

## Verify after deploy
- **Free user:** 🔒 on "Personal Website" → click → upgrade page; tool never opens.
- **Pro user:** open → pick template card → swatch/typography update the preview live → fill info + socials → toggle "Include my Resume Video" (if you have one) → Desktop/Mobile preview → Download HTML → Publish → open `/site/<slug>` (check the tab title + link unfurl). Re-open the tool → button says **Update published site**.

---

## Decisions & one open question

1. **Migration decision (please note, no action needed unless you disagree).** The spec's `0006_personal_sites.sql` uses a different schema (`id bigint identity`, separate `slug unique`, `config jsonb`, `auth.uid() = user_id` RLS policies). The **table already exists in production** from PR #457 with a `slug` primary key + `data jsonb` + `user_id unique` + `published` schema, and all the code reads/writes that shape. Applying the spec's version would (a) fail or diverge against the existing table and (b) the `auth.uid() = user_id` policies wouldn't match Clerk's text user-ids anyway (we write with the service-role key, which bypasses RLS). **So I kept the existing migration/schema and did not change it.** If you specifically want the `config`-column schema, that's a data migration on the live table — tell me and I'll write a safe `ALTER`/rename rather than a conflicting `CREATE`.

2. **Structured sections vs. text (my one real question).** The spec asks for deeply structured sections — Experience as `{company, role, dates, bullets}`, Education as `{school, degree, dates}`, Projects as `{name, description, link, image}`. The current tool (from #457) uses a flexible `{ title, items[] }` section model, which I kept and extended (Skills → pills, AI fills Experience/Skills/Projects as lines). This covers the same content and ships today, but it's **line-based, not field-based** — e.g. Projects don't yet have per-project image uploads or link fields. Building the full structured editors (repeatable Experience/Education/Project rows with their own inputs + image uploads, and matching template rendering) is a sizable follow-up. **Do you want me to build the fully structured section editors next, or is the current flexible section model good enough?** Everything else in the spec is implemented.
