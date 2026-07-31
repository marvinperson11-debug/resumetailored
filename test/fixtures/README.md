# Test fixtures

Small, real binary files checked in because some things can only be tested
against genuine bytes — see each fixture's consumer for why a synthetic
`Buffer.alloc(...)` wouldn't do.

| File | What it is | Used by |
|---|---|---|
| `clip-long.webm` | ~0.9s real WebM, recorded via MediaRecorder | `test/media-video-duration.js` |
| `clip-long.mp4` | ~0.9s real MP4, same content, different container | `test/media-video-duration.js` |
| `clip-short.webm` | ~0.15s real WebM | `test/media-video-duration.js` |

Regenerate with `node test/fixtures/make-fixtures.js` (needs
`playwright-core` + Chromium — the tests that consume these files do not).
