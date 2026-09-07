# Deploy fix — why #447 didn't go live

## TL;DR
It was **not a build failure.** The Railway `web` service was configured to deploy
from the branch **`claude/resumetailored-platform-setup-pcyekl`**, not `main`.
PR #447 merged into `main`, so Railway never saw a new commit and never built.
I repointed the service to `main`; it immediately built commit `237193f` (the
#447 merge) and **the Next.js build compiled successfully** on Railway.

## What I found
- Railway project `resumetailored-platform` → service `web`
  (`app.resumetailored.com`, `rootDirectory: resumetailored-platform`).
- Its source branch was `claude/resumetailored-platform-setup-pcyekl`. The last
  SUCCESS deploy was commit `b001c296` ("Role-based access + marketing-site
  checkout removal") on that branch — i.e. the old code you were seeing.
- No failed deployment for `237193f` existed at all — because the merge to `main`
  didn't match the watched branch. Nothing was broken; nothing had run.
- All required env vars are present on the service: `ANTHROPIC_API_KEY`,
  `SUPABASE_SERVICE_ROLE_KEY`, `NEXT_PUBLIC_SUPABASE_URL/ANON_KEY`,
  `CLERK_SECRET_KEY`, `NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY`, `ENTITLEMENT_SYNC_SECRET`,
  `LEGACY_SITE_URL`.

## What I changed
- **Repointed the `web` service source branch → `main`** (via Railway
  `connect-service-source`). No code change was needed — the app already built
  clean. This also means future merges to `main` auto-deploy the app.
- A new deploy started automatically: `65c9b572`, commit `237193f`, branch `main`.
  Build log confirmed: `✓ Compiled successfully`, types valid,
  `✓ Generating static pages (11/11)`, collecting build traces. Only benign
  warnings (Supabase "use Node 22" notice; npm audit).

## Was main safe to deploy? (checked — yes)
`main` and the old deploy branch have diverged, so I verified the app content
before switching:
- Under `resumetailored-platform/` (the only path this service builds), the
  **entire** diff between the two branches is exactly the #447 files. `main`'s
  `lib/plan.ts` already contains the role-based-access work
  (`canUseIndividualPro`/`isEmployer`), so `main` is a strict superset for the
  app — **no regression** to the role/checkout behaviour.
- The branch divergence lives only in **old-site files** (`server.js`,
  `public/…`) from the "marketing-site checkout removal" commit. This service
  does not build the old site, so it's unaffected.

## Open questions / things for you to confirm
1. **Branch strategy (please confirm).** The app now deploys from `main`. That's
   the sensible canonical branch, but you'd been developing on
   `claude/resumetailored-platform-setup-pcyekl`. Going forward, is `main` the
   branch you want the app to track? If yes, nothing more to do.
2. **The old site (`resumetailored.com`).** Its latest changes (the `server.js`
   `/api/app-checkout`, `/api/entitlement` type/tier, marketing checkout removal)
   are on `claude/resumetailored-platform-setup-pcyekl` and are **not on `main`**.
   I did **not** touch the old site or that branch. Two things to decide:
   - Where does the old site deploy from? If it's a separate service still
     tracking that branch, it's fine. If it should also come from `main`, that
     branch's old-site commits need to be merged into `main` first (I can do that
     as a separate PR if you want — it's outside this session's app branch).
   - To stop the branches drifting, reconcile them (merge one into the other).
     Say the word and I'll open a PR to bring the setup branch's old-site work
     into `main` (or vice-versa).
3. **Supabase.** The `SUPABASE_SERVICE_ROLE_KEY` is set on Railway ✅. Confirm you
   ran `supabase/migrations/0001_generations.sql` — without the table, the
   dashboard stat cards stay at zero (everything else works).

## Next
Once the deploy shows SUCCESS (building was on its last step when I wrote this),
do your live test: sign in → dock → Resume Tailor → template → paste → Tailor →
PDF. I'll confirm the deploy reached SUCCESS and that the app boots.
