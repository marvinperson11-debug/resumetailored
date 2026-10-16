# Craft sidecar — PdfCraft / WordCraft / GridCraft

A second Railway service that wraps three pinned ArtCraft CLIs behind a tiny Node HTTP server. The Next.js app
proxies to it over Railway's **private network**. The binaries are alpha software, so they are kept off the app's
request path and out of the app image: a crash, a hang or a 70 MB upgrade touches only this service.

**Everything is off by default.** With no `CRAFT_*` / `PDFCRAFT_*` / `WORDCRAFT_*` variables set, the app never
calls the sidecar, and every PDF export is the existing LibreOffice conversion (`lib/docs/pdf.ts` `docxToPdf`),
unchanged. LibreOffice stays installed in the app image as the default and the fallback.

| Endpoint | Tool | In / out |
|---|---|---|
| `GET /health` | — | `{ok, service, tools: {pdfcraft-cli, wordcraft-cli, gridcraft-cli}}` (the versions the binaries report; boot fails unless they equal `versions.lock`) |
| `POST /pdf/preview[?maxPages=1..10&dpi=36..200]` | PdfCraft `render` | multipart `file` PDF → `image/png` (1 page) or `application/zip` of `page-NN.png`; headers `x-craft-pages`, `x-craft-rendered` |
| `POST /pdf/text` | PdfCraft `text` | multipart PDF → `text/plain` (pages separated by form feeds) |
| `POST /docx/convert` | WordCraft `convert` | multipart DOCX → `application/pdf` |
| `POST /xlsx/roundtrip` | GridCraft `check` + `convert` + `check` | multipart XLSX → `.xlsx`; `x-craft-roundtrip: equal` or `documented` + `x-craft-roundtrip-diffs` |

Errors are JSON `{error, detail?}`: `BAD_REQUEST` 400, `UNAUTHORIZED` 401, `NOT_FOUND` 404, `TIMEOUT` 408 (body) / 504
(CLI), `TOO_LARGE` 413 (bytes or pages), `BAD_PDF` / `BAD_DOCX` / `BAD_XLSX` / `ROUNDTRIP_LOSSY` 422, `BINARY_ERROR` 502.

## Configuration

Sidecar (Railway service variables):

| Variable | Default | |
|---|---|---|
| `CRAFT_SHARED_SECRET` | — **required** (≥ 16 chars) | The server refuses to start without it. Same value as the app's. |
| `PORT` | `8080` | |
| `CRAFT_BIND` | `::` | Railway's private network is IPv6. Falls back to `0.0.0.0` where IPv6 is disabled. |
| `CRAFT_TMP` | `/tmp/craft` | Per-request temp dirs. |
| `CRAFT_MAX_BYTES` / `CRAFT_MAX_PAGES` / `CRAFT_TIMEOUT_MS` | 10 MB / 10 / 15000 | Hardening limits. |

App (`resumetailored-platform`, Railway service variables):

| Variable | Default | |
|---|---|---|
| `CRAFT_BASE_URL` | unset | e.g. `http://craft.railway.internal:8080`. Unset = sidecar not configured. |
| `CRAFT_SHARED_SECRET` | unset | Same value as the sidecar's. |
| `PDFCRAFT_ENABLED` | off | Kill switch for `/api/craft/pdf/preview` and `/api/craft/pdf/text`. Off or sidecar unavailable → **503**, never 500. |
| `WORDCRAFT_PDF_MODE` | `off` | `off` = LibreOffice only. `benchmark` = LibreOffice for the user, plus WordCraft as logged shadow traffic for free-tier exports. `pilot` = free-tier exports try WordCraft first. Unknown values count as `off`. **Do not set `pilot` until the benchmark report has been reviewed.** |

## Deploying on Railway

1. New service from this repo, **root directory `resumetailored-platform/craft`**, builder Dockerfile.
2. Set `CRAFT_SHARED_SECRET`. **Do not generate a public domain.** The service must be reachable only as
   `<service>.railway.internal`.
3. Do not configure an HTTP healthcheck path. `/health` requires the secret like every other request, and a deploy that
   cannot start (missing secret, wrong binary version) exits non-zero anyway.
4. On the app service set `CRAFT_BASE_URL=http://<service>.railway.internal:8080` and the same `CRAFT_SHARED_SECRET`.
   Leave `PDFCRAFT_ENABLED` / `WORDCRAFT_PDF_MODE` unset until you mean to turn something on.

Railway does not offer a tmpfs mount. The container filesystem is ephemeral and every request removes its own
directory in `finally`. `docker-compose.yml` (local only) runs the container read-only with a tmpfs at `/tmp/craft`.

## Security and resume PII

These files are resumes, so the rules are:

- **Internal only.** No public domain. Every request must carry `x-craft-secret` (constant-time compare), checked
  *before* the body is read. Unauthenticated callers get a bare 401 and the connection is closed.
- **Both directions.** The app sends a random `x-craft-nonce`. The sidecar answers with
  `x-craft-proof = HMAC-SHA256(secret, nonce)`, and the app discards any response without a valid proof as
  "untrusted" (so a mistyped `CRAFT_BASE_URL` can never feed it data).
- **Size before disk.** `Content-Length` over the cap is a 413 before anything is read, and a streamed body is cut off
  at the cap. Nothing is written to disk until the upload has passed both checks.
- **No body logging.** One structured line per request: route, status, code, byte counts, page count, duration,
  and the CLI step that failed (e.g. `render1:timeout`). Request and response bodies, uploaded filenames and CLI
  stderr/stdout are never logged. The client's filename is ignored entirely (files are saved as `in.pdf`, `in.docx`, …).
