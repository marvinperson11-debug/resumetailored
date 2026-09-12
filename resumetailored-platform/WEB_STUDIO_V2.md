# Web Studio v2 + free Shareable Link — build summary

Follow-up to the merged rebuild (#469). All 9 requested problem areas are done and the app builds clean.

- **Branch:** `claude/website-builder-wysiwyg-6ljx40` (restarted from `main` since #469 was merged)
- **Draft PR:** https://github.com/marvinperson11-debug/resumetailored/pull/470
- **Verification:** `next build` green (66 routes), `tsc --noEmit` clean, `next lint` clean, renderer smoke-tested.

> **Codebase:** the Next.js platform in `resumetailored-platform/` (Clerk · Supabase · Next 14 · Tailwind), same as #469 — not the legacy vanilla `server.js` site.

---

## What changed, by problem

| # | Problem | What shipped |
|---|---------|--------------|
| 1 | Boring templates | Modern renderer CSS (stat/testimonial cards, gallery grids, styled quotes/icons, image shadows, section rhythm). Templates use alternating tinted panels, a taller hero, and per-template richness: **startup** → stat row, **designer/portfolio** → gallery, all → testimonial cards. |
| 2 | Video didn't work | Video element: **URL (mp4/YouTube/Vimeo)**, **file upload** (data URL, 6 MB guard), or **saved Résumé Video**; autoplay/mute/loop/poster; inline playback on the published page + live preview in editor. |
| 3 | More customization | Per-element **paint-brush** panel: font family/size/**weight**/letter-spacing/line-height/transform/**alignment incl. justify**/color; **border** style+width+color; **radius**; **box shadow + intensity**; **padding**/**margin**; **background**; **animation** (fade / slide-up / slide-left / slide-right / scale + delay + duration). Section bg: solid/gradient/pattern/image/video. |
| 4 | Add elements anywhere | Floating **+** and per-section "Add element" now offer: heading, text, image, video, button, divider, spacer, social, résumé-download, **icon, quote, stat counter, testimonial, gallery, audio, embed**. Duplicate / delete / reorder (panel arrows). |
| 5 | Voiceover | Audio element: paste URL, upload MP3, or **record in-browser** (MediaRecorder). Auto-play (muted) or play button; inline player. |
| 6 | Background music | Site-wide music: upload/URL, **auto-play muted → tap to unmute** or play/pause button, loop, volume; floating global control across all sections. |
| 7 | Preview before publish | **Preview** button → full-screen modal of the **actual rendered HTML** (desktop/tablet/mobile) + **open in new tab**; "Exit preview" returns to the editor. |
| 8 | Shareable Link (FREE) | Fully separate feature — see below. |
| 9 | URL formats | Website Creator → `/site/[slug]`; Shareable Link → `/u/[username]`. Both shown in the Shareable Links dashboard. |

---

## Shareable Link (free, separate from the Pro builder)

- **Migration:** `supabase/migrations/0015_shareable_profiles.sql` — `shareable_profiles(user_id, username, name, headline, photo_url, bio, contact_info, theme, …)`; username unique (case-insensitive).
- **Store:** `lib/shareable-store.ts` — CRUD, 5 themes (Aurora / Cream / Mint / Rose / Slate), validation, uniqueness check.
- **API:** `app/api/shareable/route.ts` — `GET` (my profile + `?check=` username availability), `PUT` (upsert, 409 on taken). Free for every signed-in user.
- **Public page:** `app/u/[username]/page.tsx` — polished themed page (name, headline, photo, bio, contact), OG/Twitter metadata, "Powered by ResumeTailored" footer, and a prominent **upgrade CTA** to the full builder.
- **Dashboard:** `app/candidate/shareable-links/` reworked into the simple form editor (username with live availability, name/headline/photo/bio/contact, theme swatches), showing **both** URLs and an upgrade banner. NO drag-drop / sections / elements — just fields, by design.

**Free vs Pro:** Shareable Link is free for everyone; the Website Creator remains Pro-only (server-gated on every route + API).

---

## Files

**New:** `lib/shareable-store.ts`, `app/api/shareable/route.ts`, `app/u/[username]/page.tsx`, `supabase/migrations/0015_shareable_profiles.sql`.
**Changed:** `lib/studio-types.ts` (7 new element types, `music`, `AnimType`, richer templates), `lib/studio-render.ts` (new elements, animations, music, richer CSS), `app/candidate/studio/edit/*` (canvas element rendering, panels: paint-brush + new-type controls + music + audio record, editor: preview modal + paint-brush + reorder action), `app/candidate/shareable-links/shareable-links.tsx` (now the profile editor).

## To apply the DB migration
Run `supabase/migrations/0015_shareable_profiles.sql` against your Supabase project (via the SQL editor or `supabase db push`). Until it exists, `/api/shareable` returns a friendly "table not set up" error and the rest of the app is unaffected.

---

## Decisions & notes (your call if you'd like these different)

1. **Media uploads** (video/audio/images) are stored as **size-guarded data URLs** — this platform has no object-storage backend. Large media should use a hosted URL; if you want true uploads I can wire a Supabase Storage bucket next.
2. **Preview** is a client-side render of the real published HTML (+ a blob new-tab) rather than a server temp-URL route (`/api/studio/preview` in the spec). Same guarantee — actual rendered HTML — with no extra server state to expire. Say the word if you specifically want a shareable temporary preview URL.
3. **Element reorder within a section** is via the panel's up/down arrows + duplicate/delete (sections drag-reorder in the left rail). I deferred pixel drag-and-drop of elements to protect inline-editing/caret stability inside the scaled canvas. I can add handle-based element dragging if you want it.
4. **Template palettes stay varied** (gold is prominent on Executive and available everywhere via the per-element/theme color pickers) rather than forcing all 8 templates gold — to keep them visually distinct. Easy to shift the whole set toward gold if you prefer a single brand look.
