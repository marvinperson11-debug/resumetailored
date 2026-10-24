'use strict';
/*
 * ga4-events.js — GA4 key events via Measurement Protocol: `signup_completed`
 * (Clerk user.created) and `pro_checkout_completed` (Stripe checkout.session.
 * completed, every paid Pro checkout — employer Portal/Scale/Corporate,
 * candidate Pro monthly, candidate Pro Lifetime). Sibling to ga4-purchase.js,
 * which already fires the ecommerce `purchase` event for every paid checkout
 * (individual + employer) — these are separate, named conversions so GA4
 * Admin → Key events can track signup and Pro-checkout completion on their
 * own, distinct from revenue reporting.
 *
 * Fire-and-forget: every exported tracker never throws and is never awaited
 * by its caller, so a GA/Clerk failure can never affect webhook processing.
 * Dedupe reuses the same claim-before-send `usage_store` pattern already
 * proven in ga4-purchase.js (and the owner-alert dedupe in server.js) — no
 * new table, no Supabase: this app's only durable store is its own SQLite DB.
 *
 * Pure-ish: db, fetch and env are all injected, so test/ga4-events.js drives
 * every path (dedupe, retry-after-failure, timeout, env guard) without a
 * network call.
 */
const crypto = require('crypto');

const DEFAULT_MEASUREMENT_ID = 'G-JWC76X5X68';
const MP_URL = 'https://www.google-analytics.com/mp/collect';
const MP_DEBUG_URL = 'https://www.google-analytics.com/debug/mp/collect';
const TIMEOUT_MS = 5000;

let _loggedUnconfigured = false;

function _fetchWithTimeout(fetchImpl, url, opts) {
  const ac = new AbortController();
  const timer = setTimeout(() => ac.abort(), TIMEOUT_MS);
  return fetchImpl(url, { ...opts, signal: ac.signal }).finally(() => clearTimeout(timer));
}

/** sha256(salt:seed) truncated to 32 hex chars — stable, pseudonymous; the raw id never leaves our infra. */
function ga4ClientId(seed, env = process.env) {
  const salt = env.GA4_CLIENT_SALT || '';
  return crypto.createHash('sha256').update(`${salt}:${String(seed || '')}`).digest('hex').slice(0, 32);
}

/**
 * Low-level MP sender. Never throws, never rejects. { sent, reason }.
 * Skips silently (one startup log) when GA4_API_SECRET is unset — every
 * other environment must not error because of it.
 */
