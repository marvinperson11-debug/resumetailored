# Crawler Access Fix — Cloudflare is injecting `Disallow: /` for AI/search crawlers

**Date:** 2026-08-10
**Scope:** Fix the conflicting crawler directives on `https://resumetailored.com/robots.txt`. No SEO, sitemap, metadata, structured-data, or shared-resume changes.

---

## TL;DR

The `Disallow: /` rules that block Googlebot-adjacent AI crawlers, GPTBot, ClaudeBot, etc. are **not in our code**. Cloudflare is **injecting them at the edge** via its **AI Crawl Control → "Manage robots.txt"** feature (which also carries Cloudflare's new *Content Signals Policy*). Our own `public/robots.txt` is correct and already welcomes every crawler while protecting the private routes.

**The fix is a Cloudflare dashboard toggle, not a code change.** I could not flip it from here because this environment has no Cloudflare credentials or Cloudflare API/MCP access (verified: no `CLOUDFLARE_*`/`CF_*` env vars, no `wrangler`/Cloudflare config in the repo, no Cloudflare tool). Steps to flip it — dashboard and API — are below. **See "Question for you" at the bottom.**

---

## 1. What was blocking the crawlers

`curl https://resumetailored.com/robots.txt` returns a block **prepended above our file** that our repo does not contain:

```
# BEGIN Cloudflare Managed content

User-agent: *
Content-Signal: search=yes,ai-train=no,use=reference
Allow: /

User-agent: Amazonbot
Disallow: /

User-agent: Applebot-Extended
Disallow: /

User-agent: Bytespider
Disallow: /

User-agent: CCBot
Disallow: /

User-agent: ClaudeBot
Disallow: /

User-agent: CloudflareBrowserRenderingCrawler
Disallow: /

User-agent: Google-Extended
Disallow: /

User-agent: GPTBot
Disallow: /

User-agent: meta-externalagent
Disallow: /

# END Cloudflare Managed Content
```

Our own file follows it (starting `# Default — all crawlers welcome`), which for the **same** user-agent names (`GPTBot`, `ClaudeBot`, `CCBot`, `Google-Extended`, `Applebot-Extended`) says `Allow: /`.

**Why this breaks crawling:** the injected block gives `GPTBot`, `ClaudeBot`, `CCBot`, `Google-Extended`, `Applebot-Extended`, `Amazonbot`, `Bytespider`, `meta-externalagent`, and `CloudflareBrowserRenderingCrawler` a hard `Disallow: /`. Because there are now **two groups per user-agent** with opposite rules, behavior is undefined across crawlers: Google merges duplicate groups and may still resolve to allow, but **many crawlers stop at the first matching group** (or treat the more-restrictive rule as authoritative) and honor `Disallow: /`. The result is exactly what you observed — a robots.txt that simultaneously tells the same bot "yes" and "no".

The `Content-Signal: ... ai-train=no ...` line and the EU Directive Article 4 preamble at the top of the live file are the second half of the same Cloudflare feature (the **Content Signals Policy**); they are advisory, not hard blocks, but they also originate from Cloudflare, not us.

### Proof it is edge-injected (Cloudflare), not our origin

| | Our origin (`public/robots.txt` in this repo) | Live `resumetailored.com/robots.txt` |
|---|---|---|
| First line | `# Default — all crawlers welcome` | `# As a condition of accessing this website...` (Content Signals preamble) |
| `# BEGIN Cloudflare Managed content` marker | **absent** | **present** |
| `Disallow: /` for GPTBot / ClaudeBot / CCBot / Google-Extended | **absent** | **present** |
| Response `server:` header | Node/Express (origin) | `cloudflare` |

The `# BEGIN/END Cloudflare Managed content` markers are Cloudflare's own signature. Nothing in the repo produces them.

---

## 2. What Cloudflare setting caused it

Cloudflare's **AI Crawl Control** (previously "AI Audit") has a **"Manage robots.txt"** option. When enabled, Cloudflare *prepends* a managed block to whatever robots.txt your origin serves, adding `Disallow: /` for the AI crawlers it classifies as scrapers, plus the Content Signals Policy header. This is turned on either:

- explicitly, in **AI Crawl Control → Manage robots.txt**, or
- indirectly by a one-click **"Block AI bots" / "Block AI Scrapers and Crawlers"** action (Security → Bots), or
- by a WAF **Managed rule / custom rule** targeting AI bots.

The one that matches this exact output (the `# BEGIN Cloudflare Managed content` markers **and** the `Content-Signal:` preamble) is **AI Crawl Control → Manage robots.txt**.

---

## 3. What to change in Cloudflare (exact steps)

Do this in the Cloudflare account that owns the `resumetailored.com` zone. Work top-to-bottom; stop when the injected block disappears.

### A. AI Crawl Control — turn off managed robots.txt (this is the one)

1. Cloudflare Dashboard → select the **`resumetailored.com`** zone.
2. Left sidebar → **AI Crawl Control** (may appear under **AI** or **Security → Bots**; older UIs label it **AI Audit**).
3. Find **"Manage robots.txt"** / **"Add Cloudflare's managed robots.txt file"** / **Content Signals Policy**.
4. **Turn it OFF** (do not have Cloudflare manage/append robots.txt). This stops the `# BEGIN Cloudflare Managed content` block and the Content-Signal preamble from being injected.

### B. Bot blocking — make sure AI bots are not being blocked

1. Zone → **Security → Bots**.
2. **"Block AI Scrapers and Crawlers" / "Block AI bots"** → set to **Off** (or "Allow"). This is the switch that adds the `Disallow: /` set even without the robots.txt manager.
3. **Bot Fight Mode** — this challenges/blocks automated traffic and can hit legitimate crawlers. Consider **Off** (or use Super Bot Fight Mode with "Verified bots: Allow" and "AI bots/scrapers: Allow") if you want AI crawlers through. Bot Fight Mode does **not** write robots.txt, but it can still block the fetch — worth confirming while you're here.

### C. WAF — check for a rule that blocks AI/known bots

1. Zone → **Security → WAF → Managed rules** and **Custom rules**.
2. Look for anything matching `cf.client.bot`, `cf.verified_bot`, AI user-agents, or a "Block AI bots" managed ruleset. If a rule **blocks** the crawlers you want (Googlebot, Bingbot, GPTBot, OAI-SearchBot, ChatGPT-User, ClaudeBot, PerplexityBot, Google-Extended, Applebot), change it to **Skip/Allow** for verified/legitimate crawlers.

### D. (Only if the toggle in A is not exposed in your plan/UI) — API

If the managed-robots.txt toggle is not visible, or you prefer automation, use the Cloudflare API with a token scoped to this zone. Zone-level AI bot controls live under the zone's bot-management / AI-crawl settings; the exact endpoint depends on your plan, so use the dashboard path in **A/B** first. If you want this scripted, grant a token (see the question below) and I will confirm the current setting and disable it, then re-verify.

> **Do not** try to "fix" this by editing our `public/robots.txt`. The block is injected **above** our content by Cloudflare; adding more `Allow:` lines to our file cannot remove Cloudflare's `Disallow: /` lines and only makes the conflict noisier. The change has to happen in Cloudflare.

---

## 4. The final robots.txt crawler policy (what we serve, and what it should look like once Cloudflare stops injecting)

Our origin file (`public/robots.txt`, unchanged by this task) is the intended policy and it is correct:

- **`User-agent: *` → `Allow: /`**, with `Disallow: /api/`, `/reset-password`, `/success`, `/cancel` (private/system routes stay protected — **kept, not removed**).
- Explicit **`Allow: /`** groups (same private-route disallows) for the crawlers you want:
  - **GPTBot, OAI-SearchBot, ChatGPT-User** (OpenAI)
  - **ClaudeBot, anthropic-ai, Claude-Web** (Anthropic)
  - **PerplexityBot**
  - **Google-Extended, Applebot-Extended**
  - **CCBot** (Common Crawl)
- Googlebot, Bingbot, Applebot are covered by the `User-agent: *` `Allow: /` group (they aren't singled out with any `Disallow: /`).
- **`Sitemap: https://resumetailored.com/sitemap.xml`** — present and preserved.
- `Sitemap: https://resumetailored.com/llms.txt` — present and preserved.

Once Cloudflare's managed block is off, the live file will be exactly this — no `Disallow: /` for any search/AI crawler, private routes still disallowed, sitemap intact.

---

## 5. Confirmation: `/r/...` shared resumes were NOT changed

Nothing about shared resumes was touched. For the record, current behavior (verified in `server.js`, left exactly as-is):

- `/r/:slug` pages render via `_shareResumeHtml(...)` with `noindex,nofollow` **by existing design** (they are private, unguessable share links with a "Made with ResumeTailored" footer and canonical `/r/<slug>`). This is intentional and predates this task — **not** added by me.
- `/r/...` is **not** blocked in `public/robots.txt` (no `Disallow: /r/`), is **not** in the sitemap, and does **not** require auth. All of that is unchanged.
- Removing Cloudflare's injected AI-bot block does not alter `/r/` in any way — those pages keep their own `noindex` and keep working as share links exactly as before.

No `noindex`/`nofollow` added to `/r/`, no robots block added, no sitemap change, no auth requirement added.

---

## 6. How to verify after you flip the Cloudflare toggle

Run (or ask me to run) this and confirm the managed block is gone:

```bash
curl -s https://resumetailored.com/robots.txt
```

Expected after the fix:

- **No** `# BEGIN Cloudflare Managed content` block.
- **No** `Disallow: /` line under `GPTBot`, `ClaudeBot`, `CCBot`, `Google-Extended`, `Applebot-Extended`, `Amazonbot`, `Bytespider`, `meta-externalagent`.
- Still present: `User-agent: *` → `Allow: /` with the `/api/`, `/reset-password`, `/success`, `/cancel` disallows.
- Still present: `Sitemap: https://resumetailored.com/sitemap.xml`.

Optional: in Google Search Console → **robots.txt report** (and the URL Inspection tool) confirm Googlebot is no longer blocked; in Bing Webmaster Tools use "Verify robots.txt". Cloudflare edge-caches robots.txt, so allow a few minutes / purge the cache for `/robots.txt` if the old version lingers.

---

## Question for you

I diagnosed the cause and wrote the exact fix, but **I cannot perform the Cloudflare change from this environment** — there are no Cloudflare credentials, no Cloudflare API token, and no Cloudflare integration available to me here. Two ways forward:

1. **You flip the toggle** — follow **§3.A** (and check **§3.B/§3.C**). Fastest; it's one setting. Then run the **§6** verification (or tell me and I'll re-fetch the live file to confirm).
2. **I do it via API** — if you create a **Cloudflare API token scoped to the `resumetailored.com` zone** (Zone → Bot Management / AI Crawl settings edit permission) and share it with me, I'll disable the managed robots.txt / AI-bot block via the API and re-verify the live output. (Prefer a short-lived, zone-scoped token you can revoke afterward.)

Which do you want? Nothing in the codebase needs to change to resolve this — our `robots.txt` is already correct.

---

## Update — 2026-08-10 (follow-up: `/r/` indexing + live re-verify)

### robots.txt is STILL serving Cloudflare's `Disallow: /` block ⚠️

After you reported disabling the Cloudflare-managed robots.txt, I re-fetched the live file (cache-busted, `https://resumetailored.com/robots.txt?cb=<ts>`) and the injected block is **still present** — `# BEGIN Cloudflare Managed content` and nine `Disallow: /` lines for `GPTBot`, `ClaudeBot`, `CCBot`, `Google-Extended`, `Applebot-Extended`, `Amazonbot`, `Bytespider`, `meta-externalagent`, `CloudflareBrowserRenderingCrawler`. **The crawler block is not yet lifted on the live edge.** Likely one of:

1. **Cloudflare edge cache** — Cloudflare caches `/robots.txt`. Purge it: Dashboard → **Caching → Configuration → Purge Cache → Custom Purge** → enter `https://resumetailored.com/robots.txt` (or Purge Everything). Then re-check.
2. **Only half the feature was turned off** — the live block contains *both* a `Content-Signal:` policy line *and* the `Disallow: /` rules. If you disabled only "Content Signals" (or only the block-list) the other half persists. In **AI Crawl Control**, make sure **"Manage robots.txt" / "Add managed robots.txt" is fully OFF** (not just the content-signal sub-option).
3. **Applied at the wrong scope** — confirm the toggle was changed on the **`resumetailored.com` zone** (not a different zone / account-level template that doesn't apply here).

Re-run to confirm success (expect `0`):
```bash
curl -s "https://resumetailored.com/robots.txt?cb=$(date +%s)" | grep -c "BEGIN Cloudflare Managed content"
```
Tell me when you've purged/re-toggled and I'll re-verify the live file end-to-end.

### `/r/:slug` shared resumes are now indexable ✅ (code change, shipped in this branch)

Per your instruction, future public shared resumes can now be indexed by Google + AI search. The **only** change to shared resumes is the crawler directive — content, footer, expiry, view counting, unguessable slug, and the renderer are all untouched:

- `server.js` `/r/:slug` route: `X-Robots-Tag` header `noindex, nofollow` → **`index, follow`**, and `_shareResumeHtml(row, origin)` → **`_shareResumeHtml(row, origin, { indexable: true })`** (flips the page `<meta name="robots">` to `index,follow`).
- `test/render-snapshot.js` + `test/golden/link.html`: the `/r/` byte-identical snapshot regenerated — the **only** diff is that one robots line (`noindex,nofollow` → `index,follow`). Full suite passes.
- Docstring + `CLAUDE.md` factual lines updated from "noindex" to "indexable". No robots.txt block on `/r/` (there never was one), no auth added, nothing else changed.

### Sitemap — intentionally left unchanged (already correct) ✅

`public/sitemap.xml` needs **no** change to support indexing of future public `/r/...` resumes, and I made none:

- `/r/` URLs are **dynamic, per-user, unguessable slugs that do not exist yet** (no customers). A sitemap can only list real, canonical, 200-status URLs — it cannot enumerate resumes that haven't been created, and there are none to add. Adding entries now would mean **placeholder URLs**, which you explicitly ruled out.
- Enumerating every `/r/` slug in the public sitemap once they exist would also **publish every user's private share link** — the opposite of how these unlisted links are meant to work — so a dynamic `/r/` sitemap is the wrong tool, not a missing one.
- Indexing of `/r/` pages does **not** depend on the sitemap: it depends on the pages being (a) crawlable — robots.txt already does not block `/r/` — and (b) indexable — now fixed above. Discovery happens through the inbound links users share (LinkedIn, email, etc.), which is exactly how UGC resume pages get found. The existing sitemap architecture already handles the site's canonical marketing/tool/SEO surface correctly, so per your instruction it is left alone.

**Net:** the one blocker left is the live Cloudflare robots.txt (item ⚠️ above), which is on the Cloudflare side — purge the cache / confirm the managed-robots.txt toggle is fully off, and I'll re-verify.
