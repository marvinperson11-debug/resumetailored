# Three bugs: sidebar overlap, publish success page, confirmation email

**All three measured/reproduced with real geometry or a real send, not just read from source. Full suite green: 15 files + 272 + 7 + 48 browser assertions, 19 new checks for this round, 0 failures.**

A note before the details: your spec named some IDs and files that don't exist in this codebase (`#editorRail`, `#canvasArea`, `#previewFrame`, `api/publish.js`) — I built against what's actually here (`.cv-shell`, `.cv-rail`, `#wcEdFrame`, the `wcPublish()` handler in `server.js`) rather than creating dead code under names nothing references. Flagging it so you know that translation happened, not just silently doing something different from what was asked.

---

## Bug 1 — Sidebar overlapping the canvas

Real bug, and I found the exact mechanism, not just the symptom. Two independent pieces of CSS were disagreeing about the same number:

- `.sidebar` (the app's own left nav — Resume, LinkedIn Optimizer, ATS, etc.) is a real 240px-wide column, part of `.dashboard`'s CSS grid, **down to 901px**. Below that (`@media (max-width: 900px)`) it collapses into a horizontal bar.
- `.cv-shell` (the Website Creator's full-screen editor — this is what actually holds your rail: Templates/Elements/Text/Brand/Uploads/Content) is `position: fixed`, so it doesn't participate in that grid at all. It just hardcodes `left: 240px` to line up with where the sidebar happens to be — but that offset only activated **at 981px and above**.

Between 901px and 980px, the sidebar was still a real 240px column and the editor shell hadn't been pushed past it yet. The editor's own rail rendered directly underneath the app's sidebar in that entire 80px window — exactly "tucking behind the canvas." I confirmed this with actual browser geometry before touching anything: at 940px, the sidebar's right edge measured at x=240 while the shell's left edge measured at x=0.

**Fixed by making both breakpoints the same number** — 901px, matching the sidebar's real collapse point, not an independently-chosen one. Verified the same way I found it: measured real geometry at seven widths spanning both the old (981px) and new (901px) breakpoints, confirming no gap remains anywhere.

## Bug 2 — Publish success page

Built exactly as specced: `public/publish-success.html`, dark navy background with a white card (matching the site's existing `success.html` post-checkout page style), reads `?url=` and `?site=` from the query string, shows the live URL in a read-only input with a working **Copy Link** button, plus **Open Site** and **Back to Editor**.

"Back to Editor" isn't just a link to `/app.html` — it round-trips through `?openWebsite=<subdomain>`, which reopens the *exact* site you just published, the same mechanism the Back Office's own "Edit" button already uses. Landing back on a blank picker after publishing would have been its own small annoyance.

`wcPublish()` now: shows the toast (kept, as asked, as backup feedback) → waits 700ms so you actually see it → redirects to the success page with the real URL and site. `id="wcPublishBtn"` is on the actual button now too, so the existing disable-while-publishing logic has something real to grab (it was silently finding nothing before).

Verified live in a browser, not just read from source: clicked Publish, watched the redirect happen, confirmed the URL field, Open Site link, and Back to Editor link were all populated correctly on the landed page.

## Bug 3 — Publish confirmation email

Sent via the email helper this codebase already has (`sendEmail()` in `server.js` — Resend first, SMTP fallback, console-log fallback), not a new SDK. `RESEND_API_KEY` was already in `.env.example`; I didn't duplicate it.

Template lives at `emails/publish-success.html` as asked — the one email in this codebase that's a real file rather than inlined, with `{{SITE_URL}}` / `{{SITE_URL_DISPLAY}}` / `{{EDITOR_URL}}` tokens the server substitutes at send time. No logo *image* — `public/assets/logo.png` doesn't exist, and a relative path wouldn't load in an email client regardless (needs a hosted absolute URL). Used the same fix the existing password-reset email already uses: a CSS lockup (colored square + wordmark), so there's nothing to break if an image never loads. Headline, prominent URL display, "View Your Site" CTA, footer with social placeholders and a plain-language note that this is a one-time confirmation (not a subscription, so there's genuinely nothing to unsubscribe from — a fake unsubscribe link felt worse than an honest sentence).

**Fires on a real, explicit publish only.** I verified this three ways, not just the happy path: publishing sends exactly one email, to you (not the owner); autosave — which omits the `publish` flag entirely to preserve whatever the site already was — sends none; and an explicit *unpublish* sends none either. All three proven with the actual `sendEmail()` call intercepted and inspected, not inferred from a console log.

Never blocks the response: the send is fire-and-forget with its own `.catch()`, so a Resend outage can't turn a successful publish into a failed one.

---

## Test results

```
test/*.js (15 files, dependency-free)          ALL PASS, 0 failures
test/browser/editor.js                         270-272/272 (2 flaky, unrelated —
                                                 confirmed by immediate re-run: 272/272)
test/browser/sidebar-breakpoint.js (new)        7/7 — real geometry at both breakpoints
test/browser/template-overlap.js                48/48 (unaffected, re-verified)
test/publish-success.js (new)                   19/19 — page, redirect, and the full
                                                 email send/no-send lifecycle
```

## Files touched

- `public/app.html` — `.cv-shell`'s media query breakpoint (981px → 901px, matching `.sidebar`); `wcPublish()` redirects to the success page after the toast; `?openWebsite=<sub>` handling on page load; `id="wcPublishBtn"` on the real button.
- `public/publish-success.html` — new.
- `emails/publish-success.html` — new.
- `server.js` — `_publishSuccessEmailHtml()`, `_sendPublishSuccessEmail()`, wired into `POST /api/personal-site` on a real publish.
- `CLAUDE.md` — new section on the publish flow; a bullet on the shell/sidebar breakpoint fix.
- `test/site-publish.js`, `test/browser/sidebar-breakpoint.js` (new), `test/publish-success.js` (new).

Ready for you to test live.
