# Employer jobs / shortlists — debug instrumentation (live)

**PR #485** (merged) · **Deployed** to `app.resumetailored.com` (Railway deploy `c64d04b4`, commit `eb7e2d2`, status SUCCESS).

This is a **diagnostic build**, not the final fix. It makes the real error visible so we can fix the exact cause and then revert the instrumentation.

---

## What was hiding the error

The create functions wrapped their Supabase insert in `try/catch` and returned `null` on **any** failure:

```ts
// before
try {
  const { data, error } = await c.from("shortlists").insert({…}).select(…).single();
  if (error || !data) return null;   // ← the real Supabase error was thrown away here
  …
} catch { return null; }             // ← and here
```

The route then only saw `null` and returned a generic `"Could not create the shortlist."` (or, for jobs, the form showed nothing useful). The reads on the same tables fail *open* to empty results, which is why the rest of the portal looked fine while only the writes visibly broke.

## What this build changes (temporary)

- **`lib/employer-store.ts` → `createJob`** and **`lib/employer-collab-store.ts` → `createShortlist`**
  - Stop swallowing. On a Supabase error they now `console.error` the **full** error object and **throw** a message that includes `message | details | hint | code`.
  - If the Supabase client itself isn't configured (missing `NEXT_PUBLIC_SUPABASE_URL` / `SUPABASE_SERVICE_ROLE_KEY`), they throw a clear "client not configured" error.
  - `duplicateJob` wraps its `createJob` call so the duplicate action keeps its best-effort behavior.
- **`app/api/employer/jobs/route.ts`** and **`app/api/employer/shortlists/route.ts`** (POST)
  - Log the resolved **Clerk userId** and the received **payload** at the top.
  - Wrap the create in `try/catch` and return the **real `error.message`** in the 500 JSON.

## Frontend check (step 4) — verified correct

- Job form (`jobs-client.tsx` → `save()`): `POST /api/employer/jobs`, `Content-Type: application/json`, body has `title, description, department, location, remoteType, employmentType, salaryMin/Max, salaryCurrency, requirements, niceToHaves, deadline, status, publicListed`. It already surfaces `d.error` into the form's error banner.
- Shortlist modal (`shortlists-client.tsx`): `POST /api/employer/shortlists`, JSON body `{ name, description }`.

Both match their routes exactly — **the failure is server-side**, so the new logs/response will name it.

---

## How to get the real error (please do this)

Retry both actions on the live site, then grab the message from **either** place:

1. **Browser** — the shortlist toast / job form error banner now shows the actual message instead of the generic text. (If you want the raw JSON: DevTools → Network → the failed `POST` → Response.)
2. **Railway logs** — service `web`, look for:
   - `[jobs POST] userId: … payload: …` / `[shortlists POST] userId: … payload: …`
   - `[createJob] supabase error: …` / `[createShortlist] supabase error: …` (the full object)

Paste me either one and I'll fix the specific cause and revert this instrumentation in the same PR.

## My leading hypothesis (so you know what to look for)

Given a **manual** `INSERT (employer_id, name, description)` into `shortlists` succeeded, but the API insert also does `.select("id, name, description, created_at, updated_at")`, the most likely message is a **missing column** on the live table that only the `select` touches — e.g. `column shortlists.updated_at does not exist`. For jobs, the analogous suspect is **`public_listed`** (the code selects/writes `public_listed`; a table created before that column was added wouldn't have it). If that's what the log says, the fix is a one-line `ALTER TABLE … ADD COLUMN …` migration (or dropping the column from the query) — but I'll confirm against the actual message rather than guess.

Other possibilities the message will distinguish:
- `userId: null` in the log → Clerk auth isn't resolving on the server (the insert never runs). Fix is in auth, not the DB.
- "Supabase client not configured" → `SUPABASE_SERVICE_ROLE_KEY` isn't set on the `web` service.

## After we fix it
This instrumentation is intentionally noisy (`console.error` of payloads) and returns raw DB messages to the client — I'll **revert** the logging/`throw` changes once the root cause is fixed, keeping only the actual fix.

## Unrelated, still open
- **#481** email notifications — draft, awaiting your merge after testing.
- The pre-existing `test` (homepage-nav) failure on `main` — still there, unrelated; happy to fix in its own PR.
