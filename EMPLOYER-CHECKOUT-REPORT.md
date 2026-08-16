# Employer Checkout — Price-ID Wiring Verification

**Bottom line:** the wiring was correct, but your re-added env values were **still corrupted** (invisible characters inside them). The startup log I added caught it in the live deploy logs, and the code now **auto-repairs** the values at runtime — so **employer Pro and Scale checkout work now**. You should still re-enter the two values cleanly in Railway (details below).

---

## 1. Exact var names the code reads (they match what you set)
From `server.js`:
- **Pro tier** → `STRIPE_EMPLOYER_PRO_PRICE_ID` (falls back to legacy `STRIPE_EMPLOYER_PRICE_ID`)
- **Scale tier** → `STRIPE_EMPLOYER_SCALE_PRICE_ID`

Used in `POST /api/employer/subscribe` (checkout) and the Stripe webhook tier resolver. ✅

## 2. Startup presence log (values never printed)
Added a `[stripe]` startup log that reports each id as **loaded ✓ / auto-cleaned / MALFORMED / NOT set** — never the value itself, only its type prefix and length when there's a problem. This is what surfaced the real issue.

## 3. Checkout never sends `undefined` to Stripe
`POST /api/employer/subscribe` picks the price per tier and guards `if (!priceId) return 503 not_configured` — a missing id yields a clean "plan not available", never a broken Stripe call. That's why the corrupted vars produced 503s, not charge errors. ✅

## 4. Deploy + log check — what it revealed
Reading the live deploy logs after each deploy told the real story, in three steps:
1. First log: **both ids `SET but MALFORMED`** — so your re-entered values were still bad.
2. Enhanced diagnostic: **"contains whitespace/newline INSIDE the value"** — the corruption had moved from the variable *names* into the *values*.
3. After stripping whitespace, still malformed (`len=30, prefix="price_"`) — so there's also an **invisible / zero-width character** embedded (one that `\s` doesn't match).

### The fix (merged, deployed)
A Stripe price id is `price_` + alphanumerics and **never** contains whitespace or invisible characters, so `_normPriceId` now strips anything outside `[A-Za-z0-9_]` at every read site (checkout, config, webhook). This is always safe and **recovers the real id from the corrupted value**. Current live logs:
```
[stripe] STRIPE_EMPLOYER_PRO_PRICE_ID: loaded but has stray whitespace — auto-cleaned at runtime; please re-enter the value on one line in Railway
[stripe] STRIPE_EMPLOYER_SCALE_PRICE_ID: loaded but has stray whitespace — auto-cleaned ...
```
`loaded` = the id now resolves to a valid `price_…` → **checkout works**. No Stripe errors on startup; DB/persistence log healthy (`DATA_DIR="/data"`).

No test charges were created — this was inspection + log verification only.

---

## Please still do this (so you're not relying on auto-repair)
The env **values** are technically still corrupted (they carry hidden characters); the app just cleans them at runtime. To make them clean at the source, in Railway → Variables, for **both** `STRIPE_EMPLOYER_PRO_PRICE_ID` and `STRIPE_EMPLOYER_SCALE_PRICE_ID`:
1. Delete the value and **type it fresh** (or copy it directly from the Stripe Dashboard → Product → the **Price** row → the `price_…` id). Avoid pasting from a doc/chat/email, which is how the hidden character got in.
2. Confirm it's a **PRICE** id (`price_…`), not a Product id (`prod_…`).
3. After redeploy, the log should read `[stripe] …: loaded ✓` with no "auto-cleaned" note.

## PRs (all merged to `main`)
#392 (wiring + presence log) · #393 (pinpoint diagnostic) · #394 (strip whitespace) · #395 (strip zero-width/non-alphanumeric). All 39 backend tests pass on each.
