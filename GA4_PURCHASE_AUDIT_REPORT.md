# GA4 purchase-event coverage audit — legacy Express app (Oct 9, 2026)

Scope: `server.js` + `ga4-purchase.js` only. `resumetailored-platform/` untouched (no client-side purchase event added).

## Path
Every checkout is created by one of 5 routes, all `stripe.checkout.sessions.create` → Stripe → single `POST /webhook` → `checkout.session.completed` → `trackGa4Purchase(session, { db })`. The call is the FIRST statement in that branch (before the email guard, `_fulfillCheckoutSession`, owner notification), so a missing email or a fulfilment error cannot suppress it, and the whole handler is try/catch → always 200. `/api/checkout/complete` (browser return) fulfils access but sends no GA4 event, so there is no second firing path.

| Tier | Route(s) that create the session | Price ID (env → fallback in `STRIPE_PRICE_IDS`) | Reaches webhook purchase path | value | transaction_id | once |
|---|---|---|---|---|---|---|
| Candidate Pro $19/mo | `/api/subscribe`, `/api/app-checkout` (incl. inline `price_data` retry) | `STRIPE_PRICE_ID` → `price_1Tak3B…` | covered | amount_total/100 = 19 | session id | covered |
| Candidate lifetime $129 | `/api/subscribe-lifetime`, `/api/app-checkout` (plan=lifetime) | `STRIPE_LIFETIME_PRICE_ID` → `price_1TeHW5…` | covered | 129 | session id | covered |
| Employer Portal $49 | `/api/employer/subscribe`, `/api/app-employer-checkout` (plan `portal` → `pro`) | `STRIPE_EMPLOYER_PRO_PRICE_ID` (or legacy `STRIPE_EMPLOYER_PRICE_ID`) → `price_1U4QHk…` | covered | 49 | session id | covered |
| Employer Scale $99 | same two routes | `STRIPE_EMPLOYER_SCALE_PRICE_ID` → `price_1U4QIg…` | covered | 99 | session id | covered |
| Employer Corporate $299 | same two routes | `STRIPE_EMPLOYER_CORPORATE_PRICE_ID` → `price_1U71yW…` | covered | 299 | session id | covered |

**Corporate has a price ID**: a hard-coded catalog fallback (`STRIPE_PRICE_IDS.corporate`), plus the optional env var; the startup check logs which one is in use. I could not verify the live Stripe amount of that price from here — confirm in the Stripe dashboard that `price_1U71yWCgLyCpwXXjiRpwjm0b` is $299/mo (GA4 value follows whatever Stripe charges, via `amount_total`).

Value and currency come from `amount_total` / `currency` (not from our price table), so a coupon or tax is reflected as charged. Dedupe: `INSERT … ON CONFLICT DO NOTHING` claim on `ga4purchase_<session id>` in `usage_store` before sending, released only if the send fails; GA4 also dedupes on `transaction_id`.

## Gap found and fixed (one)
**Employer item attribution wrong (value was right).** Checkout stamps the tier as `metadata.employerTier` (`pro`/`scale`/`corporate`), but `_plan()` in `ga4-purchase.js` read `metadata.tier`, which no checkout sets. Every employer purchase was therefore sent as item `employer_portal` / "Employer Portal" — Scale ($99) and Corporate ($299) would have been mislabelled Portal in item reports (the old unit test passed only because it used the nonexistent `tier` key).
Fix (6 lines, `ga4-purchase.js`): read `employerTier` (fallback `tier`), map `pro` → `portal`. Checkout logic untouched. Nothing else changed; value/currency/transaction_id logic was already correct.

Tests: `test/ga4-purchase.js` now builds the payload for all six checkout shapes with the exact metadata each route sends, and asserts value, USD, transaction_id and item id per tier. Full test loop: all pass (production-e2e skips on Node 22, as before).

## Not covered by design
- `payment_status != 'paid'` (e.g. 100%-off coupon, `no_payment_required`) sends no event.
- Renewals are not `checkout.session.completed`, so only the first payment is a `purchase`.

## Proof still needed
Per your note, the empirical check is one real checkout: Stripe → Events → the `checkout.session.completed` delivery shows 200, then GA4 Realtime / DebugView shows `purchase` with that session id. (For a test, Stripe test-mode checkout also fires it if the webhook points at the same endpoint.)
