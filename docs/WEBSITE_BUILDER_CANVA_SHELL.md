# Website Builder — Canva-style editor shell

Built from your screenshot. Two things I couldn't use, then what I did.

## What I couldn't access

**The Canva link.** `canva.com/design/DAHQbQ7EZ34/.../edit` is a **private design edit URL** — it needs your Canva login, so I can't open it. Your screenshot was enough: I could read the entire layout from it.

**The repo.** `add_repo` for `JCodesMore/ai-website-cloner-template` returned **"requires approval"** — you'd need to approve the prompt. I didn't block on it, and honestly I don't think it's the right tool here: an "AI website cloner" takes a URL and reproduces *that site*. What you actually asked for is a **Canva-style editor UI**, which is a layout/interaction problem in your own codebase, not a cloning problem. If you still want me to look at it, approve the prompt and I will — but I'd rather tell you it's probably irrelevant than wire in a third-party dependency of unknown provenance on faith, in a product that charges money.

## What I built

Restructured the editor to match the Canva Website editor layout, in your indigo→violet colours:

| Canva | Yours |
|---|---|
| Blue gradient top bar, Preview / Publish website / Share | **Indigo→violet top bar**: logo, Pages, undo/redo, doc title, desktop/mobile toggle, **Preview**, **Publish website** |
| Left icon rail (Templates, Elements, Text, Brand, Uploads, Tools, Projects) | **Left icon rail**: Templates, Elements, Text, Brand, Uploads, Content |
| "Describe your ideal design" + Generate/Search + thumbnail grid | **"Describe your ideal site"** live-filter search, category chips, two-up thumbnail grid |
| Dark canvas backdrop, page centred with shadow | **Dark stage**, canvas centred with drop shadow |
| "+ Add page" under the canvas | **"+ Add section"** under the canvas |
| Bottom bar: zoom slider 51%, Pages 1/1 | **Bottom bar**: Edit toggle, **zoom slider 25–150%** with live %, **Pages n / m** |

**Panel behaviour** (each rail icon swaps the panel, as in Canva):
- **Templates** — search, categories, thumbnails
- **Elements** — the 21-entry palette + Add section
- **Text** — click-to-place heading / subheading / paragraph, shown at relative sizes
- **Brand** — primary / accent / page background / text colour pickers that recolour the **whole site** (through the store, so undo covers it)
- **Uploads** — media library as a thumbnail grid; **click an asset to place it** as the right element type, plus the storage meter
- **Content** — resume & cover-letter pickers, the three video entry points, site address, publish status, QR + analytics

## What this did *not* change

The document model, renderer, store, undo/redo and every test are untouched. This is **chrome only** — and the render snapshots prove it: `link.html` **and** `site-doc.html` are both still byte-identical, meaning what visitors are served didn't move at all.

```
doc-store        30/30 PASS
page-ops         51/51 PASS
element-library  29/29 PASS
preview-parity   23/23 PASS
render-snapshot  link.html + site-doc.html byte-identical
```

## Honest gaps vs. Canva

Worth naming rather than letting you discover them:

1. **No AI "Generate" yet.** Canva's search box generates a design from a prompt. Mine **filters existing templates**. Real generation means an AI call that emits a site document — very doable (the document format is well-defined and validated), but it's a feature, not chrome.
2. **Still 4 templates.** You said "create different similar templates" — I'd like to build more, but I want your read on whether the *editor* is right first, since templates are cheap to add and expensive to redo.
3. **Not yet merged**, so it's not on Railway. Say the word and I'll ship it so you can actually use it.

## What I need

You've told me twice now that it isn't right, and both times the gap was something I couldn't see. So, concretely:

- **Is this the right shell?** If yes, I'll ship it and then go deep on templates + AI generate.
- **Was it the *look* of the templates** that bothered you, rather than the editor? That's a different fix — better-designed templates, not a new UI.
- **Do you want the AI "Generate" box to actually generate?** That's the one genuinely missing Canva capability, and I can build it.

Tell me which and I'll go straight at it.