async function sendGA4Event({ eventName, params = {}, clientId, userId } = {}, { env = process.env, fetchImpl = globalThis.fetch, log = console } = {}) {
  try {
    const secret = env.GA4_API_SECRET;
    if (!secret) {
      if (!_loggedUnconfigured) {
        _loggedUnconfigured = true;
        if (log.log) log.log('[ga4] GA4_API_SECRET not set — Measurement Protocol key events are disabled');
      }
      return { sent: false, reason: 'unconfigured' };
    }
    if (!eventName || !clientId) return { sent: false, reason: 'invalid_event' };
    const mid = env.GA4_MEASUREMENT_ID || DEFAULT_MEASUREMENT_ID;
    const base = env.GA4_DEBUG === 'on' ? MP_DEBUG_URL : MP_URL;
    const url = `${base}?measurement_id=${encodeURIComponent(mid)}&api_secret=${encodeURIComponent(secret)}`;
    const body = { client_id: clientId, timestamp_micros: Date.now() * 1000, events: [{ name: eventName, params }] };
    if (userId) body.user_id = userId;
    let ok = false;
    try {
      const r = await _fetchWithTimeout(fetchImpl, url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
      ok = !!(r && r.status >= 200 && r.status < 300);
      if (!ok && log.error) log.error(`[ga4] ${eventName} MP call failed: status=${r && r.status}`);
    } catch (e) {
      if (log.error) log.error(`[ga4] ${eventName} send failed:`, e.message);
    }
    return { sent: ok, reason: ok ? 'ok' : 'send_failed' };
  } catch (e) {
    if (log.error) log.error('[ga4] sendGA4Event error:', e.message);
    return { sent: false, reason: 'error' };
  }
}

/** Claim a dedupe key in usage_store before sending; release it on failure so a provider redelivery can retry. */
async function _claimAndSend(key, db, sendFn) {
  try {
    const claim = db.prepare('INSERT INTO usage_store (key, count) VALUES (?, 1) ON CONFLICT(key) DO NOTHING').run(key);
    if (!claim.changes) return { sent: false, reason: 'duplicate' };
    const result = await sendFn();
    if (!result.sent) { db.prepare('DELETE FROM usage_store WHERE key = ?').run(key); }
    return result;
  } catch (e) {
    try { db.prepare('DELETE FROM usage_store WHERE key = ?').run(key); } catch (_) { /* best-effort release */ }
    return { sent: false, reason: 'error' };
  }
}

/**
 * GA4 key event: signup_completed — fired once per Clerk `user.created`,
 * deduped on the Svix event id (the webhook route's own `svix-id` header),
 * which is stable across Stripe/Clerk redelivery of the same event.
 */
async function trackSignupCompleted({ userId, svixEventId } = {}, { db, env = process.env, fetchImpl = globalThis.fetch, log = console } = {}) {
  if (!svixEventId) return { sent: false, reason: 'invalid_event' };
  const key = `ga4events_signup_${svixEventId}`;
  const cid = ga4ClientId(userId || svixEventId, env);
  return _claimAndSend(key, db, () => sendGA4Event({
    eventName: 'signup_completed',
    params: { signup_source: 'clerk' },
    clientId: cid,
    userId: userId ? cid : undefined
  }, { env, fetchImpl, log }));
}

/** Best-effort lookup of the Clerk user id for an email — same endpoint/shape as server.js's `_syncPlanToClerk`, kept self-contained so this module has no dependency on server.js internals. Never throws; null on any failure. */
async function _resolveClerkUserId(email, { env = process.env, fetchImpl = globalThis.fetch } = {}) {
  const secret = env.CLERK_SECRET_KEY;
  const key = String(email || '').toLowerCase().trim();
  if (!secret || !key) return null;
  try {
    const r = await _fetchWithTimeout(fetchImpl, `https://api.clerk.com/v1/users?email_address[]=${encodeURIComponent(key)}`, { headers: { Authorization: `Bearer ${secret}` } });
    if (!r.ok) return null;
    const users = await r.json();
    const list = Array.isArray(users) ? users : (users && Array.isArray(users.data) ? users.data : []);
    const user = list.find((u) => Array.isArray(u && u.email_addresses) &&
      u.email_addresses.some((a) => String(a && a.email_address || '').toLowerCase() === key));
    return (user && user.id) || null;
  } catch (_) {
    return null;
  }
}

/**
 * GA4 key event: pro_checkout_completed — every paid Pro checkout (employer
 * Portal/Scale/Corporate, candidate Pro monthly $19, candidate Pro Lifetime
 * $129), deduped on the Stripe EVENT id (not the session id — Stripe may
 * redeliver the same event). Fires after the webhook's main work regardless
 * of whether plan sync itself succeeded (the conversion already happened).
 *
 * Scope is determined by elimination, not assumption — verified against
 * every `stripe.checkout.sessions.create` call site in server.js:
 *   - employer (Portal/Scale/Corporate): always carries metadata.plan === 'employer'
 *     (+ metadata.employerTier) — both app-checkout and the legacy employer route set it.
 *   - lifetime ($129): mode:'payment' and metadata.plan === 'lifetime' — same
 *     test _fulfillCheckoutSession uses in server.js to fulfil it.
 *   - candidate Pro monthly ($19): the only other paid checkout this app
 *     creates (/api/subscribe, /api/app-checkout), and it carries NO plan
 *     metadata at all. Its explicit marker is mode:'subscription' once
 *     employer/lifetime are ruled out — NOT a line-item price id: the raw
 *     Stripe webhook payload doesn't include line_items (only an explicit
 *     `sessions.retrieve(..., {expand:['line_items']})` call would, which
 *     this fire-and-forget tracker deliberately avoids making), and
 *     /api/subscribe's archived-price fallback mints a fresh ad-hoc
 *     `price_data` id on every retry anyway, so a literal price id would not
 *     even be a *stable* key here. mode + absence of employer/lifetime
 *     metadata is the most explicit, stable marker this session carries.
 */
async function trackProCheckoutCompleted(session, { eventId, db, env = process.env, fetchImpl = globalThis.fetch, log = console } = {}) {
  if (!session || !session.id || !eventId) return { sent: false, reason: 'invalid_event' };
  if (session.payment_status !== 'paid') return { sent: false, reason: 'not_paid' };
  const isEmployer = session.metadata?.plan === 'employer';
  const isLifetime = !isEmployer && (session.metadata?.plan === 'lifetime' || session.mode === 'payment');
  const isMonthlyPro = !isEmployer && !isLifetime && session.mode === 'subscription';
  if (!isEmployer && !isLifetime && !isMonthlyPro) return { sent: false, reason: 'not_pro' };
  const key = `ga4events_procheckout_${eventId}`;
  return _claimAndSend(key, db, async () => {
    const email = String(session.metadata?.email || session.customer_details?.email || session.customer_email || '').toLowerCase().trim();
    const clerkUserId = email ? await _resolveClerkUserId(email, { env, fetchImpl }) : null;
    const seed = clerkUserId || session.customer || session.id;
    const value = Math.round(Number(session.amount_total || 0)) / 100; // cents -> exact decimal, Stripe amounts are always integer cents
    const currency = String(session.currency || 'usd').toUpperCase();
    // plan param: the explicit metadata value for employer; 'lifetime' for the
    // lifetime plan; the no-metadata monthly path has no price-id constant to
    // key on reliably (see the fallback note above), so 'pro-monthly' is the
    // stable label recorded consistently for it instead.
    const plan = isEmployer
      ? (session.metadata?.employerTier || session.metadata?.tier || undefined)
      : (isLifetime ? 'lifetime' : 'pro-monthly');
    const cid = ga4ClientId(seed, env);
    return sendGA4Event({
      eventName: 'pro_checkout_completed',
      params: { value, currency, transaction_id: session.id, ...(plan ? { plan } : {}) },
      clientId: cid,
      userId: clerkUserId ? cid : undefined
    }, { env, fetchImpl, log });
  });
}

module.exports = { ga4ClientId, sendGA4Event, trackSignupCompleted, trackProCheckoutCompleted, _resolveClerkUserId };
