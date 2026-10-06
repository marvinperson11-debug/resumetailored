# Post-deploy verification — PR #596 (checked 2026-10-06)

**Result: PR #596 has not merged, so the new build is not deployed and the post-deploy checks cannot pass yet.**

## 1. Merge and deploy
- GitHub: #596 is **open and draft**; `origin/main` is still at `9a3fb09` (PR #595).
- Railway (resumetailored service): latest successful deploy finished 21:58 UTC and is commit `9a3fb09` (PR #595). It is a redeploy of #595, probably triggered by the `GA4_API_SECRET` change, and does **not** include #596.
- `GA4_API_SECRET` is set, but the code that reads it is not live yet.

## 2. Live checks (Googlebot UA, old build)

| Check | Result now | Expected after deploy |
|---|---|---|
| Homepage title/meta | Old title "ResumeTailored AI — AI Resume Tailor & Cover Letter Generator" and old description | 57-char title "AI Resume Tailoring That Gets Interviews \| ResumeTailored"; 154-char description |
| `/yourname` | 301 → `/` → 200 (no loop) | Same |
| `/site/` | 404 | 301 → `/blog/resume-website-builder` |
| Sitemap `<loc>` count | 335 | 333 |

## 3. Next steps
1. Mark #596 ready for review and merge it; Railway should auto-deploy.
2. Once the deploy shows SUCCESS, re-run the checks above.
3. GA4 `purchase` can only be verified with a real or test-mode Stripe checkout; confirm it in GA4 → Admin → DebugView.
