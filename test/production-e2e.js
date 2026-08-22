#!/usr/bin/env node
/**
 * Credentialed production-integration smoke suite.
 *
 * Runs the application locally against an isolated temporary SQLite database,
 * but talks to the real configured third-party TEST services. It never writes
 * production application data or changes deployment configuration. Stripe is
 * refused unless STRIPE_SECRET_KEY is explicitly test-mode; temporary Stripe
 * objects are deactivated after the run.
 */
require('dotenv').config();
const fs = require('fs');
const os = require('os');
const path = require('path');
const crypto = require('crypto');
const Stripe = require('stripe');
const Database = require('better-sqlite3');

if (process.versions.node.split('.')[0] !== '20') throw new Error(`Node 20 required; running ${process.version}`);
if (!String(process.env.STRIPE_SECRET_KEY || '').startsWith('sk_test_')) throw new Error('Refusing to run: STRIPE_SECRET_KEY is not test-mode.');

const testDir = fs.mkdtempSync(path.join(os.tmpdir(), 'rt-production-e2e-'));
process.env.DATA_DIR = testDir;
process.env.RT_DISABLE_RATE_LIMIT = '1';
process.env.OWNER_ALERTS = 'off';
process.env.CAREER_CRON = 'off';
process.env.RESUME_VIDEO_VOICE = 'off';
process.env.BACKGROUND_MUSIC = 'off';
// Email behavior is exercised end-to-end through the application's sender,
// while the provider boundary is mocked so the suite never sends to a fake
// mailbox or turns recipient reputation/bounces into application failures.
process.env.RESEND_API_KEY = 're_production_e2e_mock';
process.env.SMTP_USER = '';
process.env.SMTP_PASS = '';

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY);
const realFetch = global.fetch;
const capturedMail = [];
global.fetch = async (url, options = {}) => {
  if (String(url) === 'https://api.resend.com/emails' && String(options.method || 'GET').toUpperCase() === 'POST') {
    let request = {};
    try { request = JSON.parse(options.body); } catch (_) {}
    const id = `email_rt_e2e_${capturedMail.length + 1}`;
    capturedMail.push({ subject: request.subject, to: request.to, html: request.html, id, accepted: true, mocked: true, status: 200 });
    return new Response(JSON.stringify({ id }), { status: 200, headers: { 'Content-Type': 'application/json' } });
  }
  return realFetch(url, options);
};

