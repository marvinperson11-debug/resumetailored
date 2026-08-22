# ResumeTailored.com — Luxury Revamp Implementation Log

> This file is where I record the scope decisions and any open questions for the
> revamp, per instruction ("put your response to any questions in a markdown
> file"). It is the single source of truth for *what was already present*, *what
> I changed*, and *why I reconciled the plan against the live codebase the way I
> did*.

**Branch:** `claude/resume-tailored-revamp-iloyx0`
**Runner:** Node 20 (`/opt/node20/bin/node`) — the mandated Node 20 suite. Native
`better-sqlite3` is rebuilt for the Node 20 ABI.

---

## 0. Starting state (audit before any change)

The revamp is **already substantially implemented** on `main` (this branch began
identical to `origin/main`). Verified present and working:

- **Old-money luxury aesthetic** — `public/luxury-ecosystem.css`, navy `#071724`,
  gold `#c9a85d`, emerald `#123f35`, Fraunces serif display type.
- **Homepage** (`public/index.html`) — two hero entry points ("Tailor My Resume"
  + "For Employers") and the four pillar cards (Decoder Key, Corporate, Resume
  Video, Web Studio).
- **Corporate portal** (`public/corporate.html` + `corporate.js`) — the Manager's
  Admin Panel with all **21 operational module cards**, drag-to-rearrange,
  collapse/expand, drawers, the **Base Collaboration Layer** row (6 items), tier
  gating with the exact **"Preview · Available in [Tier]"** language the plan
  mandates (no "LOCKED"/"UPGRADE NOW").
- **Pricing** — all five Stripe price IDs from the plan are already in
  `STRIPE_PRICE_IDS` and match exactly (pro `…BnE6P3BR`, lifetime `…y5OMkohS`,
  portal `…lHMDBmHq`, scale `…Py8UtUiS`, corporate `…iRpwjm0b`).
- **Employer portal backend** — profiles, subscribers (4 tiers free/pro/scale/
  corporate), job postings, applications, candidate profiles, AI matching,
  interviews, messaging, nurture. Pure core in `employer-hub.js`.
- **Scale-picks-5 module selection** — `corporate_module_selections` +
  `/api/corporate/modules` (immutable once confirmed).
- **Decoder Key** — public lead-magnet endpoint `/api/decoder-key` with opt-in
  email capture (`decoder_leads`).
- **Stripe webhook** — 5 of the plan's 6 events already handled.

Baseline test result on Node 20: **44 pass, 1 pre-existing fail, 1 gated skip.**
Fixed the pre-existing fail first (see §3).

---

## 1. Reconciliation of the plan's tech stack vs. the live codebase

The plan's "TECH STACK" bullets conflict with the codebase in a few places. The
plan's own overriding rule — *"Use the existing codebase as the foundation … do
NOT delete or overwrite … Build on top of the current working server.js,
database, auth, and Stripe webhooks"* — decides every conflict in favour of the
existing, tested implementation. Decisions:

| Plan bullet | Live codebase | Decision |
|---|---|---|
| `sqlite3` (pure JS), **NOT** better-sqlite3 | `better-sqlite3` (WAL), every route + 40+ tests depend on it | **Keep better-sqlite3.** Swapping the driver would rewrite the whole data layer and break every test — the exact opposite of "build on top". Queries are already parameterized (the security requirement the bullet is really about). |
| Auth: JWT + bcrypt | UUID session tokens in `sessions` table + bcrypt (`bcryptjs`) | **Keep session tokens; add RBAC on top.** The plan's real requirement is RBAC roles, which I add (`company_members.role`). Bcrypt is already used. |
| AI: OpenAI API | Anthropic Claude (`@anthropic-ai/sdk`) | **Provider-agnostic AI helper.** New AI calls use OpenAI when `OPENAI_API_KEY` is set (as the plan specifies for the Decoder), else fall back to the existing Claude path. Claude is not removed. |
| Real-time: Socket.io | none | **Added** (optional, guarded so the test harness — which boots the app and hits REST routes — is unaffected). |
| bcrypt 12+ rounds | `BCRYPT_ROUNDS=10` default | New code paths honour `BCRYPT_ROUNDS` and the default is raised where it does not invalidate the lazy-migration of legacy hashes. |

No `.env` is present (only `.env.example`); there are no live API keys in the
sandbox, so AI/Stripe network calls cannot execute here. Tests therefore seed
data / assert gating and validation directly (the repo's established pattern),
never a live LLM/Stripe call.

---

## 2. What I am building (the genuine gaps), mapped to the plan's §11 order

1. **DB** — new tables: `company_members`, `module_activations`, `module_records`,
   `collab_events`, `interview_sessions`.
2. **Auth/RBAC** — `company_members` (admin/manager/employee), role resolution,
   `requireCompanyRole` gate.
3. **Stripe** — add `invoice.paid`; keep the other 5.
4. **Company mgmt** — invite members; module activation with the **Scale = 5
   modules, then 403 forever** rule enforced server-side.
5. **Base collaboration** — directory / calendar / drive / chat / copilot via a
   unified record engine.
6–10. **21 operational modules** — made *functional* (not just cards) through one
   tier- + role-gated record engine with per-module schemas, statuses, and CSV
   export; manager analytics aggregated from the records; AI copilot.
11. **Job-seeker** — Interview Coach backend (text mode + free teaser + progress,
    voice handled client-side via TTS); Decoder gains the OpenAI path.
12. **Uploads** — module file attachments reuse the existing hardened multer.
13. **Real-time** — Socket.io for chat + notifications.
14. **Testing** — a pure-core suite and a route/integration suite per new area.

Everything already present (aesthetic, homepage, pricing, corporate UI, decoder,
tiers, the 5 existing webhook events) is **kept and extended**, never rebuilt.

---

## 3. Fixes / changes (appended as I go)

- **Fix (pre-existing baseline fail):** `/api/employer/subscribe` returned a 500
  instead of a graceful `503 not_configured` when `STRIPE_SECRET_KEY` is absent
  (a fallback price id was sent to an unauthenticated Stripe client). Added an
  explicit no-secret-key guard → `503 {error:'not_configured'}`. Restores
  `test/employer-portal-routes.js` to green.
