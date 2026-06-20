# Railway Setup Runbook — AI & Stripe

Step-by-step to get live AI tailoring and Stripe checkout working on Railway.
Use **Stripe test mode** first (no real charges), then flip to live.

> Note: every step here happens in *your* Railway / Stripe / Anthropic
> dashboards. Keep secret keys out of source control and chat — set them only
> in Railway's Variables UI.

## 1. Environment variables (Railway → service → Variables)

Use test-mode Stripe keys (`sk_test_…`, `pk_test_…`) to start.

| Variable | Where to get it |
|---|---|
| `ANTHROPIC_API_KEY` | console.anthropic.com → API keys |
| `STRIPE_SECRET_KEY` | Stripe → Developers → API keys (TEST mode), `sk_test_…` |
| `STRIPE_PUBLISHABLE_KEY` | same page, `pk_test_…` |
| `STRIPE_PRICE_ID` | a TEST recurring price (step 3), `price_…` |
| `STRIPE_WEBHOOK_SECRET` | from the webhook endpoint (step 4), `whsec_…` |
| `STRIPE_LIFETIME_PRICE_ID` | optional — TEST one-time price (step 3) |
| `DATA_DIR` | `/data` (recommended — see step 2) |

Railway redeploys automatically on save.

## 2. Persist the database (recommended)

Without a volume the SQLite DB resets on every deploy (subscribers/users lost).
- Service → Settings → Volumes → **Add Volume**, mount path `/data`.
- Pair with `DATA_DIR=/data` above.

## 3. Create the test-mode price(s) in Stripe

Stripe Dashboard → toggle **Test mode** → Products → Add product:
- "ResumeTailor Pro", **$19/month recurring** → copy `price_…` → `STRIPE_PRICE_ID`.
- (optional) one-time **$129** price → `STRIPE_LIFETIME_PRICE_ID`.

## 4. Webhook endpoint

- Railway → Settings → Networking → **Public Networking**: copy/generate the
  public URL, e.g. `https://<app>.up.railway.app`.
- Stripe (Test mode) → Developers → Webhooks → **Add endpoint**:
  - URL: `https://<app>.up.railway.app/webhook`
  - Events: `checkout.session.completed`, `customer.subscription.deleted`
  - Save → copy **Signing secret** (`whsec_…`) → `STRIPE_WEBHOOK_SECRET` in Railway.

## 5. Verify configuration

After redeploy:
- [ ] `GET https://<app>.up.railway.app/api/status` → `"stripe":true,"stripePrice":true`
- [ ] `GET https://<app>.up.railway.app/api/test-ai` → successful Claude response

## 6. Exercise the flows

Then run `docs/TESTING.md`. Highlights:
- [ ] Tailor a resume → real AI output; 2nd free use same day → `402`.
- [ ] Upgrade → pay with test card `4242 4242 4242 4242` (any future expiry / CVC /
      ZIP) → lands on `/success.html`.
- [ ] Stripe → Webhooks → endpoint → recent deliveries show `200`; that email now
      has unlimited tailoring.
- [ ] Cancel the test subscription → `customer.subscription.deleted` delivered →
      access revoked.

## 7. Going live

- Swap the three Stripe vars to live keys (`sk_live_…`, `pk_live_…`).
- Recreate the product/price in Stripe **live mode**; update the price IDs.
- Add a **second** webhook endpoint in **live mode** pointing at the same
  `/webhook` URL, with its own `whsec_…` signing secret.
