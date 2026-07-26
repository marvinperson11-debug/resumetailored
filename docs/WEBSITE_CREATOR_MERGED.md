# Merged — what's live, and four questions before the next phase

PR #270 is merged. `main` is at `4893f77`; Railway deploys from there.

---

## 1. What's now live

| | |
|---|---|
| **Default view** | Your finished site, full screen, one button. No sidebars, panels or toolbars. |
| **First open** | Auto-generates from your most recent resume — real name, role, location and summary, not template filler. |
| **Privacy** | Created **private**. `/site/<name>` is a genuine 404 until you press Publish. |
| **Saving** | No Save button. Edits persist a beat after you stop, and flush on Done Editing and on closing the tab. |
| **Looks** | Ten Vibes — five colour/gradient, five real CC0 photographs. One click re-skins whatever you already have. |
| **Phones** | Works. The desktop pop-up is gone; Customize opens the vibe picker instead of a drag canvas. |
| **Templates** | 12, up from 4 — now the invisible structures the generator picks from. |

Nine bugs went out with it, most of them pre-existing. The two you're most likely to notice:

- **The app's top nav was sitting on the editor's toolbar**, swallowing every click on Pages, Undo, Preview and **Publish**. That's likely a good part of why the editor felt broken.
- **`.toast` had no `pointer-events: none`.** While invisible it ate taps on anything beneath it — *anywhere in the dashboard* on a phone, not just in the Website Creator. Every bottom-anchored button was dead. Worth a quick check on other tabs while you're on your phone.

341 assertions across seven suites, all passing against the merged state.

---

## 2. A git hook fired after the merge — I did not act on it

The stop hook flagged `4893f77` as "unverified" and suggested `git commit --amend --reset-author`.

**That's a false positive and following it would have caused real damage.** `4893f77` is GitHub's own squash-merge commit: authored by *you* (`marvinperson11@gmail.com`), committed by `GitHub <noreply@github.com>`. It isn't one of mine — I had zero unpushed commits at that point.

Amending it would have rewritten the merge commit, re-attributed your authorship to me, and required a **force-push to `main`** to take effect. You told me earlier: *"Leave as-is. Don't force-push main."* That still stands.

The hook fires because my branch pointer happens to sit on a commit it didn't create. Nothing to fix. If it keeps firing on every merge it may be worth teaching it to skip commits whose committer is `noreply@github.com`.

---

## 3. Still yours — the one thing I can't do

Custom subdomains need two things I can't create from here:

1. A wildcard DNS record `*.resumetailored.com` → the Railway app
2. `*.resumetailored.com` added as a custom domain in Railway, so it issues a **wildcard TLS certificate**

Everything code-side is done and waiting behind one env var:

```
SITE_PUBLIC_HOST=resumetailored.com
```

Set it once those exist and every link, QR code, share sheet and canonical tag switches to `name.resumetailored.com` at once. Leave it unset and nothing changes. Steps are in `docs/RAILWAY_SETUP.md` §9.

**Don't set it before the DNS and TLS are live** — every site link would break.

---

## 4. Four questions before I build Phases 2 and 4

Only asking where a wrong guess means building the wrong thing.

### Q1 — When someone edits their name on the site, does the resume change?

This is the one I'd most like settled, because it's a fork not a detail.

Your item 1 says the site *"updates automatically when you update your resume."* That makes the resume the source of truth. But item 2 says *"click name → edit name"* — editing on the site directly.

If both are true, the next resume update silently overwrites whatever they typed on the site.

Three ways out:

| | Behaviour | Cost |
|---|---|---|
| **A. Resume wins** | Site fields are read-only where they come from the resume; clicking one offers "Edit in Resume Tailor" | Honest, but "click it to change it" stops being literally true |
| **B. Site wins once touched** | Editing a field on the site detaches it; resume updates stop touching that field | Matches the spec exactly. Needs a quiet "reconnect to my resume" escape |
| **C. Site is a free-form copy** | Generated once, never resynced | Simplest. Loses the "updates automatically" promise entirely |

**My recommendation: B.** It's what the spec literally describes, and the detach is invisible until it matters.

### Q2 — What does "Pick Cover Letter" put on the page?

The bottom strip offers it, but a cover letter is addressed to one company. On a public page that reads oddly to every other recruiter.

Options: a **download button**, a **section rendered inline**, or **drop it** from the strip.

**My recommendation: a download button** ("Read my cover letter"), so it's available without being addressed to the wrong reader.

### Q3 — Should the guided flow run on first visit, or only on Customize?

Your item 4 describes a conversation: *Looks good? → Pick your vibe → Add a photo? → … → Publish!*

Running it automatically on first open gets someone to "proud in under 3 minutes". But it also means the very first thing they see is a question, not their website — which cuts against item 1.

**My recommendation: show the site first, and put "Looks good?" in the strip as the first step *after* they tap Customize.** They see their site before anything asks them anything.

### Q4 — "Add Music": autoplay or not?

Flagged before, still open. Audio starting by itself on a page a recruiter opens at their desk is the fastest way to get a tab closed.

**My recommendation: muted by default with a visible play control**, labelled "Add background music (visitors press play)". Say the word if you want true autoplay and I'll build that instead.

---

## 5. What I'd build next

In this order, unless you redirect me:

1. **Phase 2 — click-it-to-change-it.** Name, headline, photo, section move/delete via floating controls. Gated on **Q1**.
2. **Phase 4 — the bottom strip.** One question at a time, skip and back on every step. Gated on **Q2** and **Q3**.
3. **Phase 5 remainder — the inline ↩️ Undo** that appears where you acted and fades. The undo engine already exists; this is surfacing it.
4. **Phase 6 — 💬 Not sure?**, jumping straight to the right control.

Answer any subset and I'll start there. If you'd rather click through first and tell me what actually feels wrong, that's worth more than my ordering.
