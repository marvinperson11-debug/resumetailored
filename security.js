/* security.js — pure security-logic core (password policy, breach checking,
 * login lockout tracking, log scrubbing, header values), mirroring the
 * career-hub.js / employer-hub.js split: no Express, no direct DB access
 * baked in (a couple of helpers take `db` as a parameter instead), so this
 * whole module is unit-testable with `node test/security.js` and no server
 * boot. server.js wires it into routes/middleware.
 */
'use strict';
const crypto = require('crypto');

// ─── Password policy ─────────────────────────────────────────────────────────
// Min 8 chars + at least one upper, lower, digit, and symbol.
function validatePasswordPolicy(password) {
  if (typeof password !== 'string' || password.length < 8) {
    return { ok: false, reason: 'Password must be at least 8 characters.' };
  }
  if (!/[a-z]/.test(password)) return { ok: false, reason: 'Password must include a lowercase letter.' };
  if (!/[A-Z]/.test(password)) return { ok: false, reason: 'Password must include an uppercase letter.' };
  if (!/[0-9]/.test(password)) return { ok: false, reason: 'Password must include a number.' };
  if (!/[^A-Za-z0-9]/.test(password)) return { ok: false, reason: 'Password must include a symbol.' };
  return { ok: true };
}

// ─── Have I Been Pwned (Pwned Passwords, k-anonymity range API) ─────────────
// No API key needed: only a 5-char SHA-1 prefix ever leaves the server, never
// the password or its full hash. Fails OPEN (network hiccup never blocks a
// signup/password change) — `checked:false` tells the caller not to treat
// this as a verdict either way.
async function checkPwnedPassword(password, fetchImpl) {
  const doFetch = fetchImpl || (typeof fetch === 'function' ? fetch : null);
  if (!doFetch) return { pwned: false, count: 0, checked: false };
  try {
    const sha1 = crypto.createHash('sha1').update(password).digest('hex').toUpperCase();
    const prefix = sha1.slice(0, 5);
    const suffix = sha1.slice(5);
    const res = await doFetch(`https://api.pwnedpasswords.com/range/${prefix}`, {
      headers: { 'Add-Padding': 'true' },
    });
    if (!res || !res.ok) return { pwned: false, count: 0, checked: false };
    const body = await res.text();
    for (const line of body.split('\n')) {
      const [suf, count] = line.trim().split(':');
      if (suf === suffix) return { pwned: true, count: parseInt(count, 10) || 1, checked: true };
    }
    return { pwned: false, count: 0, checked: true };
  } catch (e) {
    return { pwned: false, count: 0, checked: false };
  }
}

// ─── Login/signup failed-attempt lockout ─────────────────────────────────────
// A standard sliding-window rate limiter (express-rate-limit) counts EVERY
// request, which would also penalize a user who mistypes their password once
// or twice in normal use. This tracks FAILURES specifically, keyed by
// caller-supplied string (IP for login, IP for signup) — 5 failures inside
// WINDOW_MS trips a LOCKOUT_MS lockout, longer than the counting window
// itself, which a plain rate limiter can't express in one config.
// In-memory by design, same as every other rate limiter already in
// server.js — a restart clears it, which is an accepted tradeoff shared with
// the rest of this codebase's rate limiting, not a new one.
function createLockoutTracker({ windowMs = 15 * 60 * 1000, maxAttempts = 5, lockoutMs = 60 * 60 * 1000 } = {}) {
  const store = new Map();

  function _prune(key) {
    const rec = store.get(key);
    if (!rec) return null;
    const now = Date.now();
    if (rec.lockedUntil && now >= rec.lockedUntil) { store.delete(key); return null; }
    if (!rec.lockedUntil && now - rec.firstAt > windowMs) { store.delete(key); return null; }
    return rec;
  }

  return {
    // Returns { locked, retryAfterSec } — does not mutate state.
    check(key) {
      const rec = _prune(key);
      if (rec && rec.lockedUntil) {
        const now = Date.now();
        if (now < rec.lockedUntil) return { locked: true, retryAfterSec: Math.ceil((rec.lockedUntil - now) / 1000) };
      }
      return { locked: false, retryAfterSec: 0 };
    },
    // Call on every failed attempt. Returns the same shape as check().
    recordFailure(key) {
      const now = Date.now();
      let rec = _prune(key);
      if (!rec) rec = { count: 0, firstAt: now, lockedUntil: null };
      rec.count += 1;
      if (rec.count >= maxAttempts) rec.lockedUntil = now + lockoutMs;
      store.set(key, rec);
      if (rec.lockedUntil) return { locked: true, retryAfterSec: Math.ceil(lockoutMs / 1000) };
      return { locked: false, retryAfterSec: 0 };
    },
    // Call on a SUCCESSFUL attempt so a real login doesn't stay "one away" forever.
    clear(key) { store.delete(key); },
    // Exposed for tests only.
    _size() { return store.size; },
  };
}

