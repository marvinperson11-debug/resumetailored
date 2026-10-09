// Validation for the optional "look & timing" fields the Next.js app (app.resumetailored.com) sends to
// POST /api/resume-video-render, kept pure so it is unit-tested without a render. Every field is optional and a
// missing/invalid one is simply ignored (the video renders as it always did), never an error.
//
//   backgroundColor  '#rrggbb'  — the video's base background; text colour flips for light backgrounds
//   sceneStarts      [0, s1, s2, s3] seconds — when the 4 slides (title, highlights, skills, close) begin,
//                    taken from the TTS word timestamps so slides flip as the matching line is spoken
//   photoOverlay     { x, y, everySlide } — the headshot's CENTRE as fractions (0–1) of the frame width/height;
//                    shown on the title slide only unless everySlide is true
//   quick            true — slightly tighter built-in pacing/stagger
const HEX = /^#[0-9a-fA-F]{6}$/;

function cleanBackgroundColor(v) {
  return typeof v === 'string' && HEX.test(v.trim()) ? v.trim().toLowerCase() : undefined;
}

// Exactly 4 finite, non-decreasing numbers starting at 0, spanning at most 10 minutes.
function cleanSceneStarts(v) {
  if (!Array.isArray(v) || v.length !== 4) return undefined;
  const a = v.map(Number);
  if (!a.every((n) => Number.isFinite(n) && n >= 0 && n <= 600)) return undefined;
  if (a[0] !== 0) return undefined;
  for (let i = 1; i < 4; i++) if (a[i] < a[i - 1]) return undefined;
  return a.map((n) => Math.round(n * 1000) / 1000);
}

function cleanPhotoOverlay(v) {
  if (!v || typeof v !== 'object') return undefined;
  const x = Number(v.x), y = Number(v.y);
  if (!Number.isFinite(x) || !Number.isFinite(y)) return undefined;
  const c = (n) => Math.min(1, Math.max(0, n));
  return { x: Math.round(c(x) * 10000) / 10000, y: Math.round(c(y) * 10000) / 10000, everySlide: v.everySlide === true };
}

function parseRenderOptions(body) {
  const b = body || {};
  const out = {};
  const bg = cleanBackgroundColor(b.backgroundColor);
  if (bg) out.backgroundColor = bg;
  const starts = cleanSceneStarts(b.sceneStarts);
  if (starts) out.sceneStarts = starts;
  const overlay = cleanPhotoOverlay(b.photoOverlay);
  if (overlay) out.photoOverlay = overlay;
  if (b.quick === true) out.quick = true;
  return out;
}

module.exports = { parseRenderOptions, cleanBackgroundColor, cleanSceneStarts, cleanPhotoOverlay };
