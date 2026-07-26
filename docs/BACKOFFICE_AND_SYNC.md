# Steps 2 and 3 done — Back Office rebuilt, and the resume sync built to refuse

Branch `claude/resumetailored-pricing-plan-iwy6un`. **579 assertions, all green.**

---

## 1. Back Office — every website, not just the current one

Trying a different template makes **another site**, not a replacement. So a Back Office showing one row was hiding most of what people had, including drafts they meant to come back to.

It's now a card per site: a live thumbnail, the template name, when it was last edited, its address, and Edit / Publish / Delete. Exactly one card can say **Published**, and above them all sits the current web address from Feature B.

The thumbnail is a scaled render of **their** site, not the template's sample person. Twelve cards all showing "Alex Morgan" would be twelve identical rectangles, which is the one thing a thumbnail exists to prevent.

### Two bugs that only existed once a user could have several sites

| | What would have happened |
|---|---|
| **`PATCH /api/personal-site` updated every row for the email** | Pressing Publish on one card would have put **all of their private drafts on the internet at once** |
| **Edit raced two page loads** | `showTab('website')` calls the loader itself, so passing the subdomain as an argument fired a second, argument-less load that won — Edit opened the *current* site whichever card you pressed |

Both were invisible before multi-site and would have been very visible after.

I also fixed the change-address prompt, which derived the URL shape from a regex matching any host with a dot — so a path-based address was described to the user as a subdomain their site does not have.

**+33 assertions.**

---

## 2. Feature C — and the thing I want you to actually read

You said: **never best-effort append. Option A.** That decision shaped the whole module rather than being a branch inside it.

`resume-writeback.js` is the only code in the product that writes to `saved_resumes`. Its rule:

> **If the field cannot be located with certainty, write nothing.**

"Certainty" is not a confidence score. It means the text sitting at the located position is **exactly** what the site showed before the edit. If your resume has been changed since, or was never in a shape we could read, the anchor doesn't match and the write is refused — the document comes back byte-identical and the user is told plainly:

> *We couldn't update your resume automatically — your website is updated, but your saved resume stayed the same.*

The useful consequence: **a resume of a shape we never anticipated fails to match rather than getting mangled.** That is why this is safe on documents I have never seen.

### Writes are all-or-nothing

The site's headline is `Staff Engineer · Seattle, WA` — one line on the page, **two facts in two different places** in the resume. Writing the job title and refusing the city would leave your resume saying something you never approved. Either both land or neither does.

And only the half that *changed* is written. Moving city does not rewrite a job title you never touched.

### When it asks

Once, on the canvas, beside the thing you just changed. Not a browser dialog — this arrives in the middle of an ordinary edit, in a flow whose entire premise is not asking questions, so it has to be ignorable.

It does **not** ask when: the resume already says it, you've declined that field twice, or you've already been asked this session.

### One judgement call I made, and why

You said auto-dismiss after 10s defaults to No. It does — for that edit. But **I do not count a timeout toward the two-No limit.**

Counting silence as a refusal takes the feature away from someone who was reading the question when it disappeared. Two chances should cost two decisions. Say the word and I'll count them.

### What it covers — and what it can't

| Field | Where it goes | Refuses when |
|---|---|---|
| **Name** | first non-empty line | that line isn't what the site had |
| **Location** | segment of the contact line | it appears twice — no way to know which |
| **Role** | title prefix of the first EXPERIENCE entry | no EXPERIENCE section, or title differs |
| **Summary** | body under SUMMARY / PROFILE / OBJECTIVE / ABOUT | no such heading |

**Skills is not in that list, and I want to be straight about why.** Your Q1 answer said "only the fields that already exist as editable fields: name, headline, location, summary, and skills." Those two halves disagree — skills isn't an editable field on the site. It's rendered as ordinary paragraphs that differ per template and carry no field tag, so there is no "skills edit" to sync back. Making it one is its own piece of work, the same as per-entry experience. Everything else in your list is built.

**Back Office shows Synced / Out of sync per resume** — but only for the resume the site was actually built from. A green badge on a resume the site has never read would be a claim I haven't earned, so those rows show nothing.

**+72 assertions across two new suites.** Most of them are about refusing: the easy half is replacing line one, and the half that matters is every resume shape where it must decline.

---

## 3. What I checked in a real browser

Not just tests — I drove both features in Chromium:

- Three sites listed, one Published badge, thumbnails filling their cards, Publish moving the badge and taking the previous site down, Edit opening the site whose card was pressed (that's how I found the race).
- Inline edit → popup appears anchored to the field → **Yes** rewrites the resume's first line and nothing else → the field re-attaches to the resume → **No** twice → never asked a third time, resume untouched throughout.

One layout fix came out of that: the Undo chip and the sync card both anchor to the edited element, so the chip was sitting on top of the question. The card now stacks below it.

---

## 4. Worth a click when this deploys

The multi-site Publish path. It is the one flow where a mistake is publicly visible — publishing one card should take your live site down and put this one up, with nothing else changing state.
