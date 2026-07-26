# Merged and deployed. Feature A done — B and C are not, and here's why

`main` is at **`07bd37a`** (PR #272 merged, Railway deploys from there). Feature A is on the branch. **B and C I have not built.**

---

## 1. Merged and deploying

PR #272 went in: all fourteen click-through fixes, subdomain URLs going live, and the changeable web address. Railway picks it up from `main`.

---

## 2. Feature A — done

A different template is a different **site**, generated fresh from the resume. Trying one never overwrites what they've been working on — that's what makes trying one safe.

```
GET    /api/personal-sites          every site, newest first, with template
                                    name, address, views, dates
POST   /api/personal-site/autogen   {templateId, fresh:true} → another site
DELETE /api/personal-sites/:sub     removes one, by name
```

**Only one live.** Publishing a site takes every other one of theirs down, server-side. Two versions of the same person on the internet at once is the failure this prevents, and it isn't left to the client to remember.

**Reachable** from 💬 Not sure? → *"I want to try a different design"*, with a plain-English confirm that says their current site is kept.

**Addresses are named after their template** — `alice`, `alice-developer`, `alice-studio` — rather than `alice-2`, `alice-3`.

### One contract change worth knowing

With several sites, posting a different subdomain is genuinely ambiguous between *"move this one"* and *"make another"*. So a rename now must send `renameFrom`. Without it the old address would silently stay live alongside the new one.

The existing tests caught this the instant the behaviour changed — which is exactly why they were written against behaviour rather than implementation.

**22 new assertions** (site-publish 59 → 81; 469 total).

---

## 3. Feature B — mostly already there, one piece missing

Most of B shipped in #272:

| B asks for | Status |
|---|---|
| Choose `[name].resumetailored.com` | ✅ changeable any time |
| Default: pre-filled with username | ✅ |
| Validate letters/numbers/hyphens, uniqueness | ✅ refused with a reason |
| Change it any time | ✅ top bar + help panel |
| Show current URL clearly in the editor | ✅ live link in the bar |
| **Old URL redirects or shows "moved"** | ❌ **currently a plain 404** |
| Choose it during the publish flow | ❌ only after the fact |
| Show it in Back Office | ❌ Back Office not updated |

**The "moved" message is the one I'd prioritise.** Right now a renamed site's old address 404s, so anyone holding the old link just sees "not found" — which is the case the feature exists to soften.

---

## 4. Feature C — not started

I want to be straight rather than hand you something half-built.

C is the largest of the three and the only one that **writes to the resume store**, which nothing in the Website Creator has ever done. It needs:

- a non-blocking on-canvas modal (not a browser alert) living inside the iframe
- per-field, once-per-session memory of their answer
- write-back into `saved_resumes` — replacing the right line of free text without corrupting the rest, which is the genuinely hard part
- the same for `saved_cover_letters` when the field appears there
- a "vital fields only" rule covering experience and education entries, which the site doesn't currently model as fields at all
- Back Office sync status per resume

Two things in there I'd want to settle before writing code, because guessing wrong means rewriting it:

**The resume is free text, not structured data.** Changing "the name" means rewriting the first line. Changing "the summary" means finding the SUMMARY section and replacing its body without disturbing the headings around it. That's doable — `site-fields.js` already *reads* those — but writing back is a different risk profile: a bad edit corrupts the document they apply to jobs with. I'd want that write to be surgical and reversible.

**C partly contradicts the rule you set two rounds ago.** Option B was "edit = detach, the site owns it." C says "after an edit, offer to push it to the resume instead." Those coexist — Yes syncs, No detaches — but it means the *first* edit of every vital field now asks a question, in a flow whose whole premise is not asking questions. Worth being deliberate about.

---

## 5. Questions

### Q1 — Should experience and education entries really be editable inline?

C lists *"individual experience entries (company, title, dates, description)"* as vital fields. The site currently renders the résumé as **one block** — it doesn't model individual entries as editable fields at all.

Making them editable is a substantial change to the document model, not a small addition to C.

**My recommendation: ship C for name, headline, location, summary and skills first** — the fields that already exist as fields — and treat per-entry experience editing as its own piece of work.

### Q2 — Does "No, keep it on my site only" need to be sticky across sessions?

Your spec says ask again in a later session. That's what I'd build. But someone who has deliberately made their site's headline punchier than their resume's will be asked every session, forever.

**My recommendation: ask again next session as you specified, but stop asking after they say No twice for the same field.** Say if you'd rather it ask indefinitely.

### Q3 — Which do you want next?

Given C is a multi-round piece of work, I'd suggest:

1. **The "moved" page** for renamed sites (small, and it's a real hole today)
2. **Back Office** — Feature A's site list plus Feature B's address display
3. **Feature C**, scoped to the fields that already exist

Or tell me to go straight at C and I will.

---

## 6. What I'd check on the live site

Feature A is server-verified but I haven't driven the multi-site flow in a browser end to end — the "try a different design" path in particular. If you click through it, watch for whether the confirm text makes it clear their current site survives.
