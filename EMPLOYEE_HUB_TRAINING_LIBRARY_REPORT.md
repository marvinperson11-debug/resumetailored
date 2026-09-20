# Employee Hub — Built-in Training Library (Build Report)

**Repo:** `marvinperson11-debug/resumetailored` · **Project:** `resumetailored-platform/` (Next.js 14 + Supabase + Clerk)
**Branch:** `claude/employee-hub-feature-xlm48r` (restarted from latest `main`, since PR #527 was already merged)
**Draft PR:** [#528 — Built-in Training Library](https://github.com/marvinperson11-debug/resumetailored/pull/528)
**Checks:** `tsc --noEmit` ✅ · `next lint` ✅ · `next build` ✅

---

## ⚠️ Before deploying
Apply the migration to Supabase (idempotent, safe to re-run):
```
resumetailored-platform/supabase/migrations/0030_training_library.sql
```
It creates `training_library_items` (RLS on, **no policies** → service-role reads only), adds `training_docs.library_item_id`, and seeds the 18 library items.

---

## What shipped

### 1. Library data (migration 0030)
| Piece | Detail |
|---|---|
| `training_library_items` | id, category, title, kind (`video`\|`doc`), provider, `embed_url`, `body_html`, `source_url`, created_at |
| RLS | enabled, **no policies** — shared platform content, read only via service-role (`lib/training-library.ts`) |
| `training_docs.library_item_id` | FK link from a training item to the library entry it was created from |
| Seed | **18 real items** — 7 videos + 11 docs |

### 2. Verified video sources (the important part)
Every seeded video was checked against the **YouTube oEmbed API** (`author_name` = the uploading channel) to confirm it's the agency's **own official channel**. This caught and excluded several look-alike re-uploads (e.g. "DeSAT", "Newfangled Studios", a local TV station) and one **deleted** video — none of which shipped.

| Title | Official channel | Category |
|---|---|---|
| Protecting My Workers Against Noise Hazards | CDC / NIOSH | Safety — General |
| NIOSH Health Hazard Evaluation: Measuring Air Contaminants | CDC / NIOSH | Safety — General |
| FEMA & Ready Campaign: Preparing Older Adults | FEMA | Emergency Preparedness |
| Active Shooter Preparedness: Options for Consideration | CISA | Emergency Preparedness |
| How FDA Investigates Foodborne Illness Outbreaks | U.S. FDA | Food Safety |
| A Flash of Food Safety: Why to Wash Your Hands | USDA | Food Safety |
| CDC in Action: Foodborne Outbreaks | CDC | Food Safety |

Videos embed via privacy-enhanced `youtube-nocookie.com/embed/…`; each item links its official watch URL as attribution.

### 3. Doc items (11)
Authored **public-domain summaries** (US-gov works are public domain) with an attribution link to the official source page — covering the hazard topics that lack an official-channel video: **Fall Protection, PPE, Hazard Communication, Forklift/Powered Industrial Trucks, Heat Illness, Bloodborne Pathogens** (OSHA); **Emergency Action Plans** (OSHA), **Business Preparedness** (Ready.gov/FEMA); **Workplace Violence** (OSHA), **Worker Safety & Health Rights** (DOL); **Food Safety Basics** (FoodSafety.gov/FDA).

### 4. Library tab (UI)
New **Library** tab on the Employees page (`app/employer/employees/employees-client.tsx`): category filter chips + debounced search, **videos previewed inline** (embed), **docs rendered as HTML**, each card with a source link and a **"Use in training"** button.

### 5. Training-form integration
- Content Source gains **"Pick from Library"**. "Use in training" jumps to the Training tab with the composer prefilled.
- **Video** → stores `library_item_id`; the compliance drawer renders the **embedded watch step**; the signable/quiz body is an attestation block. Video + signature/quiz is the compliance pattern.
- **Doc** → snapshots the library HTML as the training body.
- **Tracking unchanged:** acknowledgments, compliance grid (signed/pending/overdue/waived), reminders, and activity events are entirely source-agnostic.

---

## Files
**New:** `supabase/migrations/0030_training_library.sql`, `lib/training-library.ts`, `app/api/employer/training-library/route.ts`
**Changed:** `lib/employee-hub.ts` (types + `TrainingDoc.libraryItemId`), `lib/training-store.ts` (persist link), `app/api/employer/training/route.ts` (accept a Library source), `app/api/employer/training/[id]/route.ts` (return the embed), `app/employer/employees/employees-client.tsx` (Library tab + composer + drawer embed)

## Constraints honored
- ✅ US-government public-domain sources only; attribution shown on every item.
- ✅ Videos **embedded, never downloaded**.
- ✅ No new npm dependencies.
- ✅ Idempotent, hand-applied migration.
- ✅ tsc / lint / build green.

## Verification note (honest)
Static checks pass locally. Live embed rendering / Supabase reads can't be exercised in this sandbox, so video-channel ownership was verified out-of-band via the YouTube oEmbed API rather than by playing each clip. After applying 0030, sanity check: Employees → **Library** → filter/search → a video plays inline, a doc renders → **Use in training** opens the composer prefilled → assign → compliance drawer shows the embedded watch step; overdue/reminders/activity behave exactly as before.
