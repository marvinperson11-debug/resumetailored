# Dashboard Refactor — Phase 2 Report (Security Hardening)

Branch: `claude/resumetailored-dashboard-refactor-4mjgrq` (same PR, #387)
Scope: **Phase 2** — security. Built on Phase 1. Phases 3–4 not started.

Guiding principle for a **live product with real subscribers**: every change is
**additive and backward-compatible**. Header-based auth keeps working, CSRF only
gates the requests that are actually CSRF-vulnerable, and no existing user is
force-logged-out.

---

## Files changed
- `server.js` — cookie parsing, auth-cookie issuance, CSRF guard, forum
  sanitization, upload magic-byte validation.
- `public/app.html` — cookie-first auth, global CSRF fetch wrapper, forum output
  escaping, client-side upload size guard.

No files created or deleted. All 39 backend tests pass.

---

## Item-by-item

### 6. Sanitize `innerHTML` — **forum stored-XSS fixed (both layers)**
The forum was a real stored-XSS hole: posts stored raw `author`/`role`/`text`
and the client injected them into `innerHTML` unescaped, so `<img src=x
onerror=…>` executed for every viewer.
- **Render (authoritative):** `renderForum()` now `escHtml()`-escapes every
  user field (author, role, text, time — posts *and* replies).
- **Storage (defense-in-depth):** `POST /api/forum` and `/api/forum/:id/reply`
  run content through `_sanitizeUserText()` (strips HTML tags + control chars,
  caps length) before writing.
- Verified: a post with `<script>`/`<img onerror>` is stored tag-stripped and
  renders inert.
- **Scoped out (intentionally):** `applyLangApp()`'s `innerHTML` writes come from
  the `APP_I18N` dictionary — developer-authored constants, not user input — so
  they're not an injection vector. Phase 3 item 14 rewrites that function anyway.
  `renderAtsDashResults()` already builds chips with `createElement`/`textContent`
  (safe). The user-content surface (forum) was the real target.

### 7. Auth cookies — **httpOnly session cookie, no mass logout**
- Login / signup / LinkedIn / Google session routes now call `_setAuthCookies()`,
  setting **`rt_session`** (httpOnly, `SameSite=Strict`, `Secure` in prod) and a
  readable **`rt_csrf`** double-submit cookie. `Secure` is auto-omitted on plain
  http so local/dev and the test harness still work.
- `getSessionEmail()` reads the **Authorization header first, then the cookie**.
- Client: `checkAuth()` always calls `/api/auth/me` (the cookie can authenticate
  with nothing in localStorage); `doLogin/doSignup`/both OAuth handlers **no
  longer persist `rt_token`**; `doLogout` clears cookies server-side.
- **No mass logout:** existing users still have a legacy `rt_token`. The client
  keeps sending it as a bearer header until `/api/auth/me` **auto-mints cookies**
  for them (in the `me` route) and the client drops the legacy token. Gates that
  used `getToken()` as a "logged-in" proxy (saved-resume sync) now use the
  `isLoggedIn` state instead, so cookie-only users aren't treated as guests.
- `localStorage` now holds only `rt_email`, `rt_username`, `rt_lang`,
  `rt_remember_email` — **`rt_token` is no longer written.**

### 8. CSRF — **double-submit, only where it's needed**
- `csrfGuard` on `/api/*`: for mutating methods, **if the request authenticated
  via cookie**, it requires `X-CSRF-Token` === `rt_csrf`. Bearer-token requests
  are skipped — a token in our localStorage can't be auto-sent by an attacker's
  page, so they're inherently CSRF-immune. Unauthenticated mutations (login,
  signup, contact) have no session to abuse and are skipped too.
- Client: a **global `fetch` wrapper** attaches `X-CSRF-Token` to every
  same-origin mutating request, so no individual call site can forget it (there
  are dozens). `authHeaders()`/`authHeadersNoType()` also include it.
- Verified: cookie-auth `POST` with no header → **403**; with header → **200**;
  bearer-auth `POST` with no header → **200** (immune); `GET` never gated.

