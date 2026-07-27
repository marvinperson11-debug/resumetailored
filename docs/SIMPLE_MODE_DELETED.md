# Simple mode is deleted — and it was hiding a real bug

**Step 1 of four.** Boring and invisible, as promised — except that taking the
code out exposed something that mattered.

`public/app.html`: **1,443 lines removed, 68 added.** 638 assertions green, plus
a browser pass at 1440px and 390px.

---

## 1. What went

Simple mode was a second, competing product: your finished site full screen
behind one button, with its own guided strip, help panel, vibes picker and
inline-edit chips. It was already unrouted — you could not reach it — but the
code was still there, which is why you kept seeing bits of it.

| | lines |
|---|---|
| The full-screen view's markup (`#smView`, bar, strip, help panel, busy/empty states) | 64 |
| Its stylesheet (`.sm-*`, 229 lines) | 230 |
| 52 functions — boot, render, vibes, guided strip, help panel, photo/voice pickers, inline-edit chips, undo chips, sync prompts | 1,010 |
| 82 translation keys × 2 languages, now unreferenced | 139 |

Checked as **absence of the source**, not absence of a route. Leaving it on disk
behind a closed door is exactly what made it a second product in the first
place, and the tests now fail if any `sm`-prefixed function, `.sm-` rule or
`#smView` node comes back.

## 2. What stayed, renamed

Five things were load-bearing and are now on the `wc` prefix with the rest of
the Website Creator:

| was | is | what it does |
|---|---|---|
| `smSave` / `smQueueSave` / `smFlushSave` | `wcSaveSite` / `wcQueueSave` / `wcFlushSave` | the one save path — still never publishes by itself |
| `smResumeText` | `wcResumeText` | which resume the site shows |
| `smChangeAddress` | `wcChangeAddress` | changing your web address |
| `smDoneEditing` | `wcDoneEditing` | ✓ Done Editing |
| `smPublished` / `smSiteUrl` | `wcPublished` / `wcSiteUrl` | is it live, and where |

**Done Editing** used to drop you into the full-screen view. It now saves and
takes you to the Back Office, where all your sites are listed.

---

## 3. The bug this uncovered

**Autosave was not running.**

The subscription that saves your work lived inside simple mode's boot:

```js
edStore.subscribe(() => { wcDoc = edStore.getDoc(); smRenderSite(); smQueueSave(); });
```

When the rail editor became the only way in, that boot stopped running — so
nothing subscribed the save path at all. The editor's own subscription redrew
the canvas and the inspector and saved nothing:

```js
edStore.subscribe(() => { edSyncButtons(); edRenderCanvas(); edRenderOverlay(); edRenderInspector(); });
```

Everything you did in the editor lived in memory only. It survived if you
pressed **Publish**; it did not survive leaving the tab.

Nothing complained, because every individual piece worked. The save function was
correct, the store was correct, the editor was correct — the wire between two of
them ran through a third thing that no longer existed.

Autosave now belongs to the editor, where it should always have been, and there
is a test that fails if the subscription ever loses it again.

## 4. And one on the phone

Two CSS rules disagreed about the property inspector:

```css
@media (max-width: 780px) { .cv-inspector { display: none !important; } }   /* older */
@media (max-width: 820px) { .cv-inspector { position: absolute; right: 0; … } }  /* newer */
```

Both apply at 390px, and `!important` wins. So the phone got all the layout work
that floats the inspector over the canvas, and none of the panel: you could
select an element, its controls were built, and nothing appeared. The hide rule
is gone.

I found this because the browser check runs at 390px as well as 1440px — it
passed at desktop width and failed at phone width in the same run.

---

## 5. How this was verified

**Source tests: 638 assertions, 0 failures.**

**A browser pass, at both widths** — `test/browser/editor.js`, kept in the repo
and run by hand (it needs Chromium, so it is not in the `test/*.js` loop):

| | 1440px | 390px |
|---|---|---|
| No simple-mode node anywhere in the DOM | ✅ | ✅ |
| The gallery is what you land on | ✅ | ✅ |
| **Use** opens the editor, canvas not blank | ✅ | ✅ |
| Selecting shows the inspector **on screen** | ✅ | ✅ |
| An edit reaches `POST /api/personal-site` by itself | ✅ | ✅ |
| Done Editing lands in the Back Office | ✅ | ✅ |
| No uncaught JavaScript | ✅ | ✅ |

Plus: after all of that, the edit was **read back out of the database**.

That harness measures rendered geometry, DOM presence and actual network
traffic. It does not read a single internal variable — which is the change I
said I would make after `edDevice`, after the `hidden` property, and after the
clean-cache run that "passed" while the live site was broken.

## 6. About the deletion method

The last attempt at a bulk deletion in this file cut 7,935 lines because a
script scanned forward for a delimiter. This one asserts the **exact text of
both boundary lines** of every range before cutting, writes nothing until all
four cuts have matched, and fails outright if the total removed falls outside
1,000–2,500 lines. The translation keys were removed by parsing the dictionary
before and after and proving that the only difference was the 82 dead keys and
that no surviving value changed.

---

## 7. Next

Step 2 — **type in the box** — is next, then the gear, then adding into a box.
Each deploys separately, as you asked.

One thing I want to confirm before Step 3 rather than guess at. Your Q3 said
*"Stop at Steps 1–3 for now"* and then listed *"forms, maps, embeds,
animations"* — those were Step **4** in my plan, not 1–3. So: do you want the
first three (type / gear / add photo-video-voice-text) and then a pause, or did
you mean to pull some of Step 4 forward? I will keep building 1–3 either way.
