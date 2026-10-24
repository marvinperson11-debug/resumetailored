#!/usr/bin/env node
/** GA4 key events (signup_completed, pro_checkout_completed): payload shape, dedupe, retry-after-failure, env guard, webhook wiring. */
const fs = require('fs'), path = require('path');
const Database = require('better-sqlite3');
const {
  ga4ClientId, sendGA4Event, trackSignupCompleted, trackProCheckoutCompleted
} = require('../ga4-events');

let failures = 0;
const check = (n, c, d) => { if (c) console.log('PASS  ' + n); else { failures++; console.error('FAIL  ' + n + (d ? ' — ' + d : '')); } };

(async () => {
  const freshDb = () => {
    const db = new Database(':memory:');
    db.exec('CREATE TABLE usage_store (key TEXT PRIMARY KEY, count INTEGER NOT NULL DEFAULT 0)');
    return db;
  };

  // ── client_id scheme: stable, salted, pseudonymous ──
  check('client_id is deterministic for the same seed+salt',
    ga4ClientId('user_123', { GA4_CLIENT_SALT: 'salt-a' }) === ga4ClientId('user_123', { GA4_CLIENT_SALT: 'salt-a' }));
  check('client_id changes with the salt',
    ga4ClientId('user_123', { GA4_CLIENT_SALT: 'salt-a' }) !== ga4ClientId('user_123', { GA4_CLIENT_SALT: 'salt-b' }));
  check('client_id changes with the seed',
    ga4ClientId('user_123', { GA4_CLIENT_SALT: 'salt-a' }) !== ga4ClientId('user_456', { GA4_CLIENT_SALT: 'salt-a' }));
  check('client_id is 32 hex chars (never the raw id)',
    /^[0-9a-f]{32}$/.test(ga4ClientId('user_123', { GA4_CLIENT_SALT: 'salt-a' })) &&
    ga4ClientId('user_123', { GA4_CLIENT_SALT: 'salt-a' }).indexOf('user_123') === -1);

  // ── sendGA4Event payload shape ──
  {
    const calls = []; const ok = async (u, o) => { calls.push({ u, o }); return { status: 204 }; };
    const env = { GA4_API_SECRET: 'sek', GA4_CLIENT_SALT: 's' };
    const r = await sendGA4Event({ eventName: 'signup_completed', params: { signup_source: 'clerk' }, clientId: 'abc123' }, { env, fetchImpl: ok });
    check('sendGA4Event posts to the MP endpoint with measurement_id + api_secret', r.sent &&
      /^https:\/\/www\.google-analytics\.com\/mp\/collect\?measurement_id=G-JWC76X5X68&api_secret=sek$/.test(calls[0].u), calls[0] && calls[0].u);
    const body = JSON.parse(calls[0].o.body);
    check('body carries client_id + the named event', body.client_id === 'abc123' && body.events[0].name === 'signup_completed' && body.events[0].params.signup_source === 'clerk');
    check('a configured GA4_MEASUREMENT_ID overrides the default', (async () => {
      const calls2 = []; const ok2 = async (u) => { calls2.push(u); return { status: 204 }; };
      await sendGA4Event({ eventName: 'x', params: {}, clientId: 'c' }, { env: { GA4_API_SECRET: 'sek', GA4_MEASUREMENT_ID: 'G-OTHER' }, fetchImpl: ok2 });
      return calls2[0].includes('measurement_id=G-OTHER');
    })());
  }

  // ── GA4_DEBUG routes to the validation endpoint ──
  {
    const calls = []; const ok = async (u) => { calls.push(u); return { status: 200 }; };
    await sendGA4Event({ eventName: 'x', params: {}, clientId: 'c' }, { env: { GA4_API_SECRET: 'sek', GA4_DEBUG: 'on' }, fetchImpl: ok });
    check('GA4_DEBUG=on uses /debug/mp/collect', calls[0].startsWith('https://www.google-analytics.com/debug/mp/collect?'), calls[0]);
  }

  // ── Env guard: missing GA4_API_SECRET never throws, never calls, skips silently ──
  {
    const calls = []; const ok = async (u) => { calls.push(u); return { status: 204 }; };
    const r = await sendGA4Event({ eventName: 'signup_completed', params: {}, clientId: 'c' }, { env: {}, fetchImpl: ok, log: { error() {}, log() {} } });
    check('missing GA4_API_SECRET → unconfigured, no call, no throw', r.sent === false && r.reason === 'unconfigured' && calls.length === 0);
  }

  // ── Fire-and-forget: an unreachable/timing-out endpoint never throws ──
  {
    const r = await sendGA4Event({ eventName: 'x', params: {}, clientId: 'c' },
      { env: { GA4_API_SECRET: 'sek' }, fetchImpl: async () => { throw new Error('ETIMEDOUT'); }, log: { error() {} } });
    check('a send error resolves { sent:false }, never throws', r.sent === false);
  }

  // ── trackSignupCompleted: value shape + dedupe on Svix event id ──
  {
    const db = freshDb();
    const calls = []; const ok = async (u, o) => { calls.push({ u, o }); return { status: 204 }; };
    const env = { GA4_API_SECRET: 'sek', GA4_CLIENT_SALT: 'pepper' };

    const r1 = await trackSignupCompleted({ userId: 'user_abc', svixEventId: 'evt_1' }, { db, env, fetchImpl: ok });
    check('first signup delivery sends', r1.sent && calls.length === 1);
    const body1 = JSON.parse(calls[0].o.body);
    check('event name is signup_completed with signup_source=clerk', body1.events[0].name === 'signup_completed' && body1.events[0].params.signup_source === 'clerk');
    check('client_id is the salted hash of the Clerk user id, not the raw id', body1.client_id === ga4ClientId('user_abc', env) && body1.client_id !== 'user_abc');
    check('user_id mirrors client_id when the Clerk id is known', body1.user_id === body1.client_id);

    const r2 = await trackSignupCompleted({ userId: 'user_abc', svixEventId: 'evt_1' }, { db, env, fetchImpl: ok });
    check('same Svix event id redelivered → no second MP call (exactly-once)', !r2.sent && r2.reason === 'duplicate' && calls.length === 1);

    const r3 = await trackSignupCompleted({ userId: 'user_x', svixEventId: 'evt_1' }, { db, env, fetchImpl: ok });
    check('a pre-recorded event id → zero calls even with a different payload', !r3.sent && r3.reason === 'duplicate' && calls.length === 1);

    // Simulated MP 500 → not recorded → redelivery of the SAME event fires once.
    const r4 = await trackSignupCompleted({ userId: 'user_y', svixEventId: 'evt_2' }, { db, env, fetchImpl: async () => ({ status: 500 }), log: { error() {} } });
    check('a failed MP send is not recorded', !r4.sent && r4.reason === 'send_failed');
    const r5 = await trackSignupCompleted({ userId: 'user_y', svixEventId: 'evt_2' }, { db, env, fetchImpl: ok });
    check('redelivery after a failed send fires exactly once', r5.sent && calls.length === 2);

    check('missing svixEventId is rejected before any dedupe write', (await trackSignupCompleted({ userId: 'user_z' }, { db, env, fetchImpl: ok })).reason === 'invalid_event');
  }

  // ── trackProCheckoutCompleted: value/currency/transaction_id + employer-only scope + dedupe on Stripe event id ──
  {
    const db = freshDb();
    const calls = []; const ok = async (u, o) => { calls.push({ u, o }); return { status: 204 }; };
    const env = { GA4_API_SECRET: 'sek', GA4_CLIENT_SALT: 'pepper', CLERK_SECRET_KEY: '' }; // no Clerk lookup configured → falls back to customer id

    const session = {
      id: 'cs_pro_1', payment_status: 'paid', amount_total: 1999, currency: 'usd',
      customer: 'cus_employer_1', metadata: { plan: 'employer', employerTier: 'scale', email: 'buyer@example.com' }
    };
    const r1 = await trackProCheckoutCompleted(session, { eventId: 'evt_stripe_1', db, env, fetchImpl: ok });
    check('paid employer checkout sends pro_checkout_completed', r1.sent && calls.length === 1);
    const body1 = JSON.parse(calls[0].o.body);
    check('value divides cents exactly (1999 → 19.99)', body1.events[0].params.value === 19.99);
    check('currency is uppercased', body1.events[0].params.currency === 'USD');
    check('transaction_id is the checkout session id', body1.events[0].params.transaction_id === 'cs_pro_1');
    check('plan is read from session metadata', body1.events[0].params.plan === 'scale');
    check('client_id falls back to the Stripe customer id when Clerk is unresolvable', body1.client_id === ga4ClientId('cus_employer_1', env));
    check('no user_id when the Clerk id could not be resolved', body1.user_id === undefined);

    const r2 = await trackProCheckoutCompleted(session, { eventId: 'evt_stripe_1', db, env, fetchImpl: ok });
    check('same Stripe event id redelivered → no second MP call', !r2.sent && r2.reason === 'duplicate' && calls.length === 1);

    // Candidate Pro monthly ($19) checkout carries NO plan metadata at all —
    // mode:'subscription' (with employer/lifetime ruled out) is its marker.
    const monthlySession = { id: 'cs_ind_1', payment_status: 'paid', amount_total: 1900, currency: 'usd', mode: 'subscription', customer: 'cus_ind_1', metadata: { email: 'a@b.c' } };
    const r3 = await trackProCheckoutCompleted(monthlySession, { eventId: 'evt_stripe_2', db, env, fetchImpl: ok });
    check('a candidate Pro monthly checkout (no metadata) fires pro_checkout_completed', r3.sent && calls.length === 2);
    const body3 = JSON.parse(calls[calls.length - 1].o.body);
    check('monthly value is 19.00 and currency is uppercased', body3.events[0].params.value === 19 && body3.events[0].params.currency === 'USD');
    check('monthly plan param is the stable derived label pro-monthly', body3.events[0].params.plan === 'pro-monthly');

    // Candidate Pro Lifetime ($129) checkout: mode:'payment' + metadata.plan === 'lifetime'.
    const lifetimeSession = { id: 'cs_life_1', payment_status: 'paid', amount_total: 12900, currency: 'usd', mode: 'payment', customer: 'cus_life_1', metadata: { email: 'c@d.e', plan: 'lifetime' } };
    const r3b = await trackProCheckoutCompleted(lifetimeSession, { eventId: 'evt_stripe_2b', db, env, fetchImpl: ok });
    check('a Lifetime checkout fires pro_checkout_completed with plan=lifetime', r3b.sent && calls.length === 3);
    const body3b = JSON.parse(calls[calls.length - 1].o.body);
    check('lifetime value is 129.00', body3b.events[0].params.value === 129);
    check('lifetime plan param is "lifetime"', body3b.events[0].params.plan === 'lifetime');

    // A non-Pro / unrecognized checkout (neither employer metadata, lifetime
    // marker, nor subscription mode) stays silent — verifies the elimination
    // doesn't fire for a hypothetical future product this catalog doesn't have today.
    const otherSession = { id: 'cs_other_1', payment_status: 'paid', amount_total: 500, currency: 'usd', mode: 'setup', customer: 'cus_other_1', metadata: {} };
    const r3c = await trackProCheckoutCompleted(otherSession, { eventId: 'evt_stripe_2c', db, env, fetchImpl: ok });
    check('an unrecognized non-Pro checkout is not tracked', !r3c.sent && r3c.reason === 'not_pro' && calls.length === 3);

    // Unpaid session never fires, regardless of plan.
    const unpaid = { id: 'cs_unpaid_1', payment_status: 'unpaid', amount_total: 4900, currency: 'usd', metadata: { plan: 'employer' } };
    const r4 = await trackProCheckoutCompleted(unpaid, { eventId: 'evt_stripe_3', db, env, fetchImpl: ok });
    check('an unpaid session never fires', !r4.sent && r4.reason === 'not_paid' && calls.length === 3);

    // Resolved Clerk id takes priority over the Stripe customer id, and is used for both client_id and user_id.
    const session2 = { id: 'cs_pro_2', payment_status: 'paid', amount_total: 4900, currency: 'usd', customer: 'cus_employer_2', metadata: { plan: 'employer', employerTier: 'pro', email: 'buyer2@example.com' } };
    const fetchWithClerk = async (u, o) => {
      if (String(u).startsWith('https://api.clerk.com/v1/users?')) return { ok: true, status: 200, json: async () => [{ id: 'user_clerk_42', email_addresses: [{ email_address: 'buyer2@example.com' }] }] };
      calls.push({ u, o }); return { status: 204 };
    };
    const r5 = await trackProCheckoutCompleted(session2, { eventId: 'evt_stripe_4', db, env: { ...env, CLERK_SECRET_KEY: 'sk_clerk' }, fetchImpl: fetchWithClerk });
    check('resolved Clerk user id is used for client_id when available', r5.sent);
    const body5 = JSON.parse(calls[calls.length - 1].o.body);
    check('client_id uses the resolved Clerk id, not the Stripe customer id', body5.client_id === ga4ClientId('user_clerk_42', env) && body5.client_id !== ga4ClientId('cus_employer_2', env));
    check('user_id mirrors client_id once the Clerk id is known', body5.user_id === body5.client_id);

    // Failed send → not recorded → redelivery of the SAME Stripe event fires once.
    const failSession = { id: 'cs_pro_3', payment_status: 'paid', amount_total: 2900, currency: 'usd', customer: 'cus_employer_3', metadata: { plan: 'employer' } };
    const r6 = await trackProCheckoutCompleted(failSession, { eventId: 'evt_stripe_5', db, env, fetchImpl: async () => ({ status: 500 }), log: { error() {} } });
    check('a failed MP send is not recorded', !r6.sent && r6.reason === 'send_failed');
    const r7 = await trackProCheckoutCompleted(failSession, { eventId: 'evt_stripe_5', db, env, fetchImpl: ok });
    check('redelivery of the same Stripe event after a failed send fires exactly once', r7.sent);
  }

  // ── Wired into both webhook handlers, after the main work, never awaited ──
  {
    const server = fs.readFileSync(path.join(__dirname, '..', 'server.js'), 'utf8');
    const clerkRoute = server.slice(server.indexOf("app.post('/api/clerk-webhook'"), server.indexOf("app.post('/webhook'"));
    check('clerk webhook fires trackGa4Signup after the owner-alert claim', clerkRoute.indexOf('trackGa4Signup(') > clerkRoute.indexOf('ownersignup_'));
    check('trackGa4Signup is not awaited (fire-and-forget)', !/await\s+trackGa4Signup\(/.test(clerkRoute));

    const stripeRoute = server.slice(server.indexOf("if (event.type === 'checkout.session.completed')"), server.indexOf("if (event.type === 'customer.subscription.deleted')"));
    check('stripe webhook fires trackGa4ProCheckout alongside trackGa4Purchase', stripeRoute.indexOf('trackGa4ProCheckout(session') > -1 && stripeRoute.indexOf('trackGa4ProCheckout(session') > stripeRoute.indexOf('trackGa4Purchase(session'));
    check('trackGa4ProCheckout is not awaited (fire-and-forget)', !/await\s+trackGa4ProCheckout\(/.test(stripeRoute));
    check('trackGa4ProCheckout receives the Stripe EVENT id, not the session id', /trackGa4ProCheckout\(session,\s*\{\s*eventId:\s*event\.id/.test(stripeRoute));
  }

  console.log(failures ? failures + ' FAILURE(S)' : 'ALL PASS');
  process.exit(failures ? 1 : 0);
})();
