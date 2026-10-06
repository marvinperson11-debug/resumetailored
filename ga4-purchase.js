'use strict';
/*
 * ga4-purchase.js — server-side GA4 `purchase` event (Measurement Protocol).
 *
 * Fired from the Stripe `checkout.session.completed` webhook, the one place
 * every successful checkout (Pro $19/mo, $129 lifetime, employer Portal / Scale
 * / Corporate) passes exactly once and that an ad blocker cannot touch. The
 * Stripe success_url is the bare app origin (no session id), so there is no
 * client-side return page that could have carried the event — this IS the
 * primary and only path.
 *
 * Inert unless GA4_API_SECRET is set (GA4 Admin → Data streams → Measurement
 * Protocol API secrets). GA4_MEASUREMENT_ID defaults to the site's stream.
 *
 * Pure-ish: the DB (dedupe) and fetch are injected, so test/ga4-purchase.js
 * drives it without a network.
 */
const crypto = require('crypto');

const DEFAULT_MEASUREMENT_ID = 'G-JWC76X5X68';
const MP_URL = 'https://www.google-analytics.com/mp/collect';

function _plan(session) {
  const md = (session && session.metadata) || {};
  if (md.plan === 'employer') return { id: `employer_${md.tier || 'portal'}`, name: `Employer ${md.tier || 'Portal'}` };
  if (md.plan === 'lifetime' || session.mode === 'payment') return { id: 'pro_lifetime', name: 'Pro Lifetime' };
  return { id: 'pro_monthly', name: 'Pro Monthly' };
}

// Build the MP request body, or null if the session is not a paid checkout.
function buildPurchasePayload(session) {
  if (!session || !session.id) return null;
  if (session.payment_status !== 'paid') return null; // unpaid / trial-only → no revenue event
  const value = Math.round(Number(session.amount_total || 0)) / 100;
  const currency = String(session.currency || 'usd').toUpperCase();
  const plan = _plan(session);
  // MP requires a client_id and the webhook has no browser. Derive a stable
  // pseudo-id from the Stripe customer (or session) so one buyer stays one user.
  const seed = String(session.customer || session.id);
  const clientId = `${parseInt(crypto.createHash('sha256').update(seed).digest('hex').slice(0, 8), 16)}.${Math.floor((session.created || 0) || 1700000000)}`;
  return {
    client_id: clientId,
    events: [{
      name: 'purchase', // must match the GA4 key event exactly
      params: {
        transaction_id: session.id, // GA4 also dedupes on this
        value, currency,
        items: [{ item_id: plan.id, item_name: plan.name, price: value, quantity: 1 }]
      }
    }]
  };
}

/**
 * Send once per Stripe session. `db` needs usage_store(key, count); `fetchImpl`
 * defaults to global fetch. Never throws; resolves { sent, reason }.
 */
async function trackPurchase(session, { db, env = process.env, fetchImpl = globalThis.fetch, log = console } = {}) {
  try {
    const secret = env.GA4_API_SECRET;
    if (!secret) return { sent: false, reason: 'unconfigured' };
    const payload = buildPurchasePayload(session);
    if (!payload) return { sent: false, reason: 'not_paid' };
    const key = `ga4purchase_${session.id}`;
    // Claim BEFORE sending: Stripe retries webhooks, and a double count is worse
    // than a rare miss. Released on a failed send so a retry can still land it.
    const claim = db.prepare('INSERT INTO usage_store (key, count) VALUES (?, 1) ON CONFLICT(key) DO NOTHING').run(key);
    if (!claim.changes) return { sent: false, reason: 'duplicate' };
    const mid = env.GA4_MEASUREMENT_ID || DEFAULT_MEASUREMENT_ID;
    const url = `${MP_URL}?measurement_id=${encodeURIComponent(mid)}&api_secret=${encodeURIComponent(secret)}`;
    let ok = false;
    try {
      const r = await fetchImpl(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) });
      ok = r && r.status >= 200 && r.status < 300;
    } catch (e) { log.error('[ga4] purchase send failed:', e.message); }
    if (!ok) { db.prepare('DELETE FROM usage_store WHERE key = ?').run(key); return { sent: false, reason: 'send_failed' }; }
    return { sent: true, reason: 'ok' };
  } catch (e) {
    log.error('[ga4] purchase tracking error:', e.message);
    return { sent: false, reason: 'error' };
  }
}

module.exports = { buildPurchasePayload, trackPurchase };
