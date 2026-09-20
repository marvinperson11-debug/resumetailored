# Training Library Expansion — Report

**Merged to `main`:** commit `650041b` (PR [#532](https://github.com/marvinperson11-debug/resumetailored/pull/532))
**Checks:** `tsc` ✅ · `next lint` ✅ · `next build` ✅ (both routes compiled)
**Files:** `lib/training-library-seed.ts` (content) and `lib/training-library.ts` (seed + search). No SQL/migration change.

---

## To apply
Re-open **`/api/employer/seed-library?do=1`** once, signed in as admin. The seed now **upserts**, so the 64 new items insert and the original 18 refresh into their new verticals. Expect `total: 82`.

---

## 1. 18 → 82 items, by industry vertical
The verticals are the category filter chips:

| Vertical | Items |
|---|---|
| Manufacturing | 15 |
| Hospitality & Food Service | 10 |
| Cleaning & Janitorial | 9 |
| Healthcare | 9 |
| Construction | 9 |
| Emergency Preparedness | 9 |
| Office & Ergonomics | 8 |
| Warehouse & Logistics | 7 |
| Workplace Conduct | 6 |
| **Total** | **82** (10 videos + 72 docs) |

Topics span the segments you named — forklift/LOTO/machine guarding/welding/PPE (Manufacturing); bloodborne/infection control/safe patient handling/workplace violence/respiratory (Healthcare); falls/ladders/scaffolding/trenching/silica/struck-by/caught-in/cranes/heat (Construction); manual handling/dock/racking/pedestrian/cold stress (Warehouse); food safety/handwashing/allergens/knives/burns/slips/norovirus (Hospitality); chemical safety/never-mix/gloves/disinfectants/BBP/ergonomics/waste (Cleaning); workstation/eye strain/fire/electrical/stress/air quality (Office); plus Workplace Conduct and Emergency Preparedness.

## 2. Sources — official government only, same verification rigor
- **10 videos**, every one verified via the YouTube **oEmbed API** to sit on the agency's *own* official channel:
  - NIOSH/CDC — noise hazards, air contaminants, contaminants on skin/surfaces, Total Worker Health
  - FEMA — Ready campaign; CISA — active-shooter preparedness
  - FDA — foodborne investigation; USDA — handwashing; CDC — foodborne outbreaks
  - **Cal/OSHA** (California DIR) — N95 respirators
  - Rejected during verification: Safety+Health/NSC, Cnetworks, "Respirator Fit Testing", and personal re-uploads that merely had "NIOSH/OSHA" in the title.
- **72 docs** — authored public-domain summaries with attribution links to official pages: OSHA topic/industry pages, NIOSH/CDC, FEMA/Ready.gov, FDA/FoodSafety.gov, EEOC, EPA, SAMHSA, DOL. Quality over padding — 82 solid, verifiable items rather than padded filler.
- Each item has a **unique `source_url`** (the upsert key); a handful of pages shared across verticals are disambiguated with a `#anchor` that still opens the same official page.

## 3. Idempotent seed (updated behavior)
`seedLibrary()` now:
- **Upserts on `source_url` and updates existing rows** — so the original 18 re-categorize into verticals on the next run (previously it skipped existing rows).
- **De-dupes by `source_url`** before the batch upsert, because a single upsert batch cannot touch the same conflict key twice.
- Still safe to run repeatedly; returns `before` / `after` / `inserted` / `total`.

## 4. Search fix
The bug: the server applied the category `eq` filter **before** the text match, so a search only looked within the selected vertical — "forklift" returned nothing unless you were already in that vertical.
The fix: when a query is present, it is matched **case-insensitively across title + category + provider over ALL items**, ignoring the active category chip. The chip only narrows when the search box is empty.

---

## Verification
82 items, all `source_url`s unique, 10 videos / 72 docs; static checks green. Live embed rendering and the seed insert run in your Supabase — after `?do=1`, open the **Library** tab: the vertical chips appear, search finds items across verticals, videos play inline, docs render, and "Use in training" works as before.
