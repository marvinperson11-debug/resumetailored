'use strict';
/*
 * clerk-webhook.js — verify and read Clerk (Svix) webhooks, no extra library.
 *
 * Accounts are created in Clerk by the app at app.resumetailored.com, so the legacy
 * /api/auth/signup route (which sends the "New signup" owner alert) never runs for
 * them. Clerk can POST a `user.created` event here instead; this module checks the
 * Svix signature (HMAC-SHA256 over "<id>.<timestamp>.<body>" with the base64 part of
 * the `whsec_…` secret) and pulls out the new user's email and name.
 *
 * Pure: the route in server.js owns the secret, the dedupe store and the mail send.
 */
const crypto = require('crypto');

const TOLERANCE_SECONDS = 5 * 60;

function verifySvix({ secret, id, timestamp, signatureHeader, rawBody, now = Date.now() }) {
  if (!secret || !id || !timestamp || !signatureHeader) return false;
  const ts = Number(timestamp);
  if (!Number.isFinite(ts) || Math.abs(now / 1000 - ts) > TOLERANCE_SECONDS) return false;
  const key = Buffer.from(String(secret).replace(/^whsec_/, ''), 'base64');
  const body = Buffer.isBuffer(rawBody) ? rawBody.toString('utf8') : String(rawBody || '');
  const expected = crypto.createHmac('sha256', key).update(`${id}.${timestamp}.${body}`).digest();
  // Header is a space-separated list like "v1,<base64> v1,<base64>"; any valid v1 entry passes.
  return String(signatureHeader).split(' ').some((part) => {
    const [version, sig] = part.split(',');
    if (version !== 'v1' || !sig) return false;
    const got = Buffer.from(sig, 'base64');
    return got.length === expected.length && crypto.timingSafeEqual(got, expected);
  });
}

/** { email, name, userId } for a `user.created` event, else null. */
function readUserCreated(event) {
  if (!event || event.type !== 'user.created' || !event.data) return null;
  const d = event.data;
  const list = Array.isArray(d.email_addresses) ? d.email_addresses : [];
  const primary = list.find((e) => e && e.id === d.primary_email_address_id) || list[0];
  const email = String((primary && primary.email_address) || '').toLowerCase().trim();
  const name = [d.first_name, d.last_name].filter(Boolean).join(' ').trim() || d.username || '';
  return { email, name: String(name), userId: String(d.id || '') };
}

module.exports = { verifySvix, readUserCreated };