- **Per-request cleanup.** Each request gets its own `mkdtemp` directory (mode 0600 files). It is also the CLI's
  `HOME`/`TMPDIR`/`XDG_CACHE_HOME`, and it is removed in `finally` on success and on every failure path.
  `scripts/test-craft.cjs` asserts the temp root is empty after ~40 mixed requests.
- **Containment.** Runs as the unprivileged `node` user. Each CLI runs with a minimal environment and is
  `SIGKILL`ed at the request deadline.

## Pinned versions and the upgrade procedure

`versions.lock` is the single source of truth: `{tool, version, releaseUrl, sha256, addedDate, testedBy, notes}`.
`install-tools.cjs` runs inside the Docker build. It downloads each `releaseUrl`, **fails the build on any SHA-256
mismatch**, installs only the binary named `tool` to `/opt/craft/bin/`, and copies the archive's upstream
`LICENSE-*` / `NOTICE` / `OFL-*` files to `/opt/craft/licenses/<tool>/` (the build also fails if there are none).
Binaries are **never committed to git** (`test-craft` fails if an ELF or anything over 512 KB appears under `craft/`).

To upgrade a tool:

1. Bump its entry in `versions.lock`: `version`, `releaseUrl`, and the `sha256` **from the release page's published
   digest** (cross-check with `sha256sum` of your own download). Update `addedDate` and `notes`. Never "fix" a
   mismatch by pasting the hash the build printed. A changed hash for an existing tag is a red flag.
2. Rebuild the sidecar: `docker compose -f craft/docker-compose.yml build`.
3. Re-run `npm run test:craft`. It builds and starts that image and checks `/health` against the lock, PDF→PNG,
   PDF→text, DOCX→PDF, the xlsx round trip, the CJK guard and both kill switches. For a WordCraft bump, also re-run
   `scripts/benchmark-wordcraft.cjs` and compare the fidelity rate with the last report.
4. Only then redeploy: the sidecar first, then (if anything app-side changed) the app.

Without Docker: `node craft/install-tools.cjs --dest ~/.cache/craft-tools`, then
`CRAFT_TOOLS_DIR=~/.cache/craft-tools npm run test:craft` (runs `server.cjs` natively on those binaries).

### Release notes for the pinned versions

- v0.7.0 of WordCraft and GridCraft publishes **no Linux CLI-only asset** (only macOS). The pinned asset is the
  full Linux tarball, and only `bin/<tool>-cli` is installed (the GUI binary is discarded). PdfCraft 0.8.0 has a
  CLI-only tarball.
- All three are self-contained ELF binaries that need only the glibc loader.
- WordCraft keeps the source case of all-caps headings in its PDF text layer ("Summary", where LibreOffice's text
  says "SUMMARY"). The pixels are capitalised the same way. Text comparisons are case-insensitive for this reason.
- GridCraft opens almost anything (plain text included) as a workbook, so the sidecar checks the ZIP signature and
  `xl/workbook.xml` itself.

## GridCraft round trip: documented diffs

`/xlsx/roundtrip` runs `gridcraft-cli check --json` on the upload, converts it, then checks the output again. The
output must be a fixed point (no differences at all), or the result is `BINARY_ERROR`. Diff categories in the
**input's** round trip are accepted only if they are documented here. Anything else is `422 ROUNDTRIP_LOSSY`
naming the categories, as is any formula whose recalculated value differs (`calc`).

| Category | Accepted | Why |
|---|---|---|
| `package` | yes | OPC relationships GridCraft does not re-emit. Observed: SheetJS's `sheetMetadata` (`lost relationship sheetMetadata`). Cell values, formulas and styles are unaffected. |
| everything else (`values`, `formulas`, `sheets`, `numFmts`, `merges`, `tables`, `charts`, …) | no | Would change what the user sees. |

Byte-identical output is not achievable: GridCraft rewrites the package. "Documented diffs only" is the contract.

## License and branding

All three tools are dual-licensed **MIT OR Apache-2.0**. Their bundled fonts carry their own OFL licenses. The
upstream `LICENSE-*`, `NOTICE` and `OFL-*` files ship inside the image at `/opt/craft/licenses/<tool>/`.

**We do not fork.** The "ArtCraft" name and logos are trademarks of the ArtCraft Team and are not open source
(each upstream README: they "may be used only unmodified, and only as part of" the app; "forks and modified versions
must remove them"). **If a fork ever becomes necessary, strip all ArtCraft branding (names, logos, `docs/brand/`,
about/credits strings, the Discord/web links the CLIs print) before publishing or deploying it.** Keep the license
notices themselves. This note is here so the rule survives the people who read the trademark clause.

## Tests and benchmark

- `npm run test:craft` (also chained onto `npm run test:documents`): see the header of `scripts/test-craft.cjs`.
  The offline layers need no Docker. The integration layer runs with Docker (`CRAFT_INTEGRATION=docker`, the
  default when Docker exists) or natively (`CRAFT_TOOLS_DIR`), and is skipped with a note otherwise
  (`CRAFT_INTEGRATION=off` forces the skip).
- `node scripts/benchmark-wordcraft.cjs [--fast]`: WordCraft vs LibreOffice on 52 synthetic resumes (+3 CJK) through
  the real pipeline. Needs `soffice` locally and a sidecar (`CRAFT_BASE_URL` + `CRAFT_SHARED_SECRET`, or `--local`
  with `CRAFT_TOOLS_DIR`). Run it where the fonts match production: both converters must see Carlito, as in the app
  image and this image. Otherwise every visual check measures a font fallback, not WordCraft.
- `fixtures/`: synthetic test files (fictional names, `@example.com`), made with the repo's own renderer,
  LibreOffice and SheetJS. Never put a real resume here.
