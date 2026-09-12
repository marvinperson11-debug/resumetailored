# "Coming Soon" audit + missing pages — build notes

`next build` → **✓ Compiled successfully**, lint + types clean (no warnings).
No new tools were added — this fills in the placeholder pages behind existing
sidebar links.

---

## STEP 1 — Every "Coming Soon" / placeholder found, and what replaced it

I grepped the whole app for `coming soon`, `placeholder`, `todo`, `wip`, empty
components, and broken sidebar links. Findings:

| Where | Was | Now |
|---|---|---|
| **`/candidate/templates`** | Sidebar link fell through to the `[...slug]` catch-all → "Templates — Coming Soon" | **Real templates gallery** (see A) |
| **`/candidate/profile`** | Catch-all → "Profile — Coming Soon" | **Full profile page** (see B) |
| **`/candidate/settings`** | Catch-all → "Settings — Coming Soon" | **Full settings page** (see C) |
| **`/candidate/shareable-links`** | Catch-all → "Shareable Links — Coming Soon" (broken link — no backend) | **Real page** surfacing the user's published public link (see D) |
| `app/candidate/[...slug]` catch-all | Rendered `FeaturePlaceholder` ("… — Coming Soon") for any unmatched path | Now **redirects to `/candidate`** — every real route exists, so no dead-ends and no placeholder |
| Employer candidate drawer | `alert("Calendar scheduling is coming soon …")` | Reworded to a functional instruction (paste a Calendly/Google link via "Send a message") — no calendar OAuth added, per "stop adding tools" |
| `tool-host.tsx` `ComingSoonBody` | In-modal fallback | **Dead code** — all 10 tools have explicit renders, so it's never reached. Left in place (harmless); no user ever sees it. |
| `components/coming-soon.tsx` `FeaturePlaceholder` | Shared placeholder | Still used **only** by the employer `[...slug]` fallback for old, genuinely-unbuilt employer slugs (hire/payroll/etc.) that aren't in the employer nav. Not wired to any live link. |

Net: **no user-facing "Coming Soon" remains on any candidate sidebar link.**

---

## STEP 2 — The pages

### A) Templates gallery — `/candidate/templates`
- Browsable grid of **all 104 templates** (56 resume + 48 cover).
- **Type filter:** All / Resume / Cover letter.
- **Style filter:** Professional / Modern / Creative / Minimal (mapped from each
  template's internal style: underline→Professional, left-bar→Modern,
  icon-bar→Creative, minimal→Minimal).
