# Website Creator — Phase 2 progress + open questions

Response to the item #1 revert, what I've built in this pass, and the questions I'd like answered before I wire up the Phase 2 **frontend** (so I don't build UX we'd have to redo).

---

## Acknowledged: item #1 reverted

- **Create-a-Link stays exactly as-is** — no download button, watermark footer unchanged, `test/golden/link.html` **unchanged** (re-verified: still byte-identical, no `--update` needed). The Phase 2 Link-button task and its snapshot re-baseline are **removed**.
- **Instead: an upgrade nudge at link-creation time** — a short dismissible banner shown when a user creates a Link, pointing to the Pro Website's download toggle (scope item #2). This lives in the **app's share flow** (`app.html`), *not* on the `/r/:slug` page — so the Link renderer is still untouched.
- Everything else stands: grid-based freeform layout, print-to-PDF + plain-text download on the **Website only**, Resend check, prior phasing.

---

## Shipped in this pass (Phase 2 backend — unblocked, no UX dependencies)

All additive, no behavior change to existing surfaces. Verified by loading the module against a temp DB.

- **`saved_cover_letters`** table + **`GET/POST/DELETE /api/cover-letters`** (mirror of `saved_resumes`: dedupes identical content, keeps latest 20).
- **`saved_videos`** table (`id, email, title, path, source, bytes, created_at`) + **`GET /api/videos`** and **`DELETE /api/videos/:id`** (delete also unlinks the file). File-writing/persist paths come in Phase 4/5.
- **`GET /api/assets/summary`** → `{ resumes, coverLetters, videos }` — powers the pop-up gate (the "tailor first" modal shows only when `resumes + coverLetters === 0`).
- Confirmed `personal_sites.config` column present (from Phase 1).

**Not yet built (needs the answers below):** the Website Creator **tab/UI**, the pop-up gate modal, the asset-selector panel, the video entry points, the cover-letter auto-save hook, and the link-creation upgrade nudge.

---

## Open questions before I build the Phase 2 frontend

### Q1 — Creator entry point & where the editor lives
Today "Personal Website" in the sidebar calls `publishPersonalSite()` immediately (a `window.prompt`). Phase 2 replaces that. Options:
- **(a) Full in-app tab** `showTab('website')` — the editor is a first-class SPA tab like Tailor/ATS. *(My recommendation — most room to grow into the grid builder.)*
- **(b) Modal/overlay** launched from the sidebar button.

Either way the sidebar button first runs the Pro gate + pop-up logic. **Confirm (a)?**

### Q2 — Cover-letter auto-save trigger
To populate the picker, cover letters need to be saved. Proposed: after a successful `cover_letter` or `both` tailor run, the client **auto-saves** the cover letter via `POST /api/cover-letters` (silent, delete-dupes, keep 20) — same pattern as resumes. **OK to auto-save silently, or would you rather a "Save cover letter" button the user clicks?**

### Q3 — Pop-up gate copy & behavior
When the user has zero resumes/cover letters, the modal blocks entry to the creator. Proposed copy: *"Tailor a resume first — your website is built from your saved resumes and cover letters. Tailor one (it's free) and it'll appear here automatically."* with a **"Go to Tailor →"** button. **Good, or do you want different copy / a "start from a blank site anyway" escape hatch?**

### Q4 — Which assets does a site pull, and default selection
The creator auto-pulls saved resumes + cover letters. Proposed default: **most-recent resume** selected as the site's primary; cover letter optional (off by default). User can switch anytime. **Confirm the "most-recent resume, cover letter optional" default?**

### Q5 — Upgrade nudge (link creation) — placement & copy
Where the nudge appears: in the **share modal** after a Link is created (below the copyable link). Proposed copy: *"💡 Want recipients to download your resume directly? Upgrade to Pro to publish a Personal Website with a built-in download button."* + a **"See Pro →"** link that opens the upgrade flow (`startPro()`). Dismissible, remembered in `localStorage` so it's not nagging. **Approve this copy/placement, or adjust?**

### Q6 — Video persistence storage location
Generated/uploaded videos will be stored under **`${DATA_DIR}/site-media/<email-hash>/`** so they survive deploys (needs the Railway volume mounted — already documented). Confirming this is the intended location and that the **Railway volume is (or will be) mounted at `/data`** in production. *(If not mounted, persisted videos vanish on redeploy — worth confirming before Phase 4/5.)*

### Q7 — Resend (still open from before)
`RESEND_API_KEY` is unset in this build env; please confirm the **Railway** value when convenient. Non-blocking (lead capture persists first), but affects whether lead emails actually send.

---

## What I'll do next

- **If you answer Q1–Q5**, I'll build the Phase 2 frontend: Creator tab (Q1), pop-up gate (Q3), asset-selector with default (Q4), cover-letter auto-save (Q2), video entry points ("Generate from résumé" + "Upload your own"), i18n key scaffolding (EN/中文), and the link-creation upgrade nudge (Q5).
- **Q6/Q7** aren't blockers for Phase 2 frontend; they matter at Phase 4/5 — just want them on record now.

Backend is committed and pushed (draft PR #263). I can proceed on my recommended defaults for all of Q1–Q5 if you'd rather I not wait — just say "go with your defaults."
