# Homepage additions round 2 (`public/index.html`)

Committed as `9bac5e1` on `claude/resumetailored-bento-redesign-xzkv9z` (PR #424).
Message: `fix(homepage): employer tiers strip, whatsnew padding, headline verify`.
Bento file untouched. Netlify preview (rebuilds from this push): https://deploy-preview-424--mellow-macaron-463353.netlify.app/

---

## 1. Employer tiers strip ✅

Added a **compact one-line-per-tier strip** below the pricing comparison table (inside the
`#pricing` section, after the job-seeker Free/Pro/Lifetime cards), styled in the existing
gold/cream palette — navy `--surface` card, gold `--accent-2` prices/links, cream `--ink`
names, gold hairline dividers. No large cards, and it does **not** recreate the removed
"Clear terms. No theatre." section.

```
FOR EMPLOYERS                              Hiring plans · see full details →
─────────────────────────────────────────────────────────────────────────
Employer Portal   $49/mo   AI candidate screening & custom landing pages     →
Scale             $99/mo   Collaboration platform plus any five modules       →
Corporate        $299/mo   Full employer ecosystem, Recruitment Decoder…      →
```

- Each row links to `/for-employers`.
- Desktop: 4-column grid (name · price · description · arrow).
- Mobile (≤640px): collapses to name+price on top, description+arrow below — still one
  compact block, no big cards.

## 2. What's New mobile padding ✅

`#whats-new` carries an inline `padding:60px 0`, which a stylesheet rule can't override
without `!important`. Added to the existing `@media (max-width:680px)` block:

```css
#whats-new { padding: 44px 0 !important; }
```

Mobile padding is now 44px (matching the rest of the page); desktop stays 60px.

## 3. Headline spacing — verified, no change ✅

Fetched the **raw HTML served by the Netlify deploy preview** and inspected the hero `<h1>`:

```html
<h1><span class="word-animate" …>Your</span>&nbsp;<span …>resume,</span><br />
    <span …>perfectly</span>&nbsp;<span …>tailored</span><br />
    <span …>to</span>&nbsp;<span …>every</span>&nbsp;<span …>job.</span></h1>
```

Every word is separated by a real `&nbsp;`, so it renders **"Your resume, perfectly tailored
to every job."** with correct spacing. No run-together in what the server actually sends — so
per your instruction, I left it alone. (If you ever still see it mashed, it's a cached view;
a hard refresh / cache-clear resolves it.)

---

## Verification
- Tag balance unchanged by my edit (section 16/15 matches HEAD's pre-existing off-by-one; div
  961/961, `<a>` 95/95 balanced).
- Employer strip: 3 rows, CSS present, prices $49/$99/$299 present.
- `#whats-new` mobile override present.
- Bento file (`public/index-bento.html`) not touched.

No open questions — all three items are done.
