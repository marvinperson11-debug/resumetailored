# Website Builder v2 — V5 skeleton shipped (multi-page management)

Your three answers are locked in:

1. **Merge commit** — left as-is. No force-push to `main`. ✓
2. **Fixes** — quick follow-up PR if something's broken, otherwise batched into V5. Noted; nothing to fix yet since you haven't clicked through.
3. **V5 scope** — built exactly as specified: add / rename / reorder / duplicate / delete / set home / per-page SEO.

And per "start the skeleton but don't build deep": I built a **fully tested data layer and a working manager UI**, and stopped short of polish (no drag-reorder of pages, no page thumbnails, no bulk ops). Those are cheap to add once you've told me how the editor actually feels.

## The data layer (where multi-page usually rots)

All page operations are **pure mutators** in `site-doc-store.js`, so they're unit-tested without a browser. The invariants live in the data layer, not the UI — which means the UI can't violate them:

- **Exactly one home page**, always. Setting home clears the others.
- **Deleting the home page reassigns home** to another page.
- **The last page can't be deleted** — a site always has something to render.
- **A duplicated page** is never home, gets a unique slug, and gets **fresh ids for every section and element**, so nothing aliases the original (I tested that mutating the copy doesn't touch the source).
- **Renaming a page deliberately does *not* change its slug** — published URLs stay stable when you retitle something.
- **Slugs** are URL-safe, length-capped, unique within the document, and avoid reserved words (`api`, `media`, `site`, …).

## The manager UI

Editor toolbar → **⧉ Pages**: rename inline, edit the URL slug, **set home**, reorder ↑/↓, **duplicate**, **delete** (disabled at one page), **per-page SEO title/description**, and jump straight to editing any page.

Everything routes through the store, so **all of it is undoable** — and typing a name or SEO field coalesces into a single undo step rather than one per keystroke.

## Gap found and fixed

`addPage` created a **completely blank** page. That meant a newly added page rendered with **no navigation at all** — a visitor landing on `/site/you/about` had no way back to the rest of the site. I only caught it because an end-to-end assertion on nav links failed.

New pages now seed a **nav element plus a heading** using the page name (both editable or deletable). Small fix, but it's the difference between "added a page" and "added a dead end."

## Verification

```
test/doc-store.js        30/30 PASS
test/page-ops.js         51/51 PASS   (new)
test/element-library.js  29/29 PASS
test/preview-parity.js   18/18 PASS
test/render-snapshot.js  link.html byte-identical
```

Plus an end-to-end run: build a multi-page site through the page ops → publish → confirm `/site/:sub`, `/site/:sub/:page`, per-page SEO titles, cross-page nav links, and a 404 on an unknown slug.

## Where the rebuild stands

- ✅ V1 document model + single renderer + preview parity
- ✅ V2 template gallery, legacy creator deleted
- ✅ V3a editor shell — immutable store, undo/redo, selection, drag/resize
- ✅ V4 Add Elements panel + full element library
- ✅ **V5 multi-page management** (skeleton — deliberately not deep)
- ⏭️ V6 per-element mobile overrides · V7 polish

## What I need from you

**Your click-through.** V6 and V7 are both polish-shaped, and I'd rather spend that effort on what actually bothered you than on what I guessed. Specifically:

- Does a **drag feel smooth**, or does the canvas lag noticeably behind the outline?
- Is the **10px snap grid** helping or fighting you?
- Do the **resize handles** feel the right size?
- Anything in the **template gallery** or **page manager** that's confusing?

This V5 work is on the branch and **not merged** — say the word and I'll ship it, or I'll fold your fixes in first and merge them together.