- **Click any card → full-size preview** (rendered with the real
  `renderAIOutput` engine + sample content, so it's the actual layout, not a mock).
- **"Use this template"** opens the matching builder with that template applied —
  resume templates seed the AI Resume Builder, cover templates seed the Cover
  Letter tool (wired through a new `openTemplate(cat, id)` on the tools context;
  the Cover Letter tool now consumes a pending template on open).
- **Pro templates** show a PRO badge; free users get "Unlock with Pro" → upgrade
  flow. (Free set: Classic/Executive/Minimal + Formal/Bold/Clean.)

### B) Profile page — `/candidate/profile`
A real account page (not just the avatar upload):
- First/last **name** — edits sync to **Clerk** (`user.update`).
- **Email** — from Clerk, read-only.
- **Phone, Location, LinkedIn URL, Portfolio/Website, Bio** — saved to Supabase.
- **Profile photo** — the avatar upload lives here too (`user.setProfileImage`).
- **"View my public site"** link appears when the user has a published Personal
  Website (`/api/personal-website/mine`).
- **Save profile** writes name→Clerk and the rest→Supabase; pre-filled on load.

### C) Settings page — `/candidate/settings`
Card-based, matching the app:
- **Plan & billing** — current plan (Free/Pro/Employer, incl. "Pro via your
  team"), upgrade button → the existing `?upgrade=pro` flow, billing-history note.
- **Notifications** — product-updates + tips email toggles (persisted to Supabase,
  saved on change).
- **Appearance** — states the app is dark-themed globally and provides a real,
  functional **Reduce motion** toggle (stops the living-gradient animation +
  transitions via an `html.rt-reduce-motion` class, persisted in localStorage —
  new CSS in `globals.css`).
- **Privacy** — "make my profile public" toggle (persisted).
- **Connected accounts** — lists Clerk external accounts (Google/LinkedIn) with a
  real **Disconnect** action; shows the email/password state when none.
- **Account** — **change password** (Clerk `updatePassword`) and a **danger zone**
  **delete account** (type-to-confirm → `user.delete()` → sign out to `/`).

### D) Shareable Links — `/candidate/shareable-links`
The app's real public-link feature is the Personal Website (`/site/:slug`), so
this page surfaces the user's published site with **Copy / Open** and an
edit-in-builder link, plus a clear **empty state** with a CTA that opens the
Personal Website builder. Reuses the existing `/api/personal-website/mine` — no
new backend/tool invented.

---

## STEP 3 — Compared with the old site
- The old site's `/how-it-works`, `/for-employers`, `/resume-video`, `/web-studio`
  are **marketing landing pages**. By design the new app has **no marketing
  pages** — `resumetailored.com` remains the only marketing site, and root routes
  signed-in users straight into the dashboard. So those pages are intentionally
  not ported.
- **Tools/features:** the resume builder in the new app matches or exceeds the old
  one — PDF, TXT, **and .docx** export (the .docx is now client-side, added in the
  prior PR), full template **preview** (this PR), photo/signature/font controls,
  inline editing, autosave, skills-gap. Nothing tool-side is missing.

## STEP 4 — Other incompleteness fixed
- **Broken sidebar links** (templates / profile / settings / shareable-links) now
  all resolve to real pages.
- **Catch-all dead-ends** removed (candidate `[...slug]` redirects to dashboard).
- **Loading states** added on the new pages (profile site-link fetch, shareable
  links, saving spinners).
- **Empty states** verified: My Resumes ("No saved resumes yet"), Application
  Tracker ("No applications tracked yet"), Shareable Links, and the templates
  filter-empty case all have real empty states with CTAs.

---

## Supabase migration to run

```
supabase/migrations/0013_user_profiles.sql
```

Creates `user_profiles` (phone, location, linkedin_url, website_url, bio +
profile_public / email_product / email_tips toggles) with RLS enabled. Until it's
run, Profile & Settings still load (with defaults) and Clerk-side actions
(name, photo, password, delete, connected accounts) work; only the extra fields
and toggles won't persist.

## Deployment checklist
1. **Run `supabase/migrations/0013_user_profiles.sql`** in Supabase.
2. Merge the PR → Railway auto-deploys `main`.
3. No new env vars. Clerk must allow `user.update` / `updatePassword` /
   `delete` from the client (default for a standard Clerk instance).
4. Smoke test after deploy: `/candidate/templates` (filter + preview + use),
   `/candidate/profile` (save + photo), `/candidate/settings` (toggles, password,
   connected accounts), `/candidate/shareable-links`.

## Files
- **New:** `app/candidate/templates/{page,templates-gallery}.tsx`,
  `app/candidate/profile/{page,profile-client}.tsx`,
  `app/candidate/settings/{page,settings-client}.tsx`,
  `app/candidate/shareable-links/{page,shareable-links}.tsx`,
  `lib/profile-store.ts`, `app/api/profile/route.ts`,
  `supabase/migrations/0013_user_profiles.sql`.
- **Edited:** `app/candidate/components/tools-context.tsx` (+`openTemplate`,
  pending cover template), `app/candidate/tools/cover-letter.tsx` (consume pending
  template), `app/candidate/[...slug]/page.tsx` (redirect, no placeholder),
  `app/globals.css` (reduce-motion), `app/employer/candidates/candidates-client.tsx`
  (reworded alert).
