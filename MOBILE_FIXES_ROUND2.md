# Mobile Fixes — Round 2

All four fixed on branch **`claude/mobile-fixes-2`** → PR. Suite (21 files) green. Mobile-scoped; desktop untouched.

## 1 — Bottom tab bar overflow / tabs clipped at the top edge
**Root cause:** the Career Hub buttons I inject carry a "FREE" pill and had inline `display:flex; gap` set. The bottom bar hides button labels with `font-size:0` and shows them via `::after`, but the pill has its *own* font-size, so it survived — and together with the inline gap it made those buttons taller than the 56px bar, clipping the icon at the top.
**Fix:**
- Removed the redundant/conflicting inline styles from the injected buttons (`career-hub.js`) so the mobile bar's own column layout applies cleanly.
- Hid the FREE pill inside the nav on mobile (`.sidebar-btn .ch-pill { display:none }`).
- Made the bar a clean horizontal scroller with **snap points** (`scroll-snap-type: x proximity` + `scroll-snap-align: center`) so every tab lands fully in view — none half-cut at an edge.

I kept all tabs (scrollable) rather than a "More" menu — lower risk and every label stays fully visible + tappable, which was the requirement. If you'd prefer a consolidated "Tools" / "More" overflow sheet instead, say so and I'll build it.

## 2 — Website Creator template page: bottom bar missing
**Root cause:** the template-selection page is `body.wb-picker`, and the full-screen editor shell (`.cv-shell`, z-index 200) sits over the fixed bottom nav (z-index 90), hiding it.
**Fix (mobile only):** on `body.wb-picker` the nav is raised above the shell (`z-index:250`), the gallery gets bottom padding so its last row clears the bar, and the editor's Save/Publish thumb bar is hidden there (nothing to save yet). Inside the actual editor (not the picker) the shell stays full-screen as before — so you can now leave the template page from the nav without the browser Back button.

## 3 — LinkedIn tab looked like the WebLink tab
Both used the generic 🔗. The LinkedIn tab now uses the real **LinkedIn "in" logo** (inline SVG, brand blue `#0A66C2`, scales with the icon size), so it's instantly distinct from the Resume Link tab.

## 4 — "Create a WebLink" falsely said "no resumes"
**Root cause:** `_createShareLink()` only looked at the **current Tailor output** (`getOutputText()`), which is empty unless you tailored something this session — so a user who *has* saved resumes but opened a fresh session was wrongly blocked. (`/api/assets/summary`, used by the Website Creator, was fine — this was a different, output-only check.)
**Fix:** when there's no current output, it now falls back to the user's **most recent saved resume** (via `/api/resumes`) and shares that. Only if there are genuinely no saved resumes *and* no output does it prompt to create one.

## Files
`public/career-hub.js`, `public/style.css`, `public/app.html`.

## Please verify on your phone
Visual/interaction fixes, no mobile browser here. Checks: (1) bottom bar — every tab fully visible, scrolls with snap, no top clipping; (2) open Website Creator → template page keeps the bottom nav; (3) LinkedIn tab shows the "in" logo, clearly different from Resume Link; (4) Create a WebLink with saved resumes → it builds the link instead of saying "no resumes".

One note on #2: the Website Creator is desktop-oriented (its editor canvas assumes a wide screen). This fix restores navigation on the mobile template page specifically; if you want the *editor itself* made mobile-friendly, that's a larger piece — flag it and I'll scope it.
