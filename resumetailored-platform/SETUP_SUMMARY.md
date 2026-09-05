# resumetailored-platform — Setup Summary

A new, self-contained **Next.js 14 (App Router)** application scaffolded under
`resumetailored-platform/`. It is a premium, editorial dashboard for **employers**
and **candidates**, and does not touch the existing Express / `server.js` app.

---

## Status

| Item | State |
|---|---|
| Branch | `claude/resumetailored-platform-setup-pcyekl` |
| Draft PR | [#432](https://github.com/marvinperson11-debug/resumetailored/pull/432) |
| CI | ✅ green (`test` + Netlify deploy preview) |
| Mergeable | ✅ clean (no conflict) |
| Typecheck | ✅ `tsc --noEmit` clean |
| Production build | ✅ `next build` succeeds (7 routes + middleware, lint passing) |
| Dev server | `http://localhost:3000` |

---

## Stack

- **Next.js** 14.2.35 (App Router, TypeScript strict — no `any`)
- **shadcn/ui** — slate base color, CSS variables (classic setup: `components.json`, `lib/utils.ts`, theme tokens)
- **Tailwind CSS** 3.4 + `tailwindcss-animate`
- **Clerk** auth — pinned to `@clerk/nextjs@^6` (v7 requires Next 15; task pins Next 14)
- **Supabase** browser client (`@supabase/supabase-js`)
- **recharts** + **lucide-react**

### Install command used

```bash
npx create-next-app@14 resumetailored-platform \
  --typescript --tailwind --app --no-src-dir --import-alias "@/*" --use-npm --eslint

npm install "@clerk/nextjs@^6" @supabase/supabase-js recharts lucide-react \
  class-variance-authority clsx tailwind-merge tailwindcss-animate
```

---

## Design system

Only these colors are used — **no gradients, no drop shadows, no extra colors.**

| Token | Value | Role |
|---|---|---|
| `navy` | `#0A1628` | Page background |
| `teal` | `#1A2F2F` | Card surfaces, sidebar |
| `gold` | `#C9A96E` | Accents, active states, CTAs, borders, icons |
| `cream` | `#F5F0E8` | Headlines, primary text |
| `muted-cream` | `rgba(245,240,232,0.65)` | Body / secondary text |
| `border-gold` | `rgba(201,169,110,0.22)` | Hairline borders |

- **Typography:** `Inter` (UI) + `Playfair Display` (editorial headlines) via `next/font/google`.
- **Vibe:** premium, editorial, quiet confidence — private bank, not startup.
- **Cards:** subtle hover (`scale-[1.01]`, `transition-all duration-200`).
- **Responsive** down to 375px.

---

## Files created

| File | Purpose |
|---|---|
| `tailwind.config.ts` | Custom palette + shadcn slate tokens, Inter/Playfair font families |
| `app/globals.css` | shadcn slate CSS variables + navy/cream `html`/`body` |
| `middleware.ts` | `clerkMiddleware`; protects `/dashboard/*`, `/employer/*`, `/candidate/*`, redirects unauth → `/`; public `/`, `/sign-in/*`, `/sign-up/*` |
| `app/layout.tsx` | `ClerkProvider`, dark theme, navy/cream, Inter + Playfair |
| `app/page.tsx` | Landing page — editorial hero + employer/candidate CTAs |
| `app/employer/layout.tsx` | Employer shell (via `DashboardShell`, title "Acme Corp") |
| `app/employer/page.tsx` | Employer dashboard — 4 stat cards, activity feed, quick actions |
| `components/employer-sidebar.tsx` | Dashboard / Hire / People / Time / Payroll / Reports / Settings + "Portal · $49/mo" |
| `app/candidate/layout.tsx` | Candidate shell (title "My Career Office") |
| `app/candidate/page.tsx` | Candidate dashboard — stats, activity, quick actions |
| `components/candidate-sidebar.tsx` | Dashboard / My Resumes / Job Matches / Applications / Profile / Settings |
| `lib/supabase.ts` | Browser Supabase client from public env vars |
| `components/dashboard-shell.tsx` | Shared shell: fixed 260px sidebar, 64px top bar, mobile slide-out drawer, Clerk `UserButton` |
| `components/dashboard-ui.tsx` | Shared `StatCard` / `ActivityItem` / `QuickAction` / `SectionHeading` |
| `app/sign-in/[[...sign-in]]/page.tsx` | Clerk `<SignIn />` (public) |
| `app/sign-up/[[...sign-up]]/page.tsx` | Clerk `<SignUp />` (public) |
| `lib/utils.ts` | `cn()` helper |
| `components.json` | shadcn config (slate, CSS variables) |
| `.env.local` | Real Supabase + Clerk values (**gitignored — not committed**) |
| `.env.example` | Placeholder env vars (committed) |

---

## Auth behavior (verified)

- `GET /` → **200** (public landing, headline renders)
- `GET /employer` (unauthenticated) → **307** redirect → `/`
- `GET /candidate` (unauthenticated) → **307** redirect → `/`

---

## Environment variables

Stored in `.env.local` (gitignored). `.env.example` documents them:

```
NEXT_PUBLIC_SUPABASE_URL=...
NEXT_PUBLIC_SUPABASE_ANON_KEY=...
NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY=...
CLERK_SECRET_KEY=...
```

> **Security note:** live Clerk keys (`pk_live_` / `sk_live_`) were provided in
> chat. They are safe in the gitignored `.env.local` and were **not committed**,
> but since they were shared in plaintext, consider rotating `CLERK_SECRET_KEY`
> in the Clerk dashboard.

---

## Run locally

```bash
cd resumetailored-platform
npm install
cp .env.example .env.local   # fill in Clerk + Supabase keys
npm run dev                  # http://localhost:3000
```
