# Stripe webhook failures — diagnosis & fix

> ⚠️ **REVISED after checking production logs (2026-08-26).** The code fix below
> is real and deployed, but the Railway logs show the actual production failures
> were **4xx (400 signature-verification failures), not 5xx**. The code fix
> hardens a genuine latent 500 bug but was **not** the cause of the ~2,753 failed
> deliveries. The real cause is a **mismatched `STRIPE_WEBHOOK_SECRET`**. See
> "Production log analysis" below — that is the section to act on.

## TL;DR

Two separate things:

1. **Code (fixed & deployed):** event processing had no `try/catch`, so any error
   thrown while handling a *verified* event escaped to the Express error handler
   and returned **HTTP 500**. Wrapped all post-verification processing in a
   `try/catch` that logs but **still returns 200**; signature failures remain the
   only non-2xx (400). Good hardening — but see below.

2. **Production reality (the actual outage):** `/webhook` received **2,588
   requests over 7 days, 100% 4xx, zero 5xx** — all *before* the deploy. On this
   route a 4xx can only be the **400 from failed signature verification**. The
   `STRIPE_WEBHOOK_SECRET` env var **is set** but its value does not match the
   signing secret Stripe is using → every delivery is rejected. **The code fix
   does not touch this.** The fix is to correct the webhook secret.

## What I checked first

The body-parser ordering claimed as the cause was already fine:

```js
// server.js (unchanged — already correct)
app.use('/webhook', express.raw({ type: 'application/json' }));  // line 1458
app.use(express.json());                                         // line 1459
```

`express.raw` runs first for `/webhook` and sets `req._body = true`, so the
later `express.json()` is skipped for that path and `req.body` reaches
`stripe.webhooks.constructEvent()` as the raw `Buffer` it needs. Signature
verification was working. (A regression test now pins this ordering so it can't
silently break.)

## Root cause

```
POST /webhook
  → signature verified OK
  → a handler throws (e.g. a DB call gets an unexpected value,
    EMPLOYER_TIERS[tier].price on an unknown tier, a downstream email error)
  → throw escapes the synchronous route callback
  → Express catch-all error middleware runs → responds 500  (for a non-/api path
    it even serves 404.html with status 500)
  → Stripe sees non-2xx → marks delivery FAILED → retries for days
```

There was no `try/catch` around the six `if (event.type === ...)` blocks, so a
single bad payload or transient DB hiccup turned every delivery of that event
into a permanent-looking failure with retries.

## The fix (`server.js`, `POST /webhook`)

1. **Kept** the raw-body mount and `constructEvent()` signature verification.
2. **Kept** the `400` return — but now it is the **only** non-2xx path, and only
   for signature-verification failure (security: a request that may not be from
   Stripe is rejected).
3. **Wrapped** all event processing in a single `try/catch`. On any processing
   error we log it (and report to Sentry when configured) and fall through to
   `res.json({ received: true })` — **HTTP 200**.
4. All required event types are handled (they already were, now inside the safe
   wrapper): `checkout.session.completed`, `invoice.paid`,
   `invoice.payment_failed`, `customer.subscription.updated`,
   `customer.subscription.deleted`, `charge.refunded`.

Net diff: +20 lines, no behavior change to the happy path.

## Tests

New: `test/stripe-webhook.js` — boots the real Express app against a throwaway
SQLite DB and drives `POST /webhook` with genuinely Stripe-signed payloads
(via the `stripe` library's own `generateTestHeaderString`, so verification is
real; no network, no live account). It asserts:

- valid signature + well-formed `checkout.session.completed` → **200** and the
  subscriber is inserted (processing still works);
- missing / invalid / tampered signature → **400**;
- a handler that throws on a **valid** event → **still 200** (the regression),
  forced with two different event types by binding a non-string to a
  `better-sqlite3` query so a *real* `TypeError` is thrown inside the handler;
- an unhandled event type → **200** no-op;
- `express.raw` is mounted before `express.json()` (source guard).

```
$ node test/stripe-webhook.js
ALL PASS   (10 assertions)
```

Full regression suite (Node 22 in this environment; the suite is Node-version
agnostic — plain Node scripts under `test/`):

