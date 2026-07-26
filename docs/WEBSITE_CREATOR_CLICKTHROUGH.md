# Click-through fixes — 13 of 14 done, and one I can't do

Pushed to branch `claude/resumetailored-pricing-plan-iwy6un`. 435 assertions green.

---

## 0. First: you were right, I was wrong

I kept listing the wildcard DNS/TLS as outstanding. **It's live.** I checked from here rather than assume:

```
testuser.resumetailored.com  →  69.46.46.16 (nxoh9dmq.up.railway.app)
certificate                  →  CN = *.resumetailored.com, verifies OK
https://testuser.…/          →  404  (the middleware correctly saying "no such site")
```

Apologies for repeating a stale caveat several rounds running.

### But I can't set a Railway environment variable

I have no Railway dashboard access — that's outside what I can reach from here. So rather than leave you a manual step, **I removed the need for the variable.**

The URL shape is now derived from **the host the request arrives on**:

| Served from | Site URL |
|---|---|
| `resumetailored.com` | `https://<name>.resumetailored.com` |
| a Railway preview / localhost | `/site/<name>` |

That's better than a deploy-wide flag anyway: a preview URL has no wildcard record and no certificate, so handing those visitors a subdomain link would break every one of them. `SITE_PUBLIC_HOST` still overrides if you ever want to point it elsewhere.

**Nothing for you to set. It works on the next deploy.**

---

## 1. Your fourteen

| # | | Status |
|---|---|---|
| 1 | Existing site → straight in; none → picker first | ✅ |
| 2 | Mobile header text cut off | ✅ |
| 3 | Remove right sidebar | ✅ |
| 4 | Left panels collapsed, one at a time | ✅ |
| 5 | Sidebar collapse arrow | ✅ |
| 6 | Public view: sidebar hidden, minimal header | ✅ |
| 7 | Edit mode: rail, device toggle, Preview, Publish | ✅ |
| 8 | "Click anything to edit" hint | ✅ |
| 9 | Template cards — no descriptions | ✅ |
| 10 | Remove "+ Add section" | ✅ |
| 11 | New users see templates only | ✅ |
| 12 | LinkedIn button lit on wrong pages | ✅ |
| 13 | Undo/redo chips bigger on mobile | ✅ |
| 14 | Social / website links | ✅ |

Each verified in a browser, not just asserted:

```
NEW USER  picker: true | sidebar: false | tpl cards: 12 | blurbs: 0 | addsection: 0
AFTER PICK site view: true | picker gone
PUBLIC    sidebar: false | shell: false | help btn: false
EDIT      help btn: true | hint: true | right panel: false
RETURNING site view: true (straight in, no picker)
PANELS    default open: false | one open at a time | same tab closes
RAIL      collapses
LINKEDIN  lit on tailor: false | lit on linkedin: true
MOBILE    bar overflow: ok
```

---

## 2. Item 12 — what was actually wrong

`.sidebar-btn-linkedin` carried a blue background, border and colour **unconditionally**, all with `!important`. So it looked selected on every page in the app, and the real `.active` gradient on top of it was indistinguishable at a glance.

It wasn't the active *logic* that was broken — it was that the button was permanently pre-lit. The standing highlight is gone; only `.active` is lit now.

---

## 3. Item 14 — links

The renderer has always drawn a `social` element. Until now the only way to fill it was the advanced editor, which a beginner never opens.

**"I want to add my links"** is now in the 💬 Not sure? panel. One line per link:

```
LinkedIn: linkedin.com/in/you
Website: yoursite.com
Email: you@example.com
```

A bare address becomes a real link (`https://` added, or `mailto:` when it looks like an email). Up to ten. They land in the existing `social` element, or a new one at the foot of the page.

---

## 4. Two bugs of my own, both found by driving it

Neither would have been caught by the test suite — both were about *flow*, not wiring.

**Picking a template didn't create the site.** It only set the document in memory, so the boot check found no site and bounced straight back to the picker. An infinite loop of choosing. The chosen template now drives generation — which also means your choice is actually honoured rather than silently replaced with the default.

**The chrome sync cleared a flag it didn't own.** It reset `wb-picker` on every call, racing the picker that had just opened and putting the app sidebar back up underneath it.

---

## 5. What I'd want you to check

The layout items are the ones I'm least able to judge from here, because "cut off", "too small" and "barely visible" are things you saw and I can only approximate:

1. **Mobile header** — I made the bar wrap to two rows and pushed the page down to match. Measured as non-clipping at 390px, but you'll know in a second whether it *reads* right.
2. **The rail collapse arrow** — sits on the left edge of the editor, vertically centred. Easy to miss if it's in the wrong place.
3. **Chips on mobile** — bigger, indigo, with a glow ring. Say if they're still hard to spot.

---

## 6. One question

### Should the picker be reachable again later?

Right now the template picker is a **first-run only** screen — once you have a site, you never see it again, and the way to change how things look is Vibes.

That's what item 11 asks for. But it means someone who picks Minimal and later wants the Developer *structure* has no route back except the advanced editor.

**My recommendation: leave it.** Vibes cover "different look", and re-picking a template would throw away everything they'd edited. But if you'd rather have a "start over with a different template" escape, it's small — and it should warn them what it costs.