// ─── Log / error-report scrubbing ────────────────────────────────────────────
// Anything shaped like a secret gets redacted before it can reach a console
// line, a log aggregator, or a Sentry event. Recurses into plain objects and
// arrays; leaves everything else (including the DB handle, functions, etc.)
// untouched by returning it as-is rather than trying to walk it.
const SENSITIVE_KEY_RE = /pass(word)?|token|secret|api[_-]?key|authorization|bearer|cookie|card(number)?|cvv|ssn/i;
function scrubForLog(value, depth) {
  depth = depth || 0;
  if (value == null || depth > 6) return value;
  if (Array.isArray(value)) return value.map((v) => scrubForLog(v, depth + 1));
  if (typeof value !== 'object') return value;
  if (value instanceof Error) {
    return { name: value.name, message: value.message, stack: undefined };
  }
  const out = {};
  for (const [k, v] of Object.entries(value)) {
    if (SENSITIVE_KEY_RE.test(k)) { out[k] = '[REDACTED]'; continue; }
    out[k] = (v && typeof v === 'object') ? scrubForLog(v, depth + 1) : v;
  }
  return out;
}

// ─── CORS whitelist ───────────────────────────────────────────────────────────
// Exact-match against the production hosts plus any *.resumetailored.com
// subdomain (personal websites / employer subdomains already route through
// this app — see PERSONAL_SITE_HOST_RE in server.js) and localhost for local
// dev. No wildcard in production.
function buildCorsOriginChecker(extraOrigins) {
  const allowed = new Set(['https://resumetailored.com', 'https://www.resumetailored.com', ...(extraOrigins || [])]);
  return function isAllowedOrigin(origin) {
    if (!origin) return true; // same-origin / non-browser requests send no Origin header
    if (allowed.has(origin)) return true;
    try {
      const u = new URL(origin);
      if (u.hostname.endsWith('.resumetailored.com')) return true;
      if (u.hostname === 'localhost' || u.hostname === '127.0.0.1') return true;
    } catch (e) { /* malformed origin header — reject */ }
    return false;
  };
}

// ─── Content-Security-Policy ──────────────────────────────────────────────────
// Built from what the app's own pages actually load (verified by grepping
// every <script>/<link> src across public/ and checking with the browser
// console under a local server), NOT copied from a generic template — the
// original ask listed api.openai.com, but this app calls Anthropic; it also
// didn't account for Google Analytics/AdSense (already live on the landing
// and dashboard pages), the ElevenLabs browser-direct voice API used by
// /preview, the esm.sh-hosted React/Remotion modules that same page loads
// via an import map, or jsPDF from cdnjs. Any of those missing would have
// silently broken ad revenue, analytics, or a real feature — not "hardened"
// anything.
function buildCSP() {
  return [
    "default-src 'self'",
    "script-src 'self' 'unsafe-inline' https://www.googletagmanager.com https://pagead2.googlesyndication.com https://*.googlesyndication.com https://*.doubleclick.net https://*.google.com https://cdnjs.cloudflare.com https://esm.sh",
    "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
    "img-src 'self' data: https:",
    "font-src 'self' https://fonts.gstatic.com data:",
    "connect-src 'self' https://api.anthropic.com https://api.stripe.com https://api.elevenlabs.io https://esm.sh https://*.google-analytics.com https://analytics.google.com https://*.googlesyndication.com https://*.g.doubleclick.net",
    "frame-src 'self' https://*.doubleclick.net https://*.googlesyndication.com https://td.doubleclick.net",
    "object-src 'none'",
    "base-uri 'self'",
  ].join('; ');
}

// ─── Timing-safe string compare ──────────────────────────────────────────────
// For comparing a submitted secret (ADMIN_SECRET, webhook tokens) against the
// real value without leaking how many leading characters matched via
// response-time differences. Length-mismatches are compared against a
// same-length buffer of the SAME secret first so the function's own runtime
// doesn't itself leak the length (crypto.timingSafeEqual throws on unequal
// buffer lengths, which is why the check is done this way rather than just
// returning false immediately on a length mismatch).
function timingSafeEqualStr(a, b) {
  if (typeof a !== 'string' || typeof b !== 'string') return false;
  const bufA = Buffer.from(a);
  const bufB = Buffer.from(b);
  if (bufA.length !== bufB.length) {
    crypto.timingSafeEqual(bufA, bufA); // constant-time no-op, keeps timing consistent
    return false;
  }
  return crypto.timingSafeEqual(bufA, bufB);
}

// ─── HTML escaping ────────────────────────────────────────────────────────────
// Standard entity escape for user-supplied text interpolated into an HTML
// string (email bodies built as template literals, mainly) — the same
// implementation already used ad hoc in badge-page.js, centralized here so
// every call site (contact form, audit-log emails, etc.) uses one version.
function escapeHtml(s) {
  return String(s == null ? '' : s)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

module.exports = {
  validatePasswordPolicy,
  checkPwnedPassword,
  createLockoutTracker,
  scrubForLog,
  buildCorsOriginChecker,
  buildCSP,
  escapeHtml,
  timingSafeEqualStr,
};
