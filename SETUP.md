# ResumeTailor AI — Setup Guide

## 1. Install dependencies
```bash
cd resumetailor
npm install
```

## 2. Get your API keys

### Anthropic (Claude API)
1. Go to https://console.anthropic.com
2. Create an API key
3. Cost: ~$0.003 per tailoring (very cheap)

### Stripe
1. Go to https://dashboard.stripe.com
2. Get your **Secret key** and **Publishable key** from Developers → API keys
3. Create a Product: Products → Add Product
   - Name: "ResumeTailor Pro"
   - Price: $19/month, recurring
   - Copy the **Price ID** (starts with `price_`)
4. Set up webhook: Developers → Webhooks → Add endpoint
   - URL: `https://your-domain.com/webhook`
   - Events to listen: `checkout.session.completed`, `customer.subscription.deleted`
   - Copy the **Webhook signing secret**

## 3. Configure environment
```bash
cp .env.example .env
```
Fill in `.env`:
```
ANTHROPIC_API_KEY=sk-ant-...
STRIPE_SECRET_KEY=sk_live_...
STRIPE_PUBLISHABLE_KEY=pk_live_...
STRIPE_WEBHOOK_SECRET=whsec_...
STRIPE_PRICE_ID=price_...
PORT=3000
```

## 4. Run locally
```bash
npm run dev
```
Visit http://localhost:3000

## 5. Deploy to Railway (free tier available)
1. Go to https://railway.app and sign up (free)
2. New Project → Deploy from GitHub repo
3. Add all environment variables in Railway dashboard
4. Railway gives you a public URL automatically
5. Update your Stripe webhook URL to the Railway URL

## Revenue math
- 100 subscribers × $19/month = **$1,900/month**
- 263 subscribers × $19/month = **$5,000/month**
- Claude API cost at 263 users (avg 20 tailorings/month each): ~$315/month
- **Net at $5k revenue: ~$4,685/month**

## Growth channels (all free)
1. Post before/after resume examples on LinkedIn/Reddit (r/jobs, r/resumes)
2. Answer questions on Reddit about resume writing — link in bio
3. List on Product Hunt, Indie Hackers, BetaList
4. SEO: target "resume tailoring tool", "ATS resume optimizer"
