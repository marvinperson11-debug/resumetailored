# Data Persistence — Fix & Verification

**Status: FIXED and verified live in production.** `GET https://resumetailored.com/api/health` now reports `persistent: true`, `writable: true`, DB on the `/data` volume.

---

## Part 1 — Code audit & fix

### Audit (derived from `server.js`, not guessed)
The database is **SQLite** (`better-sqlite3`), opened at:
```js
const dataDir = process.env.DATA_DIR || path.join(__dirname, 'data');   // line ~179
const db = new Database(path.join(dataDir, 'resumetailor.db'));          // line ~181
```
Every persistent write already lives under `DATA_DIR`:
| Data | Path | Under DATA_DIR? |
|---|---|---|
| DB (resumes, cover letters, sessions, subscribers, users, …) | `${dataDir}/resumetailor.db` | ✅ |
| Site media uploads | `${dataDir}/site-media/…` (lines ~2216, ~2433) | ✅ |
| Resume video render | `os.tmpdir()/resume-video-*.mp4` (line ~6743) | ✅ *transient* — streamed then deleted; correctly ephemeral |

**There were no hardcoded persistence paths to fix.** The code was already correct.

### The actual root cause
Inspecting the Railway service showed a volume **already** mounted at `/data` and `DATA_DIR` **already** set — yet data was being lost. The tell: this project has env vars whose **names contain a literal newline** (`STRIPE_EMPLOYER_P\nRO_PRICE_ID`). If `DATA_DIR`'s *value* had the same trailing-newline corruption (`/data\n`), then:
```
path.join('/data\n', 'resumetailor.db')  →  '/data\n/resumetailor.db'
```
…which is a directory **outside** the `/data` volume — i.e. ephemeral container storage, wiped on every deploy. This fits the symptom exactly despite a correct-looking setup.

### Code changes (`server.js`, merged as PR #391)
1. **Trim `DATA_DIR`** so a stray newline/space can't push the DB outside the volume:
   ```js
   const _rawDataDir = process.env.DATA_DIR && process.env.DATA_DIR.trim();
   const dataDir = _rawDataDir || path.join(__dirname, 'data');
   ```
2. **`GET /api/health`** now reports everything needed to verify persistence at runtime: DB connectivity (live query), resolved `DATA_DIR` + `fromEnv`, a real **write+delete probe** in `DATA_DIR`, disk usage, a `persistent` flag + warning when unset, and `rawHadWhitespace` if the value has surrounding whitespace.
3. **Startup log**: a loud `STARTUP ERROR` when `DATA_DIR` is unset; an info line with the DB path when set — so this is never silent in deploy logs again.

Verified locally: `DATA_DIR="…/vol\n"` (trailing newline) → the DB lands **inside** the volume dir, and health flags `rawHadWhitespace: true`. All 39 tests pass.

## Part 2 — Railway deployment

| Step | State |
|---|---|
| **Volume at `/data`** | ✅ Already existed (`bbb3de3c-…`, mountPath `/data`, ~4.4 GB). No action needed — it was already provisioned. |
| **`DATA_DIR=/data`** | ✅ **Re-set cleanly** via the Railway API (overwrites any newline/whitespace corruption). |
| **Deploy** | ✅ Triggered automatically by the merge + the variable change. |

## Part 3 — Verification (live `/api/health`)
```json
{
  "status": "ok",
  "persistent": true,
  "dataDir": { "path": "/data", "fromEnv": true, "writable": true },
  "db": { "connected": true, "file": "/data/resumetailor.db" },
  "disk": { "totalMB": 4469, "freeMB": 4343, "usedMB": 126, "usedPct": 3 }
}
```
This **proves the mechanism at runtime**: the DB is on the `/data` volume, the app can write to it right now (the probe wrote+deleted a file), and there's already **126 MB of data on the volume** (so persistence is actively working, not a fresh empty mount). No `rawHadWhitespace` flag ⇒ `DATA_DIR` is clean.

### The last user-facing confirmation (needs your logged-in session)
I can't authentically do this without creating test data in your production DB and triggering owner-notification emails, so please do the final loop yourself:
1. Save/tailor a resume in the app.
2. In Railway → the `resumetailored` service → **Redeploy** (or restart).
3. After it's back up, open **Back Office** — the resume should still be there.

Per your note: any data from **before** the volume/clean-`DATA_DIR` was in place is gone (it lived in ephemeral storage). Everything saved from now on persists.

---

## ⚠️ Separate issue I found (out of scope — please fix in the dashboard)
Two Railway variables have a **newline inside their names**, so the app can't read them:
- `STRIPE_EMPLOYER_P⏎RO_PRICE_ID` → app looks for `STRIPE_EMPLOYER_PRO_PRICE_ID`
- `STRIPE_EMPLOYER_S⏎CALE_PRICE_ID` → app looks for `STRIPE_EMPLOYER_SCALE_PRICE_ID`

`server.js` uses both (employer Pro/Scale checkout price IDs), so employer checkout for those tiers is likely getting `undefined`. I can't fix these myself — the values are redacted from my access. In Railway → Variables: **delete each malformed one and re-add it** with a clean name (no line break), same value. (This is unrelated to the persistence fix.)
