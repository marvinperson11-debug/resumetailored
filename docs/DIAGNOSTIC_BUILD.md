# Diagnostic build deployed. Here is what to send me.

`main` is at **`64396fc`** — Railway is building it. **No behaviour change, no fix attempted.** 630 assertions green.

Your detail settled one thing immediately: *first click, every template, fresh browser load*. That rules out the rate limit I fixed last round. It was a real latent bug, but it was not yours.

---

## 1. The thing your spec did not cover, and which I think matters most

You asked me to instrument the request. I did — but the request is probably not where this fails.

**One `try/catch` wrapped the fetch AND the four things that run after it:** `fillFromResume`, `wcRenderTplGrid`, `wcEnsureSite`, `edInit`. A crash in any of those produced the *identical* toast as a network error.

So "Cannot load this template" has never meant loading failed. It means *something in this function threw* — and five of the six candidates run after the response arrives successfully.

The handler now tracks a **stage**, so the toast names which one.

---

## 2. What you will see

### The toast

```
Cannot load template
Stage: fillFromResume
Status: 200
Error: TypeError: Cannot read properties of undefined
Template: executive
```

`Stage` is the new part and the one I care about most. If it says `fetch` or `http-4xx`, it is the request. If it says anything after `parse`, the request **succeeded** and the crash is in our own code.

A request that never sends says **"Request did not send — check console"** explicitly.

### The console

Before the request:

```
[USE] Clicked template: executive
[USE] Current site: tailored
[USE] In picker: true
[USE] API URL: https://resumetailored.com/api/site-templates/executive
[USE] Method: GET
[USE] Token present: true | header: Bearer 3f2a1c…
[USE] SiteFields loaded: true | SiteDocStore: true
```

After: status, statusText, and the raw response body. On failure: stage, error name, message and full stack.

The `SiteFields loaded` line is deliberate — if that says **false**, a script failed to load in production and everything else follows from it.

---

## 3. Your four checks, verified in the code

| You asked | Answer |
|---|---|
| Same endpoint path in production? | Yes — `/api/site-templates/:id`, matching `app.get('/api/site-templates/:id')` |
| Correct method? | GET on both sides |
| Auth token sent? | Yes — `authHeaders()` sets `Authorization: Bearer …` |
| Is `templateId` populated? | Yes — baked into each tile's `onclick` at render time |
| Does it check `response.ok`? | Yes. Every non-2xx now reports its status rather than one generic message |
| Any `preventDefault`/`stopPropagation`? | None. Plain `onclick`, `type="button"` |

So the request shape is not the problem. That is exactly why I separated the post-fetch stages.

---

## 4. What to send back

1. The **toast** — the `Stage:` line especially.
2. The **console** from `[USE] Clicked` down to the stack trace.
3. Whether `SiteFields loaded` says true or false.

On iOS Safari the console is Settings → Safari → Advanced → Web Inspector, then connect to a Mac. If that is awkward, **the toast alone is probably enough** — `Stage` plus `Status` narrows it to one of six places.

---

## 5. Two guesses, so you know what I am watching for

Not fixing either yet, as instructed:

- **`Stage: fillFromResume`** — most likely. It runs on the template document using your resume text, and it is the newest code in that path.
- **`Stage: wcEnsureSite` or `enterEditor`** — the picker path is new in the last PR, and your existing site is involved.

If it comes back `Stage: fetch` or `http-401`, I am wrong about all of this and it is auth or routing — which the status code will say outright.