```
$ for f in test/*.js; do node "$f"; done
PASS=62  FAIL=0
```

(`test/browser/*` are deliberately outside the loop — they need Chromium and are
run by hand, per CLAUDE.md.)

## What still needs to happen outside this repo

These are Stripe-dashboard / deploy actions I can't perform from here:

1. **Deploy** this branch to Railway (merge the PR → Railway auto-deploys).
2. **Send a test webhook**: Stripe Dashboard → Developers → Webhooks → the
   `https://resumetailored.com/webhook` endpoint → **Send test webhook** →
   confirm it returns **HTTP 200**.
3. Optionally **replay** the recent failed deliveries from the dashboard now
   that the endpoint returns 200 for processable events. Any that still fail
   will now be logged with the event type/id instead of retried blindly.

## Note on `STRIPE_WEBHOOK_SECRET`

Signature verification still requires `STRIPE_WEBHOOK_SECRET` to be set in the
Railway environment and to match the signing secret shown for this endpoint in
the Stripe dashboard. If a large share of the 2,753 failures were `400`s (not
`500`s), a missing/mismatched secret would be the cause instead — worth a glance
at the failed-request status codes in the dashboard. The code path for both is
now correct; this env var is the one thing to verify in the deploy environment.

---

## Production log analysis (2026-08-26) — the real cause

After the fix was merged and deployed, I pulled the Railway proxy metrics and
logs for the production service to confirm the endpoint was healthy. It is not —
and the data revises the diagnosis above.

### `/webhook` request metrics (production, last 7 days)

| Status class | Count |
|---|---|
| 2xx | **0** |
| 3xx | 0 |
| **4xx** | **2,588** |
| 5xx | **0** |
| **Total** | **2,588** |

- **Zero requests to `/webhook` in the last 24h.** Every one of the 2,588 hits
  falls in time buckets spanning **~Aug 21–24**, i.e. *before* the Aug 25 deploy.
  Nothing has hit the endpoint since.
- **Every request was 4xx. None were 5xx.**

### What a 4xx means on this route

`POST /webhook` returns exactly two things: **200** (acknowledged) or **400**
(`stripe.webhooks.constructEvent()` rejected the signature). It is not under
`/api`, so no CSRF guard, rate limiter, or auth middleware can 4xx it; the route
is mounted, so it is not a 404. Therefore **4xx on this endpoint = 400 = signature
verification failed.** The ~2,588 (≈ the 2,753 Stripe reported) failed deliveries
were **signature rejections all along** — not the 500s the code fix addresses.

### Environment check

`STRIPE_WEBHOOK_SECRET` **is present** in Railway production (variable confirmed;
value redacted). Since the secret exists yet signatures are rejected, its **value
does not match** the signing secret of the endpoint Stripe is POSTing to. Most
likely one of:

- The `whsec_…` in Railway is **stale/rotated** and no longer matches the value
  shown on that endpoint in the Stripe dashboard.
- **Mode mismatch:** `STRIPE_SECRET_KEY` and `STRIPE_WEBHOOK_SECRET` are from
  different modes (one live, one test), or the secret belongs to a different
  endpoint. Both vars are set, but they must come from the *same* mode and the
  *same* endpoint.

### Fix (requires Stripe dashboard access — cannot be done from this repo)

1. Stripe → **Developers → Webhooks → the `resumetailored.com/webhook` endpoint →
   reveal the Signing secret** (`whsec_…`).
2. Confirm that endpoint's **mode (test/live) matches `STRIPE_SECRET_KEY`** in
   Railway.
3. Set that exact `whsec_…` as `STRIPE_WEBHOOK_SECRET` in Railway production and
   **redeploy**.
4. **Send test webhook** from the Stripe dashboard → it should now return **200**.
5. Re-check the Railway `/webhook` metrics — 2xx should begin appearing.

### Verification caveat

Because Stripe has sent **nothing** in the last 24h (the endpoint appears
backed-off or near the Aug 30 auto-disable after so many failures), there is
currently **no live traffic to observe a 200 against**. End-to-end confirmation
depends on the **Send test webhook** step above once the secret is corrected.
