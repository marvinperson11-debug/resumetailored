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
- [ ] Sign in (required) → tailor a resume → real AI output. Free tier is now
      **unlimited** — repeated tailorings should keep working (no `402` cap).
- [ ] As a free user, export a PDF/DOCX → confirm the small footer watermark;
      as Pro, confirm exports are watermark-free.
- [ ] Upgrade → pay with test card `4242 4242 4242 4242` (any future expiry / CVC /
      ZIP) → lands on `/success.html`.
- [ ] Stripe → Webhooks → endpoint → recent deliveries show `200`; that email now
      has Pro (premium templates, resume video, personal website, no watermark).
- [ ] Cancel the test subscription → `customer.subscription.deleted` delivered →
      access revoked.

## 7. Going live

- Swap the three Stripe vars to live keys (`sk_live_…`, `pk_live_…`).
- Recreate the product/price in Stripe **live mode**; update the price IDs.
- Add a **second** webhook endpoint in **live mode** pointing at the same
  `/webhook` URL, with its own `whsec_…` signing secret.

## 8. LinkedIn OAuth import (optional, free feature)

To enable the "Import from LinkedIn" button:
- Create a LinkedIn app and request the **"Sign In with LinkedIn using OpenID
  Connect"** product (scopes `openid profile email`).
- Add its OAuth redirect URL: `https://<your-railway-url>/api/auth/linkedin/callback`.
- Set `LINKEDIN_CLIENT_ID` and `LINKEDIN_CLIENT_SECRET` in Railway (and
  `LINKEDIN_REDIRECT_URI` if your public origin differs from the default).
- If these are unset, the button is simply hidden — nothing breaks.

Note: standard LinkedIn OIDC returns name/email/photo only. Full work history,
education and skills are **not** available without LinkedIn Partner API access,
so the import prefills what it can and asks the user to complete the rest.

## 9. Personal websites (Pro) — path-based today, wildcard subdomain later

Pro users publish a resume at **`/site/:name`** (e.g. `/site/john`). This works
today with no extra infra.

The intended end state is `john.resumetailored.com`. To switch to host-based
subdomains later:
1. Add a wildcard DNS record `*.resumetailored.com` pointing at the Railway app,
   and add `*.resumetailored.com` as a custom domain in Railway so it issues a
   **wildcard TLS certificate**.
2. Add an early host-inspection middleware in `server.js` (before
   `express.static`) that maps `<sub>.resumetailored.com` → the same
   `personal_sites` lookup + `_shareResumeHtml(..., { indexable:true, footer:'' })`
   renderer already used by `/site/:name`, leaving the apex + `www` untouched.
Until wildcard DNS/TLS is provisioned, keep the path-based route.