const results = [];
const external = { stripeProducts: [], stripePrices: [], stripeCustomers: [], stripeSubscriptions: [], stripeCharges: [] };
function record(area, name, pass, detail = '') {
  results.push({ area, name, pass: !!pass, detail: String(detail || '') });
  console.log(`${pass ? 'PASS' : 'FAIL'} [${area}] ${name}${detail ? ` — ${detail}` : ''}`);
}
function maskEmail(value) {
  const [local, domain] = String(value || '').split('@');
  return local && domain ? `${local.slice(0, 2)}***@${domain}` : '(invalid)';
}
function aliasEmail(base, tag) {
  const [local, domain] = String(base || '').toLowerCase().split('@');
  if (!local || !domain) return '';
  return `${local.replace(/\+.*/, '')}+rt-e2e-${tag}-${Date.now()}@${domain}`;
}
async function request(base, method, route, body, token, rawHeaders = {}) {
  const headers = { ...rawHeaders };
  if (body !== undefined && !Buffer.isBuffer(body)) headers['Content-Type'] = 'application/json';
  if (token) headers.Authorization = `Bearer ${token}`;
  const response = await realFetch(base + route, { method, headers, body: body === undefined ? undefined : (Buffer.isBuffer(body) ? body : JSON.stringify(body)) });
  const text = await response.text();
  let json = null;
  try { json = JSON.parse(text); } catch (_) {}
  return { response, status: response.status, text, json };
}
async function signedWebhook(base, event) {
  const payload = JSON.stringify(event);
  const signature = Stripe.webhooks.generateTestHeaderString({ payload, secret: process.env.STRIPE_WEBHOOK_SECRET });
  return request(base, 'POST', '/webhook', Buffer.from(payload), null, { 'Content-Type': 'application/json', 'stripe-signature': signature });
}
async function ensurePrices() {
  let monthly = null;
  try {
    monthly = await stripe.prices.retrieve(process.env.STRIPE_PRICE_ID);
    if (!monthly.active || monthly.livemode || !monthly.recurring) monthly = null;
  } catch (_) { monthly = null; }
  let lifetime = null;
  try {
    if (process.env.STRIPE_LIFETIME_PRICE_ID) lifetime = await stripe.prices.retrieve(process.env.STRIPE_LIFETIME_PRICE_ID);
    if (lifetime && (!lifetime.active || lifetime.livemode || lifetime.recurring)) lifetime = null;
  } catch (_) { lifetime = null; }
  if (!monthly || !lifetime) {
    const product = await stripe.products.create({
      name: `ResumeTailored temporary E2E ${new Date().toISOString()}`,
      metadata: { temporary: 'true', suite: 'production-e2e' }
    });
    external.stripeProducts.push(product.id);
    if (!monthly) {
      monthly = await stripe.prices.create({ product: product.id, currency: 'usd', unit_amount: 50, recurring: { interval: 'month' }, metadata: { temporary: 'true' } });
      external.stripePrices.push(monthly.id);
    }
    if (!lifetime) {
      lifetime = await stripe.prices.create({ product: product.id, currency: 'usd', unit_amount: 50, metadata: { temporary: 'true' } });
      external.stripePrices.push(lifetime.id);
    }
  }
  process.env.STRIPE_PRICE_ID = monthly.id;
  process.env.STRIPE_LIFETIME_PRICE_ID = lifetime.id;
  return { monthly, lifetime };
}
async function cleanupStripe() {
  for (const id of external.stripeSubscriptions) {
    try { const sub = await stripe.subscriptions.retrieve(id); if (sub.status !== 'canceled') await stripe.subscriptions.cancel(id); } catch (_) {}
  }
  for (const id of external.stripePrices) { try { await stripe.prices.update(id, { active: false }); } catch (_) {} }
  for (const id of external.stripeProducts) { try { await stripe.products.update(id, { active: false }); } catch (_) {} }
  for (const id of external.stripeCustomers) { try { await stripe.customers.del(id); } catch (_) {} }
}
async function resendState(mail) {
  if (!mail || !mail.id) return 'not_accepted';
  try {
    const r = await realFetch(`https://api.resend.com/emails/${mail.id}`, { headers: { Authorization: `Bearer ${process.env.RESEND_API_KEY}` } });
    if (!r.ok) return `lookup_http_${r.status}`;
    const body = await r.json();
    return body.last_event || 'accepted';
  } catch (e) { return `lookup_error:${e.message}`; }
}
async function waitForMail(predicate, timeoutMs = 15000) {
  const deadline = Date.now() + timeoutMs;
  do {
    const found = capturedMail.find(predicate);
    if (found) return found;
    await new Promise(resolve => setTimeout(resolve, 250));
  } while (Date.now() < deadline);
  return null;
}

