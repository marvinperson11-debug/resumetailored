# Stripe webhook failures — diagnosis & fix

## TL;DR

The reported "most likely cause" (`express.json()` mounted before the webhook
route) was **not** the problem — that ordering was already correct. The real
cause was that **event processing had no `try/catch`**, so any error thrown
while handling a verified event escaped to the Express error handler and
returned **HTTP 500**. Stripe records any non-2xx as a failed delivery and
retries it for days, which is what produced the backlog of failed requests.

Fix: wrap all post-verification processing in a `try/catch` that logs the error
but **still returns HTTP 200**. Signature failures remain the only non-2xx (400).

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
