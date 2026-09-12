# Personal Website (Web Studio) — full-screen WYSIWYG rebuild

The Personal Website tool was a cramped modal — a form on the left, a tiny live-preview
iframe on the right, scrunched template cards. It's been **rebuilt from scratch** as a
full-screen, Wix/Squarespace/Webflow-style WYSIWYG builder.

- **Branch:** `claude/website-builder-wysiwyg-6ljx40`
- **Draft PR:** https://github.com/marvinperson11-debug/resumetailored/pull/469
- **Verification:** `next build` green (65/65 pages), `tsc --noEmit` clean, `next lint` clean, renderer smoke-tested.

> **Which codebase.** The request's data model (Supabase, TypeScript/React, `/candidate/studio/edit`)
> matches the Next.js platform in `resumetailored-platform/` — **not** the legacy vanilla
> `server.js` / `public/app.html` site (whose `CLAUDE.md` describes a different, older editor).
> The rebuild targets the Next.js app: **Clerk auth · Supabase · Next 14 App Router · Tailwind · shadcn**.
> The live `personal_sites` table/schema is left untouched — the new v2 document is stored in the
> existing `data jsonb` column, so nothing in production breaks.

---

## What you get

### 1. Template gallery — `/candidate/studio` (full-screen, dark)
- **Large cards**, each showing a **live-rendered** preview of the actual template (a scaled,
  non-interactive iframe of the real generated HTML) — not a static thumbnail.
- **Category filter bar**: All / Portfolio / Resume / Creative / Minimal / Executive / Developer / Designer / Startup.
- **"Use my résumé to pre-fill"** toggle — parses your most recent saved résumé (name, headline,
  about, experience bullets, skills) into the template before the editor opens.
- Hover: subtle lift + violet glow. Click a card → editor with that template loaded.
- If you already have a published site, an **"Edit my site"** shortcut appears.

### 2. Full-screen editor — `/candidate/studio/edit` (no modal)
- **Top bar (56px):** Exit · Undo/Redo · Desktop/Tablet/Mobile preview · Download HTML · save status · prominent violet **Publish**.
- **Left section navigator (collapsible):** the page's sections, with **drag-to-reorder** and a
  per-section **show/hide (eye)** toggle; click to select/jump.
- **Center canvas:** a faithful React render of your site, scaled into a device frame, and **fully editable**:
  - **Click any text** → it becomes an inline `contentEditable` field with a violet border and a
    **floating format toolbar** (Bold / Italic / Underline / Link / H1–H3 / bullet list). Type
    directly; Esc or click-away commits.
  - **Click any image** → upload/replace (auto-downscaled to a compact data URL) or paste a URL.
  - **Click any video** → paste an mp4 / YouTube / Vimeo URL, or embed one of your saved **Résumé Videos**.
  - **Click a section background** → the background editor in the right panel.
- **Right properties panel (collapsible, context-aware):**
  - **Page / theme:** title, meta description, favicon, social-preview (OG) image, heading & body
    Google fonts, primary/secondary/text/background colors, fade-in-on-scroll, custom CSS.
  - **Section:** name, background (solid / gradient presets + custom / pattern / image / video),
    padding top & bottom, layout (full / contained / split), visibility, duplicate / delete / move.
  - **Element** (per type): text & heading (font, size, color, alignment, line-height, letter-spacing,
    transform, H-level), image (replace, alt, radius, shadow, fit, click-to-link), video (URL / saved
    résumé video, autoplay/mute/loop, poster), button & résumé-download (text, URL, solid/outline/ghost,
    radius, alignment), social links, divider, spacer.
- **Floating "+" button** (bottom-center): add any **section** (Hero, About, Experience, Education,
  Skills, Projects, Gallery, Testimonials, Contact, Video, Custom) or **element** (Heading, Text,
  Image, Video, Button, Divider, Spacer, Social links, Résumé download) at the current selection.
