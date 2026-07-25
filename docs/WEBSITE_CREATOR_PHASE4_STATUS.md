# Website Creator — Phase 4 status (media uploads)

Phase 4 is built on the branch (draft PR #263) against `DATA_DIR`, per your go-ahead. Option B quotas + the 5-video cap are enforced server-side.

## What shipped

**Backend — uploads, quota, serving:**
- **`site_media`** table + **`POST /api/site-media`** (multer, Pro-gated). Validates:
  - **Type:** images `jpg/png/webp`, audio `mp3/m4a/aac`, video `mp4`.
  - **Per-file:** 8 MB image · 25 MB audio · 25 MB video.
  - **Quota (Option B):** 300 MB shared images+audio · 300 MB video · **max 5 videos**.
- **`GET /api/site-media`** → list + usage; **`DELETE /api/site-media/:id`** (removes the row and unlinks the file).
- **`GET /media/:id`** — public, streams the stored file by id with an immutable 1-year cache (personal sites are public, so media has no auth gate).
- Files stored at **`${DATA_DIR}/site-media/<email-hash>/<random>.<ext>`**.

**Renderer — new blocks:**
- **Audio block** — `controls`, **no autoplay** (starts paused), optional label. Exactly the "no autoplay-with-sound" rule.
- **Gallery block** — a swipeable scroll-snap strip with **per-image captions** (degrades perfectly on mobile, no timer JS).
- Image/video blocks already accept the `/media/<id>` URLs uploads return.

**Editor (creator "Design your layout" step):**
- Palette gains **Gallery** and **Audio**.
- **Upload** buttons on image / video / audio blocks (file picker → uploads → sets the block source).
- **Gallery editor:** add image (uploads), per-image caption, remove.
- A **storage usage meter** (images & audio MB / video MB + video count vs. caps).
- The Phase 2 **"Upload your own video"** button now actually adds a video block and uploads into it.
- Full **EN / 中文** i18n for all new strings.

## Verified
- `server.js` syntax ✓; inline scripts parse ✓; EN/中文 i18n parity ✓
- Render goldens: `link.html` + `site.html` **byte-identical**; `site-grid.html` **re-baselined** (only for the new audio/gallery CSS — reviewed, intentional) ✓
- **Media E2E** on an ephemeral port: upload PNG → `/media/1`; **disallowed type rejected (400)**; served with correct content-type; list+usage correct; delete frees usage ✓
- **Render E2E:** an uploaded image in a **gallery** block renders with its caption, and an **audio** block renders with controls and **no autoplay**, on `/site/:name` ✓

## Important: Railway `/data` volume (Q6)
Phase 4 writes real files to `${DATA_DIR}/site-media/…`. On production this **must** be a mounted Railway volume at **`/data`** (with `DATA_DIR=/data`), or **uploaded media is lost on every redeploy**.
- You said you'd mount it before we merge to `main` — this is the phase that makes it matter. **Please confirm the volume is mounted before we merge**, and I'll flag it again at merge time if it isn't.
- I did **not** change the Dockerfile or start command; the volume is a Railway dashboard setting (Volume → mount path `/data`).

## Where we are
- ✅ Phase 1 · ✅ Phase 2 · ✅ Phase 3a · ✅ Phase 3b · ✅ **Phase 4 (media)**  ← just finished
- ⏭️ **Phase 5** — video hero + preset/custom labels, **tiered editable case-study cards**, contact / "Request my resume PDF" lead capture (persist-first), themed QR, simple analytics (views + top referrer). **5b:** plain-text-video generation + record/upload voiceover.
- Phase 6 — Back Office · Phase 7 — i18n copy pass · Phase 8 — polish

## Open items on you (non-blocking to building, blocking to merge/prod)
- **Q6** — mount the Railway `/data` volume (now materially relevant — media persistence).
- **Q7** — `RESEND_API_KEY` in Railway (Phase 5 lead-capture emails).
- **Merge to `main`** whenever you want the Railway end-to-end test.

Say the word and I'll start **Phase 5** (the "pop" features — case-study cards, lead capture, QR, analytics).