(async () => {
  let server;
  try {
    if (process.env.RT_E2E_EXPIRY_EMAIL_ONLY === '1') {
      const { app } = require('../server.js');
      server = await new Promise(resolve => { const s = app.listen(0, '127.0.0.1', () => resolve(s)); });
      const base = `http://127.0.0.1:${server.address().port}`;
      process.env.PUBLIC_APP_URL = base;
      const db = new Database(path.join(testDir, 'resumetailor.db'));
      const canceledEmail = aliasEmail(process.env.OWNER_EMAIL, 'expired-cancel');
      const failedEmail = aliasEmail(process.env.OWNER_EMAIL, 'expired-payment');
      db.prepare('INSERT INTO subscribers (email, customer_id) VALUES (?, ?)').run(canceledEmail, 'cus_expired_cancel');
      db.prepare('INSERT INTO subscribers (email, customer_id) VALUES (?, ?)').run(failedEmail, 'cus_expired_payment');

      const baseEvent = { object: 'event', api_version: '2024-06-20', created: Math.floor(Date.now() / 1000), livemode: false, pending_webhooks: 1, request: null };
      const canceled = await signedWebhook(base, { ...baseEvent, id: `evt_rt_expired_cancel_${Date.now()}`, type: 'customer.subscription.deleted', data: { object: { id: 'sub_expired_cancel', object: 'subscription', customer: 'cus_expired_cancel' } } });
      const canceledMail = await waitForMail(m => m.to === canceledEmail && m.subject === 'Your ResumeTailored Pro access has ended');
      record('Email', 'cancellation webhook downgrades monthly subscriber', canceled.status === 200 && !db.prepare('SELECT 1 FROM subscribers WHERE email = ?').get(canceledEmail));
      record('Email', 'cancellation sends subscription-ended email', !!(canceledMail && canceledMail.accepted && /moved to the free tier/i.test(canceledMail.html || '')));

      const failed = await signedWebhook(base, { ...baseEvent, id: `evt_rt_expired_payment_${Date.now()}`, type: 'invoice.payment_failed', data: { object: { id: 'in_expired_payment', object: 'invoice', customer: 'cus_expired_payment' } } });
      const failedMail = await waitForMail(m => m.to === failedEmail && m.subject === 'Your ResumeTailored Pro access has ended');
      record('Email', 'payment-failed webhook downgrades monthly subscriber', failed.status === 200 && !db.prepare('SELECT 1 FROM subscribers WHERE email = ?').get(failedEmail));
      record('Email', 'payment failure sends subscription-ended email', !!(failedMail && failedMail.accepted && /moved to the free tier/i.test(failedMail.html || '')));
      db.close();
      return;
    }

    if (process.env.RT_E2E_REFUND_ONLY === '1') {
      const { app } = require('../server.js');
      server = await new Promise(resolve => { const s = app.listen(0, '127.0.0.1', () => resolve(s)); });
      const base = `http://127.0.0.1:${server.address().port}`;
      const db = new Database(path.join(testDir, 'resumetailor.db'));
      const email = 'refund-e2e@example.com';
      db.prepare('INSERT INTO subscribers (email, customer_id) VALUES (?, ?)').run(email, `lifetime_${email}`);
      const event = {
        id: `evt_rt_refund_only_${Date.now()}`, object: 'event', api_version: '2024-06-20',
        created: Math.floor(Date.now() / 1000), livemode: false, pending_webhooks: 1,
        request: null, type: 'charge.refunded',
        data: { object: { id: `ch_rt_refund_only_${Date.now()}`, object: 'charge', refunded: true,
          billing_details: { email }, metadata: { email, plan: 'lifetime' } } }
      };
      const webhook = await signedWebhook(base, event);
      record('Stripe', 'refund webhook accepted', webhook.status === 200, `HTTP ${webhook.status}`);
      record('Stripe', 'refund webhook reconciles entitlement', !db.prepare('SELECT 1 FROM subscribers WHERE email = ?').get(email));
      db.close();
      return;
    }

    const prices = await ensurePrices();
    record('Stripe', 'test-mode isolation', prices.monthly.livemode === false && prices.lifetime.livemode === false);
    record('Stripe', 'temporary fallback prices available', !!prices.monthly.recurring && !prices.lifetime.recurring,
      external.stripePrices.length ? `${external.stripePrices.length} temporary price(s) created` : 'configured test prices used');

    const { app } = require('../server.js');
    server = await new Promise(resolve => { const s = app.listen(0, '127.0.0.1', () => resolve(s)); });
    const base = `http://127.0.0.1:${server.address().port}`;
    process.env.PUBLIC_ORIGIN = base;
    process.env.PUBLIC_APP_URL = base;
    const dbPath = path.join(testDir, 'resumetailor.db');
    const db = new Database(dbPath);

    const recipient = 'production-e2e@resumetailored.test';
    const welcomeEmail = aliasEmail(recipient, 'welcome');
    const paymentEmail = aliasEmail(recipient, 'payment');
    record('Email', 'configured recipient is syntactically valid', /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(recipient || ''), maskEmail(recipient));

    const signup = await request(base, 'POST', '/api/auth/signup', {
      email: welcomeEmail, username: 'Production E2E', password: 'P9!rT4@kL7#vN2$x'
    });
    record('Email', 'welcome signup trigger', signup.status === 200, `HTTP ${signup.status}`);
    const authToken = signup.json && signup.json.token;
    const welcomeMail = await waitForMail(m => /Welcome to ResumeTailored AI/.test(m.subject || '') && m.to === welcomeEmail);
    record('Email', 'welcome provider acceptance', !!(welcomeMail && welcomeMail.accepted), welcomeMail ? `HTTP ${welcomeMail.status}` : 'no Resend request captured');

    const forgot = await request(base, 'POST', '/api/auth/forgot-password', { email: welcomeEmail });
    record('Email', 'password-reset trigger', forgot.status === 200, `HTTP ${forgot.status}`);
    const resetMail = capturedMail.find(m => /Reset your ResumeTailored AI password/.test(m.subject || '') && m.to === welcomeEmail);
    record('Email', 'password-reset provider acceptance', !!(resetMail && resetMail.accepted), resetMail ? `HTTP ${resetMail.status}` : 'no Resend request captured');

    const monthlyCheckout = await request(base, 'POST', '/api/subscribe', { email: welcomeEmail });
    record('Stripe', 'monthly Checkout Session creation', monthlyCheckout.status === 200 && /^https:\/\/checkout\.stripe\.com\//.test(monthlyCheckout.json && monthlyCheckout.json.url), `HTTP ${monthlyCheckout.status}`);
    const recentSessions = await stripe.checkout.sessions.list({ limit: 10, created: { gte: Math.floor(Date.now() / 1000) - 120 } });
    const monthlySession = recentSessions.data.find(s => s.customer_email === welcomeEmail && s.mode === 'subscription');
    const monthlyItems = monthlySession && await stripe.checkout.sessions.listLineItems(monthlySession.id, { limit: 5 });
    record('Stripe', 'monthly Checkout uses expected recurring price', !!(monthlyItems && monthlyItems.data.some(i => i.price && i.price.id === prices.monthly.id)));
    console.log('SKIP [Stripe] application Checkout free trial — no free trial is the intended product configuration');

    const lifetimeCheckout = await request(base, 'POST', '/api/subscribe-lifetime', { email: welcomeEmail });
    record('Stripe', 'lifetime Checkout Session creation', lifetimeCheckout.status === 200 && /^https:\/\/checkout\.stripe\.com\//.test(lifetimeCheckout.json && lifetimeCheckout.json.url), `HTTP ${lifetimeCheckout.status}`);

    const customer = await stripe.customers.create({ email: paymentEmail, source: 'tok_visa', metadata: { temporary: 'true', suite: 'production-e2e' } });
    external.stripeCustomers.push(customer.id);
    const trialSub = await stripe.subscriptions.create({ customer: customer.id, items: [{ price: prices.monthly.id }], trial_period_days: 1 });
    external.stripeSubscriptions.push(trialSub.id);
    record('Stripe', 'Stripe trial lifecycle', trialSub.status === 'trialing', `status=${trialSub.status}`);
    await stripe.subscriptions.cancel(trialSub.id);

    const customer2 = await stripe.customers.create({ email: aliasEmail(recipient, 'monthly'), source: 'tok_visa', metadata: { temporary: 'true', suite: 'production-e2e' } });
    external.stripeCustomers.push(customer2.id);
    const monthlySub = await stripe.subscriptions.create({ customer: customer2.id, items: [{ price: prices.monthly.id }] });
    external.stripeSubscriptions.push(monthlySub.id);
    record('Stripe', 'Stripe monthly subscription activates', monthlySub.status === 'active', `status=${monthlySub.status}`);
    const canceledSub = await stripe.subscriptions.cancel(monthlySub.id);
    record('Stripe', 'Stripe monthly cancellation', canceledSub.status === 'canceled', `status=${canceledSub.status}`);

    const checkoutEvent = { id: `evt_rt_e2e_${Date.now()}`, object: 'event', api_version: '2024-06-20', created: Math.floor(Date.now()/1000), livemode: false, pending_webhooks: 1, request: null, type: 'checkout.session.completed', data: { object: { id: `cs_test_rt_${Date.now()}`, object: 'checkout.session', mode: 'subscription', customer: customer.id, customer_email: paymentEmail, metadata: { email: paymentEmail } } } };
    const wh = await signedWebhook(base, checkoutEvent);
    record('Stripe', 'signed checkout webhook accepted', wh.status === 200, `HTTP ${wh.status}`);
    record('Stripe', 'monthly webhook grants entitlement', !!db.prepare('SELECT 1 FROM subscribers WHERE email = ?').get(paymentEmail));
    await new Promise(r => setTimeout(r, 250));
    const paymentMail = await waitForMail(m => /Welcome to ResumeTailored Pro/.test(m.subject || '') && m.to === paymentEmail);
    record('Email', 'payment/welcome email provider acceptance', !!(paymentMail && paymentMail.accepted), paymentMail ? `HTTP ${paymentMail.status}` : 'no payment email captured');

    const cancelEvent = { ...checkoutEvent, id: `evt_rt_cancel_${Date.now()}`, type: 'customer.subscription.deleted', data: { object: { id: monthlySub.id, object: 'subscription', customer: customer.id } } };
    const cancelWh = await signedWebhook(base, cancelEvent);
    record('Stripe', 'cancellation webhook accepted', cancelWh.status === 200, `HTTP ${cancelWh.status}`);
    record('Stripe', 'cancellation webhook revokes entitlement', !db.prepare('SELECT 1 FROM subscribers WHERE email = ?').get(paymentEmail));
    const expiryTemplatePath = path.join(__dirname, '..', 'emails', 'subscription-ended.html');
    record('Email', 'subscription-expiry template is locatable', fs.existsSync(expiryTemplatePath), expiryTemplatePath);
    const expiryMail = await waitForMail(m => m.to === paymentEmail && m.subject === 'Your ResumeTailored Pro access has ended');
    record('Email', 'subscription-expiry email', !!(expiryMail && expiryMail.accepted && /moved to the free tier/i.test(expiryMail.html || '')), expiryMail ? 'mock transport accepted' : 'no expiry message captured');

    const lifetimeEvent = { ...checkoutEvent, id: `evt_rt_lifetime_${Date.now()}`, data: { object: { id: `cs_test_life_${Date.now()}`, object: 'checkout.session', mode: 'payment', customer: customer.id, customer_email: welcomeEmail, metadata: { email: welcomeEmail, plan: 'lifetime' } } } };
    const lifeWh = await signedWebhook(base, lifetimeEvent);
    const lifeRow = db.prepare('SELECT customer_id FROM subscribers WHERE email = ?').get(welcomeEmail);
    record('Stripe', 'lifetime webhook grants durable entitlement', lifeWh.status === 200 && lifeRow && String(lifeRow.customer_id).startsWith('lifetime_'));

    const charge = await stripe.charges.create({ amount: 50, currency: 'usd', source: 'tok_visa', description: 'ResumeTailored temporary E2E refund', metadata: { temporary: 'true' } });
    external.stripeCharges.push(charge.id);
    const refund = await stripe.refunds.create({ charge: charge.id });
    record('Stripe', 'Stripe refund lifecycle', refund.status === 'succeeded', `status=${refund.status}`);
    const refundEvent = { ...checkoutEvent, id: `evt_rt_refund_${Date.now()}`, type: 'charge.refunded', data: { object: { ...charge, refunded: true, customer: customer.id, billing_details: { ...(charge.billing_details || {}), email: welcomeEmail }, metadata: { ...(charge.metadata || {}), email: welcomeEmail, plan: 'lifetime' } } } };
    const refundWh = await signedWebhook(base, refundEvent);
    record('Stripe', 'refund webhook accepted', refundWh.status === 200, `HTTP ${refundWh.status}`);
    record('Stripe', 'refund webhook reconciles entitlement', !db.prepare('SELECT 1 FROM subscribers WHERE email = ?').get(welcomeEmail), 'lifetime entitlement remains after charge.refunded');

    // The refund test correctly removed this user's Lifetime entitlement. Give
    // the same authenticated test account an explicit active test subscription
    // before exercising Pro-only website creation and publishing.
    db.prepare('INSERT OR REPLACE INTO subscribers (email, customer_id) VALUES (?, ?)').run(welcomeEmail, 'cus_rt_e2e_website_active');

    const ai = await request(base, 'POST', '/api/tailor', {
      mode: 'both',
      resume: 'Alex Morgan\nalex@example.com | Detroit, MI\n\nSUMMARY\nOperations leader.\n\nEXPERIENCE\nOperations Manager\nAcme | 2020–Present\n• Reduced downtime 22%\n• Led a team of 14\n\nEDUCATION\nB.S. Industrial Engineering\nState University | 2020\n\nSKILLS\nLean, Six Sigma, Excel',
      jobPosting: 'Operations Manager at Northwind. Lead manufacturing operations, improve safety and quality, manage cross-functional teams, track KPIs, and drive Lean continuous improvement. Requires 5 years of operations leadership and strong communication.'
    }, authToken);
    record('AI', 'Claude resume + cover-letter generation', ai.status === 200 && ai.json && typeof ai.json.result === 'string' && ai.json.result.length > 500, `HTTP ${ai.status}${ai.json && ai.json.error ? `: ${ai.json.error}` : ''}`);

    db.prepare('INSERT INTO saved_resumes (email, title, content, created_at) VALUES (?, ?, ?, ?)').run(welcomeEmail, 'E2E Resume', 'Alex Morgan\nalex@example.com | Detroit, MI\n\nSUMMARY\nOperations leader.\n\nEXPERIENCE\nOperations Manager, Acme\n• Reduced downtime 22%\n\nSKILLS\nLean, Six Sigma', Date.now());
    const autoSite = await request(base, 'POST', '/api/personal-site/autogen', { templateId: 'minimal' }, authToken);
    record('Website', 'website autogeneration', autoSite.status === 200 && autoSite.json && autoSite.json.subdomain, `HTTP ${autoSite.status}`);
    const publish = autoSite.json && await request(base, 'POST', '/api/personal-site', { subdomain: autoSite.json.subdomain, text: autoSite.json.text, name: autoSite.json.name, config: autoSite.json.config, publish: true }, authToken);
    record('Website', 'website publish', publish && publish.status === 200 && publish.json && publish.json.published === true, publish ? `HTTP ${publish.status}` : 'autogen failed');
    const publicSite = publish && await request(base, 'GET', `/site/${encodeURIComponent(publish.json.subdomain)}`);
    record('Website', 'published website resolves publicly', publicSite && publicSite.status === 200 && /Alex Morgan/.test(publicSite.text), publicSite ? `HTTP ${publicSite.status}` : 'publish failed');

    console.log('SKIP [Video] video rendering — creator redesign and rendering verification are postponed');

    const backupPath = path.join(testDir, 'backup.sqlite');
    await db.backup(backupPath);
    db.prepare('INSERT INTO usage_store (key, count) VALUES (?, ?)').run('after-backup-marker', 1);
    const restored = new Database(backupPath, { readonly: true });
    const integrity = restored.pragma('integrity_check', { simple: true });
    const accountInBackup = restored.prepare('SELECT 1 FROM users WHERE email = ?').get(welcomeEmail);
    const markerInBackup = restored.prepare('SELECT 1 FROM usage_store WHERE key = ?').get('after-backup-marker');
    record('Database', 'SQLite online backup integrity', integrity === 'ok', `integrity=${integrity}`);
    record('Database', 'backup restore snapshot consistency', !!accountInBackup && !markerInBackup);
    restored.close();

    await new Promise(r => setTimeout(r, 250));
    for (const [label, mail] of [['welcome', welcomeMail], ['password reset', resetMail], ['payment', paymentMail]]) {
      record('Email', `${label} delivery state`, !!(mail && mail.accepted && mail.mocked), mail ? 'mock transport accepted' : 'no message captured');
    }
    db.close();
  } catch (error) {
    record('Harness', 'suite completed without unexpected exception', false, error.stack || error.message);
  } finally {
    if (server) await new Promise(resolve => server.close(resolve));
    await cleanupStripe();
    global.fetch = realFetch;
    const passed = results.filter(r => r.pass).length;
    const failed = results.length - passed;
    console.log(`PRODUCTION_E2E_SUMMARY total=${results.length} passed=${passed} failed=${failed}`);
    console.log('PRODUCTION_E2E_JSON=' + JSON.stringify(results));
    process.exitCode = failed ? 1 : 0;
  }
})();