- **Publish slide-out** (from the right): live URL preview, custom slug, SEO title/description, OG
  image, Publish / Update, and Copy-link / Open-site after publishing.
- **Undo/Redo** history (⌘/Ctrl-Z, ⌘/Ctrl-Shift-Z) + **debounced autosave** (localStorage + a
  Pro-gated server draft route).

---

## Architecture

| File | Role |
|---|---|
| `lib/studio-types.ts` | The v2 data model — `StudioSite → StudioSection[] → StudioElement[]`, theme, 8 template presets, résumé-prefill parser, and **pure style helpers** shared by the canvas + renderer. No React/DOM/network. |
| `lib/studio-render.ts` | **Pure** HTML generator → a self-contained responsive page. Used by the editor's Download-HTML, the gallery preview cards, the publish route, and the public `/site/:slug` page. |
| `app/candidate/studio/page.tsx` + `studio-gallery.tsx` | Full-screen template gallery (server Pro-gate + client UI). |
| `app/candidate/studio/edit/page.tsx` | Full-screen editor route (server Pro-gate). |
| `app/candidate/studio/edit/studio-editor.tsx` | Editor shell: state, undo/redo history, autosave, all mutation actions, top bar, layout, publish. |
| `app/candidate/studio/edit/studio-canvas.tsx` | The editable React canvas — inline text editing, floating toolbar (portaled), image/video upload, selection & section-background clicks, device scaling. |
| `app/candidate/studio/edit/studio-panels.tsx` | Section navigator, context-aware properties panel, add menu, publish slide-out, and reusable dark-panel controls. |
| `app/candidate/studio/edit/studio-shared.ts` | Type-only glue (selection, actions interface, device widths, image→dataURL) so components don't import each other's modules. |
| `app/api/personal-website/save/route.ts` | **New, Pro-gated** autosave — stores the working draft without changing publish state (a first-time draft stays unpublished/404 until you explicitly publish). |

**Changed:** `app/api/personal-website/publish/route.ts` (renders the v2 document server-side; legacy
flat payload still works), `.../mine/route.ts` (reports published state), `lib/site-store.ts`
(`saveSiteDraft` + `published` on `getUserSite`), `components/candidate-sidebar.tsx` &
`app/candidate/shareable-links/shareable-links.tsx` (navigate to `/candidate/studio`),
`app/candidate/components/tool-host.tsx` & `tools-context.tsx` (removed the old studio modal branch + `ToolId`).
**Removed:** `app/candidate/tools/personal-website.tsx` (the old modal builder).

---

## Security & correctness

- All user text is HTML-escaped, or run through an **allow-list rich-text sanitizer**
  (`b/strong/i/em/u/br/span/a/ul/ol/li` only; anchors forced to safe URLs + `rel="noopener"`).
- Every URL that reaches `href`/`src` on the public page is restricted to **http(s) / mailto / data:image**.
- Custom CSS can't break out of `<style>` (all `</style…>` variants are stripped).
- The tool is **Pro-only**, enforced server-side on every page render and every API route
  (`isIndividualPro` / `canUseIndividualPro`); free users are redirected to the upgrade flow before
  the editor mounts.
- Publish/save reject oversized payloads (embedded base64 media).

**Runtime smoke test:** all 8 templates render valid HTML; résumé prefill correctly extracts
name/headline/experience/skills; an injected `<script>` is stripped from output and a `</style ><script>`
break-out is neutralized.

---

## Notes / decisions

- **Video uploads** are URL-based (mp4 / YouTube / Vimeo / your saved Résumé Video) rather than raw
  file uploads — this platform has no media-storage backend, and storing large base64 video in the
  site JSON is impractical. Images are stored as downscaled data URLs (kept small).
- **Draft persistence** is localStorage + a server draft row (cross-device); it never flips your
  live site's published state.
- The editor renders the canvas as **React** (for natural inline editing) while the published page
  uses the **pure string renderer** — both derive layout/style from the same helpers in
  `studio-types.ts`, so the preview matches what's published.
