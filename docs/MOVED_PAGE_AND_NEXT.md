# Step 1 done — old addresses forward. Steps 2 and 3 next.

On branch `claude/resumetailored-pricing-plan-iwy6un`. 477 assertions green.

---

## 1. Your answers, recorded

- **Q1** — C covers **name, headline, location, summary, skills** only. Experience and education stay one block. Per-entry editing is a separate feature.
- **Q2** — Ask again next session; **after two "No"s on the same field, never ask again** and leave it permanently detached. Manual re-sync stays available from Back Office.
- **Q3** — Order: moved page → Back Office → Feature C.

---

## 2. The moved page — done, but built differently than "a page"

Changing your address used to leave the old one returning a bare **404**. Someone may have put that link on an application last week.

**It's a 301 redirect, not a "we've moved" page.** The person holding the old link wants the site, not an explanation — and a redirect carries search ranking across, which matters for a page whose whole job is being found. Your spec said "redirect or show a moved message"; I took the redirect.

Four things a naive redirect would get wrong:

| | |
|---|---|
| **Sub-pages keep their page** | `/site/old/work` → `/site/new/work`, not the home page |
| **Renaming twice doesn't chain** | every older address repoints at the newest — never more than one hop |
| **A live site beats a forward** | if someone later takes a name that used to forward, the real site wins and the forward is dropped |
| **Unpublished targets aren't forwarded to** | bouncing someone from one dead page to another is worse than the 404 it replaced |

It works on the subdomain host and the cover-letter download too — otherwise the fix would only apply to the URL shape people *aren't* given.

### One thing I changed that you didn't ask for

The rename prompt said *"Changing this breaks the old link."* That's now false — it forwards. It says so instead.

Telling someone their shared links are about to break when they aren't would have made people avoid a feature that's actually safe.

**+8 assertions** (site-publish 81 → 89).

---

## 3. Steps 2 and 3 — not started

I'd rather stop cleanly here than start the Back Office and leave it half-wired.

**Back Office** needs the site list from Feature A (thumbnail, template name, last edited, Edit/Publish/Delete, one Published badge) plus the current address from Feature B. The API for all of it exists — `GET /api/personal-sites` returns exactly those fields, and `DELETE /api/personal-sites/:sub` works. It's UI work against endpoints that are done and tested.

**Feature C** is unchanged from my last note, now scoped to five fields.

---

## 4. One question before I write Feature C

### How should a failed write-back behave?

C writes into `saved_resumes` — the document people apply to jobs with. The write has to find and replace one line of free text without disturbing the rest.

Most of the time that's straightforward: the name is line one; the summary is the body under `SUMMARY`. But resumes vary, and there will be documents where the field can't be located confidently — no `SUMMARY` heading, an unusual contact line, a name that isn't on line one.

Three ways to handle that case:

| | Behaviour | Risk |
|---|---|---|
| **A. Refuse and say so** | "We couldn't update your resume automatically — your website is updated." Site detaches as if they'd said No | Honest; occasionally can't do what was asked |
| **B. Best-effort append** | Write the value somewhere plausible | Can corrupt a document silently — the worst outcome here |
| **C. Refuse + offer to open the resume editor** | As A, plus a route to do it by hand | Best outcome, most work |

**My recommendation: A now, C later.** Never write unless the location is unambiguous. A resume that quietly gains a stray line, discovered at the worst moment, is far more damaging than a feature that occasionally says "couldn't do that automatically."

I'll build A unless you say otherwise — it doesn't block me starting.

---

## 5. What I'd check when this deploys

The forwarding is server-verified but worth one real click: rename a published site, then open the old URL. You should land on the new one with the address bar showing the new address.
