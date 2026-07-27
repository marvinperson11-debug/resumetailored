# Editing inside the box: what exists, what's missing, and the order I'd build it

Two things in your message: **delete simple mode** (approved, and it's next), and **make every box fully editable** with a gear icon. The second is much bigger than it looks, so I want to agree the shape before I start rather than guess again.

---

## 1. What already exists — more than the screenshot suggests

Your screenshot shows selection working: the NAV badge, the outline, the move cursor, the resize handle. That machinery is real and I do not need to rebuild it.

| Already built | State |
|---|---|
| Element selection on the canvas | ✅ works (`edSelect`) |
| Drag to move, handle to resize | ✅ works |
| **A property inspector for the selected element** | ✅ **exists** (`edRenderInspector`) — but the panel is hidden, so you have never seen it |
| Element palette (Elements / Text rail tabs) | ✅ adds new elements |
| Uploads panel, brand/theme panel | ✅ exist |

**The inspector is the important one.** There is already code that, for a selected element, renders controls for its properties. It is sitting behind `#wcEdInspector`, which is `hidden`. So "a gear that opens the tools for this box" is substantially **surfacing something that exists**, not writing it from nothing.

## 2. What is genuinely missing

| Missing | Size |
|---|---|
| **Click a text box and type in it** | Medium — the canvas is a rendered preview, not a live document, so typing needs an editable overlay positioned over the element |
| **A gear on the selected element** that opens the inspector anchored there | Small, once the inspector is visible |
| **Colour control for text** (your "change the colour of my name") | Small — it is a property like any other |
| Per-element font, size, weight, alignment | Small each |
| **Add anything into any box** — photo, video, voiceover, text | Medium; the element types exist, the "insert into this box" flow does not |
| Layering, duplicate, delete, spacing, background per element | Small each |

---

## 3. The order I would build it

Each step is usable on its own, and I would rather ship four working things than one large half-finished one.

**Step 1 — Type in the box.** Click a text element, a cursor appears, you type, it saves. This is the thing you actually asked for first and the thing whose absence makes the editor feel broken.

**Step 2 — The gear.** A ⚙ on the selected element opens the inspector as a panel anchored to it: colour, size, font, weight, alignment, spacing, duplicate, delete, layer order.

**Step 3 — Add into a box.** From the same gear: photo, video, voice clip, text. The element types and the upload plumbing already exist; this is the insertion flow on top of them.

**Step 4 — The rest.** Backgrounds, borders, radius, links, animation, section controls.

---

## 4. Before I start — three questions

### Q1. Should the gear open the existing inspector, or a new floating panel?

- **Surface the existing inspector**, anchored beside the element. Faster, and everything it already knows how to edit works immediately.
- **A new floating panel** designed for this. Nicer, but it rebuilds what exists and takes longer to reach parity.

**My recommendation: surface what exists first.** You would get the property controls this week rather than next, and a floating redesign later is then cosmetic rather than functional.

### Q2. Typing — inline on the canvas, or a field in the panel?

The canvas is a *rendered preview* inside an iframe, not a live editable document. That is why clicking does nothing today.

- **Inline** — a text cursor directly on the canvas, WYSIWYG. What you asked for and what Canva does. Needs an editable layer positioned exactly over the element, which is the fiddly part.
- **In the gear panel** — click the box, type in a field, canvas updates live. Much simpler, works on phones immediately, but is not "click and type".

**My recommendation: inline, and I will do the work to position it properly.** It is what you asked for and the halfway version would not satisfy the thing you are describing.

### Q3. "Any tool a website creation platform could use" — where do I stop?

That is genuinely unbounded, and if I guess I will build things you did not want while missing things you did. Steps 1–3 above cover everything you named explicitly: type, colour, size, add elements, photo, video, voiceover, upload.

**Is there anything beyond that list you specifically want?** Forms, maps, social embeds, buttons/links, animations, custom fonts, code blocks?

---

## 5. What I am doing next, unless you redirect me

1. **Delete simple mode** — approved. Small verified passes, exact-text matches, hard size gate at ~2,500 lines after the attempt that cut 7,935. This is boring and invisible to you, and it clears the way.
2. **Step 1: type in the box.**

I will not do 3 and 4 without your answers to §4, because that is where guessing gets expensive.

---

## 6. One honest note on pace

Steps 1–4 are not one deploy. Step 1 alone is a real piece of work, because making an iframe-rendered canvas directly editable is the hard part of every builder of this kind.

I would rather tell you that now than deliver a quarter of it and describe it as done — which is close to what happened with the template bug, and cost you three rounds of testing.
