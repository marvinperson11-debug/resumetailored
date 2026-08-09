# Nav / cursor / login fixes

Date: 2026-08-09. Branch: `claude/markdown-file-response-y8qolt`. Three issues from your screenshots, all fixed.

## 1. "Job Tracker" tab appearing in the nav on inner pages ✅

**What was happening:** the homepage has its own nav (no Job Tracker — correct). But every *other* page (Resume Examples, tools, blog, …) gets its nav from one shared script, `public/site-nav.js`, and that script's link list still had a standalone **Job Tracker** tab. So as soon as you clicked off the homepage, the Job Tracker tab popped in.

**Fix:** removed `Job Tracker` from the `site-nav.js` link list. It now matches the homepage exactly:
`How It Works · Free Tools · Pro Tools · Resume Examples · Blog · For Employers · Pricing`.

Job Tracker isn't gone — it already lives **inside Free Tools** (the `/score` hub links it as a card), which is where you wanted it. Nothing else needed to move.

## 2. The little circle following the cursor on desktop ✅

That was a custom cursor (a small green dot + a trailing ring) built by `public/site-motion.js` and styled in `public/site-fx.css`. **Removed both** — the JS that created it and the CSS that styled/hid the native pointer. Desktop now uses the normal system cursor everywhere. (Touch devices never showed it.)

## 3. Clicking "Log In" flashes the login page and bounces back ✅

**Root cause:** you're already signed in. The login page is built to *skip itself* for a logged-in visitor — the moment it confirmed your session it called a redirect back to the page you came from. But the nav's **"Log In"** button never reflected that you were already signed in, so clicking it looked like "the login page won't open" — it opened, saw your session, and bounced.

**Two-part fix:**

- **The nav is now auth-aware.** When a valid session exists, the **"Log In"** button becomes **"Dashboard"** (→ `/dashboard`) — in both the shared nav (`site-nav.js`) and the homepage nav (`index.html`). It only flips after the stored token is validated against `/api/auth/me`, so logged-out visitors still get a normal "Log In" link. You'll no longer be sent to a page that just bounces you.
- **The login page no longer bounces silently.** If you *do* land on `/login` while signed in, it now shows a clear **"You're already signed in as …"** panel with **Continue** and **Use a different account** (log out), instead of flashing and redirecting. So the page always visibly renders.

## Files changed

| File | Change |
|---|---|
| `public/site-nav.js` | Drop Job Tracker tab; auth-aware Log In → Dashboard |
| `public/index.html` | Homepage nav auth-aware Log In → Dashboard |
| `public/login.html` | "Already signed in" panel instead of a silent redirect |
| `public/site-motion.js` | Remove the custom-cursor builder |
| `public/site-fx.css` | Remove the custom-cursor styles |
| `test/nav-cursor-login.js` | New guard test locking in all three |

## Tests

New `test/nav-cursor-login.js` asserts: no Job Tracker nav tab (but still linked in Free Tools), no custom cursor in JS/CSS, auth-aware nav, and no silent login bounce. **Full suite: 38 files green.**

## Note

Because the nav change reacts to *your* stored login token, you'll see the effect once the deploy is live and you reload — a signed-in browser shows **Dashboard**, a signed-out one shows **Log In** that opens the form and stays.
