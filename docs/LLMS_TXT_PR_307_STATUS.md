# PR #307 status — llms.txt

**CI: green.** Netlify's deploy preview built successfully for the latest commit (`740687a`), which includes everything from the llms.txt task:

- Refreshed `public/llms.txt` (fixed stale "1/day" free-tier and "$19/month" pricing, added the last-updated comment)
- New reusable `generateLlmsTxt(siteData)` builder in `llms-txt.js`
- Auto-generated, always-fresh `llms.txt` for every published personal website — `/site/:sub/llms.txt` and the host-based subdomain equivalent
- `robots.txt` now points at the platform `llms.txt`
- `test/llms-txt.js` — 33 new checks, all passing; full suite still 0 failures

Deploy preview: https://deploy-preview-307--mellow-macaron-463353.netlify.app

PR: https://github.com/marvinperson11-debug/resumetailored/pull/307

No open questions from me — the PR is a draft, still open, and I'm watching it for CI failures or review comments. Say the word and I'll merge it, or let me know if you want to try it on the deploy preview first.