### 9. CSP — **already present and stronger than the suggested policy**
The app already sets a full CSP on every response via `SC.buildCSP()`
(`security.js`). It's better-tuned than the checklist's suggestion — it correctly
allows Cloudflare's edge-injected analytics beacon and `esm.sh` (which
`preview.html` needs), and a permissive `img-src https:` for user photos. I
started to add a dashboard-scoped override and **reverted it** because it would
have *regressed* that policy (blocked the Cloudflare beacon, over-restricted
images). `'unsafe-inline'` stays until Phase 3 extracts the inline blocks, exactly
as the checklist notes. **No change needed.**

### 10. Server-side Pro validation — **already enforced**
`isSubscriber(email)` is independently checked server-side on ~30 endpoints
(resume video, media upload, downloads, CSV/auto-fill export, every Career-Hub
Pro feature), returning **402/403**. The client `isSubscriberFlag` is UI-only.
**Follow-up (not a Phase 2 blocker):** several endpoints derive `email` from the
request rather than the session token. That's a pre-existing design and the
subscription check itself is real, but tying Pro checks to `getSessionEmail(req)`
instead of a client-supplied `email` would be a worthwhile hardening pass — flag
me if you want it.

### 11. File-upload hardening
- Document upload (`/api/extract-text`): limit **10 MB → 5 MB**; new
  **magic-byte validation** (`_docMagicOk`) — the content must match the
  extension (`%PDF-`, `PK` zip for docx, OLE2 for doc, NUL-free for txt) and
  **any executable (MZ/ELF/`#!`) is always rejected**. Verified: an `MZ`-header
  file renamed `.pdf` is now a 400.
- Storage location: the doc uploader uses `memoryStorage` (never written to the
  webroot at all); the media uploader already streams to
  `${DATA_DIR}/site-media/.tmp` (outside `public/`) with per-kind size caps and
  cleanup on every rejection. So "store outside webroot" already held.
- Client: `checkDocSize()` rejects >5 MB before uploading, on all three document
  upload handlers (resume, ATS, video). Server remains authoritative.

---

## Breaking changes to test manually
1. **Log in** (email/password, Google, LinkedIn) → confirm you land logged-in and
   `document.cookie` shows `rt_csrf` (and a `rt_session` httpOnly cookie exists in
   devtools → Application → Cookies).
2. **Existing session:** with an old `rt_token` in localStorage and no cookies,
   load the dashboard — you should stay logged in and, after load, have cookies
   (auto-migration), with `rt_token` removed from localStorage.
3. **A mutating action** (post to forum, save a check-in, publish a site) works
   while logged in — confirms the CSRF header is flowing.
4. **Forum:** post text containing `<b>hi</b>` or `<script>` — it should display
   as literal text, never render/execute.
5. **Upload** a real `.pdf`/`.docx`/`.txt` resume (works) and a renamed
   non-document (rejected with the content-mismatch message).
6. **Logout** clears the session (cookies gone, guest nav).

## Trade-offs / deviations
- **CSP left unchanged** (item 9) — the existing one is stronger; overriding it
  would regress. Documented above.
- **CSRF scoped to cookie-auth** rather than blanket-required — this is the
  correct threat model and is what keeps existing bearer clients working.
- **`SameSite=Strict`** per the checklist. Trade-off: a session cookie isn't sent
  on a top-level cross-site navigation (e.g. clicking a link from an email lands
  you logged-out until the SPA re-auths via `/api/auth/me`, which still works via
  the flow above). `Lax` would soften that; say the word if you'd prefer it.
- **Item 10 email-source** hardening deferred as a documented follow-up.

## Open question for Phase 3
Phase 3 is the big "god-file split" (extract JS/CSS modules, remove inline
handlers, data-driven i18n). It's mechanical but large and high-churn. Do you
want it as **one big PR** on this branch, or **several smaller PRs** (e.g. one per
module group: auth+utils, forum+career, website-creator, i18n, CSS) so each is
reviewable? I'd recommend the latter given the file's history. Say which and I'll
start.
