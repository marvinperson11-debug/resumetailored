# AutoApply Extension (Manifest V3)

Auto-fills job application forms on **LinkedIn Easy Apply**, **Greenhouse**,
**Lever**, and **Workday** using data from your AutoApply dashboard. It fills
and highlights fields; **you review and submit**.

## Build & load

```bash
npm install
npm run build        # → dist/
```

`chrome://extensions` → enable Developer mode → **Load unpacked** → select `dist/`.
Dev with HMR: `npm run dev`.

## Configure

Open the popup:
- **Dashboard URL** — where your AutoApply dashboard runs (e.g. `http://localhost:3000`).
- **Extension token** — generate on the dashboard: Profile → Browser extension.

Also add this extension's id to the dashboard `.env` `EXTENSION_ORIGINS`
(`chrome-extension://<id>`) so the API allows its cross-origin calls.

## How it works

| File | Role |
|---|---|
| `src/background/index.ts` | On `APPLY`, opens the job tab and remembers which job it fills (keyed by tab id in session storage). |
| `src/content/dashboard-bridge.ts` | Runs on the dashboard; relays the page's `postMessage` APPLY to the background. |
| `src/content/ats.ts` | Runs on ATS pages; asks background for its assignment, fetches apply-data, picks an adapter, fills, mounts the overlay, and re-runs on DOM mutations. |
| `src/content/adapters/*` | Per-platform field mapping over the shared `filler` engine. |
| `src/lib/filler.ts` | Finds fields by label/name/placeholder/aria, sets values React-compatibly, tints them green. |
| `src/lib/overlay.ts` | The floating "N fields auto-filled — review and submit" card with the **mark Applied** sync button. |
| `src/popup/*` | React popup for token + dashboard URL. |

## Adding an ATS adapter

Implement `Adapter` (`matches(url)` + `fill(data)`), reuse `fillCommonFields`
for shared fields, add platform-specific selectors, then register it in
the `ADAPTERS` array in `ats.ts` and add the host to `manifest.json`
`content_scripts[1].matches` + `host_permissions`.

## What it never does

- Never clicks Submit.
- Never answers work-authorization / EEO / legal attestation questions.
- Never stores your token anywhere but this browser's extension storage.
