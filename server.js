require('dotenv').config();
const express = require('express');
const cors = require('cors');
const rateLimit = require('express-rate-limit');
const Anthropic = require('@anthropic-ai/sdk');
const Stripe = require('stripe');
const { v4: uuidv4 } = require('uuid');
const path = require('path');
const crypto = require('crypto');
const fs = require('fs');
const os = require('os');
const multer = require('multer');
const pdfParse = require('pdf-parse');
const mammoth = require('mammoth');
const { Document, Packer, Paragraph, TextRun, HeadingLevel, AlignmentType, BorderStyle, Table, TableRow, TableCell, WidthType, VerticalAlign, ShadingType, HeightRule } = require('docx');
const Database = require('better-sqlite3');
const nodemailer = require('nodemailer');

const app = express();
const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
const stripe = new Stripe(process.env.STRIPE_SECRET_KEY);

// Keep the server alive if a lazy-loaded subsystem throws an *unhandled*
// rejection. The resume-video render (Remotion) can do this — e.g. its headless
// browser download fires a detached promise that rejects outside our try/catch.
// One user's failed video should never take the whole server down for everyone.
process.on('unhandledRejection', (reason) => {
  console.error('Unhandled promise rejection (ignored to keep server up):', reason && reason.message ? reason.message : reason);
});

// Warn loudly on startup if critical env vars are missing
if (!process.env.ANTHROPIC_API_KEY) console.error('STARTUP ERROR: ANTHROPIC_API_KEY is not set — AI tailoring will fail for all users.');
if (!process.env.STRIPE_SECRET_KEY) console.error('STARTUP ERROR: STRIPE_SECRET_KEY is not set — payments will fail.');
if (!process.env.STRIPE_PRICE_ID) console.error('STARTUP ERROR: STRIPE_PRICE_ID is not set — checkout will fail.');

// ─── Email helper ─────────────────────────────────────────────────────────────
// Priority: Resend (RESEND_API_KEY) → SMTP (SMTP_USER + SMTP_PASS) → console log
async function sendEmail({ to, subject, html, replyTo }) {
  const resendKey  = process.env.RESEND_API_KEY;
  const smtpUser   = process.env.SMTP_USER;
  const smtpPass   = process.env.SMTP_PASS;
  const fromAddr   = process.env.EMAIL_FROM || (smtpUser ? smtpUser : 'support@resumetailored.com');
  const ownerEmail = process.env.OWNER_EMAIL || 'support@resumetailored.com';
  // Always set a Reply-To so replies don't bounce back to the sending domain
  const effectiveReplyTo = replyTo || ownerEmail;

  if (resendKey) {
    const r = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${resendKey}` },
      body: JSON.stringify({ from: `ResumeTailored AI <${fromAddr}>`, to, subject, html, reply_to: effectiveReplyTo })
    });
    if (r.ok) { console.log(`[Resend] Email sent to ${to}`); return; }
    const err = await r.json().catch(() => ({}));
    console.error('[Resend] Failed:', r.status, JSON.stringify(err));
    // fall through to SMTP if configured
  }

  if (smtpUser && smtpPass) {
    const transporter = nodemailer.createTransport({
      host: process.env.SMTP_HOST || 'smtp.gmail.com',
      port: parseInt(process.env.SMTP_PORT || '587'),
      secure: process.env.SMTP_SECURE === 'true',
      auth: { user: smtpUser, pass: smtpPass }
    });
    await transporter.sendMail({ from: `ResumeTailored AI <${fromAddr || smtpUser}>`, to, subject, html, replyTo: effectiveReplyTo });
    console.log(`[SMTP] Email sent to ${to}`);
    return;
  }

  // Neither configured — log the content so it can be found in Railway logs
  console.log(`[EMAIL] No sender configured. Subject: "${subject}" To: ${to}`);
  console.log('[EMAIL] Set RESEND_API_KEY or SMTP_USER+SMTP_PASS in Railway env vars to enable real emails.');
}

// ─── Owner activity alerts ────────────────────────────────────────────────────
// Fire-and-forget email to the site owner whenever something notable happens
// (new signup, tailoring, new/cancelled subscription, …). Never blocks or
// throws into the request path. Set OWNER_EMAIL to your inbox + RESEND_API_KEY
// (or SMTP_*) in Railway for these to actually arrive. Set OWNER_ALERTS=off to
// silence all activity alerts without touching the call sites.
function notifyOwner(subject, html) {
  if (process.env.OWNER_ALERTS === 'off') return;
  const ownerEmail = process.env.OWNER_EMAIL || 'support@resumetailored.com';
  const stamp = `<p style="color:#888;font-size:12px;">Time: ${new Date().toUTCString()}</p>`;
  sendEmail({ to: ownerEmail, subject, html: html + stamp })
    .catch(err => console.error('[Alert] Owner notification failed:', err.message));
}

// ─── SQLite database ──────────────────────────────────────────────────────────
// DATA_DIR defaults to ./data; set DATA_DIR=/data and mount a Railway Volume
// at /data for full persistence across deploys.
const dataDir = process.env.DATA_DIR || path.join(__dirname, 'data');
if (!fs.existsSync(dataDir)) fs.mkdirSync(dataDir, { recursive: true });
const db = new Database(path.join(dataDir, 'resumetailor.db'));
db.pragma('journal_mode = WAL');

db.exec(`
  CREATE TABLE IF NOT EXISTS users (
    email         TEXT PRIMARY KEY,
    username      TEXT NOT NULL,
    password_hash TEXT NOT NULL
  );
  CREATE TABLE IF NOT EXISTS sessions (
    token TEXT PRIMARY KEY,
    email TEXT NOT NULL
  );
  CREATE TABLE IF NOT EXISTS reset_tokens (
    token      TEXT PRIMARY KEY,
    email      TEXT NOT NULL,
    expires_at INTEGER NOT NULL
  );
  CREATE TABLE IF NOT EXISTS subscribers (
    email       TEXT PRIMARY KEY,
    customer_id TEXT NOT NULL
  );
  CREATE TABLE IF NOT EXISTS usage_store (
    key   TEXT PRIMARY KEY,
    count INTEGER NOT NULL DEFAULT 0
  );
  CREATE TABLE IF NOT EXISTS check_ins (
    email        TEXT PRIMARY KEY,
    last_check_in TEXT,
    goals        TEXT DEFAULT '',
    current_role TEXT DEFAULT '',
    target_role  TEXT DEFAULT '',
    next_prompt  TEXT DEFAULT ''
  );
  CREATE TABLE IF NOT EXISTS forum_posts (
    id     INTEGER PRIMARY KEY AUTOINCREMENT,
    author TEXT NOT NULL DEFAULT 'Anonymous',
    role   TEXT NOT NULL DEFAULT 'Professional',
    time   TEXT NOT NULL DEFAULT 'just now',
    text   TEXT NOT NULL,
    likes  INTEGER NOT NULL DEFAULT 0
  );
  CREATE TABLE IF NOT EXISTS forum_replies (
    id      INTEGER PRIMARY KEY AUTOINCREMENT,
    post_id INTEGER NOT NULL,
    author  TEXT NOT NULL DEFAULT 'Anonymous',
    text    TEXT NOT NULL,
    time    TEXT NOT NULL DEFAULT 'just now'
  );
  CREATE TABLE IF NOT EXISTS saved_resumes (
    id         INTEGER PRIMARY KEY AUTOINCREMENT,
    email      TEXT NOT NULL,
    title      TEXT NOT NULL DEFAULT 'Resume',
    content    TEXT NOT NULL,
    created_at INTEGER NOT NULL
  );
  CREATE INDEX IF NOT EXISTS idx_saved_resumes_email ON saved_resumes(email);
`);

// Seed default forum posts on first run
if (db.prepare('SELECT COUNT(*) as c FROM forum_posts').get().c === 0) {
  const ins = db.prepare('INSERT INTO forum_posts (author, role, time, text, likes) VALUES (?, ?, ?, ?, ?)');
  ins.run('Sarah M.', 'Software Engineer', '2 hours ago', 'Just accepted an offer at a Fortune 500! ResumeTailored helped me tailor 30+ applications. Happy to answer questions about the process.', 14);
  ins.run('James R.', 'Marketing Manager', '5 hours ago', 'Salary negotiation tip: always get the offer in writing before negotiating. They said my ask was "too high" verbally but came back with 8% more once I sent a counter via email. Never negotiate on the phone!', 22);
  ins.run('Priya K.', 'Product Designer', '1 day ago', 'For anyone in tech design — portfolio matters MORE than your resume. But a tailored resume got me the interview so I could show my portfolio. Both matter!', 9);
}

// ─── Password hashing ──────────────────────────────────────────────────────
// New hashes use bcrypt (per-record salt, slow). Legacy accounts created before
// this migration used a single static-salt SHA-256 ("rta_salt_2026_" + pw) — we
// still VERIFY those so nobody is locked out, and transparently re-hash them to
// bcrypt on their next successful login (lazy migration; no forced reset).
const bcrypt = require('bcryptjs');
const BCRYPT_ROUNDS = 10;

function legacyHashPw(pw) {
  return crypto.createHash('sha256').update('rta_salt_2026_' + pw).digest('hex');
}

// True for stored hashes still in the old SHA-256 format (bcrypt hashes start "$2").
function isLegacyHash(stored) {
  return typeof stored === 'string' && !stored.startsWith('$2');
}

// Hash a new/changed password with bcrypt.
function hashPassword(pw) {
  return bcrypt.hashSync(pw, BCRYPT_ROUNDS);
}

// Verify a plaintext password against a stored hash of either format.
function verifyPassword(pw, stored) {
  if (!stored) return false;
  if (isLegacyHash(stored)) return legacyHashPw(pw) === stored;
  try { return bcrypt.compareSync(pw, stored); } catch { return false; }
}

app.set('trust proxy', 1); // Required on Railway — reads real client IP from X-Forwarded-For
app.use(cors());

// Force UTF-8 charset on text/html responses.
// Intercepts res.setHeader() — the moment Content-Type is assigned — so the
// charset is baked in before any streaming, piping, or flushing can happen.
// This is upstream of res.write() and res.end() so nothing can override it.
app.use((req, res, next) => {
  const origSetHeader = res.setHeader.bind(res);
  res.setHeader = function (name, value) {
    if (typeof name === 'string' &&
        name.toLowerCase() === 'content-type' &&
        typeof value === 'string' &&
        value.startsWith('text/html') &&
        !value.includes('charset')) {
      value += '; charset=utf-8';
    }
    return origSetHeader(name, value);
  };
  next();
});

// Redirect .html-extension URLs to their canonical clean-URL equivalents (prevents duplicate-content penalties)
app.use((req, res, next) => {
  if (req.path.endsWith('/index.html')) {
    const dir = req.path.slice(0, -'index.html'.length).replace(/\/$/, '') || '/';
    return res.redirect(301, dir + req.url.slice(req.path.length));
  }
  if (req.path.endsWith('.html')) {
    const clean = req.path.slice(0, -5) || '/';
    return res.redirect(301, clean + req.url.slice(req.path.length));
  }
  next();
});

// Redirect /app -> /dashboard. Must run BEFORE express.static, otherwise the
// static handler serves public/app.html for /app and shadows this redirect.
app.get('/app', (req, res) => res.redirect(301, '/dashboard'));

app.use(express.static(path.join(__dirname, 'public'), {
  extensions: ['html'],
  setHeaders: (res, filePath) => {
    if (filePath.endsWith('.html')) res.setHeader('Content-Type', 'text/html; charset=utf-8');
    else if (filePath.endsWith('.css')) res.setHeader('Content-Type', 'text/css; charset=utf-8');
    else if (filePath.endsWith('.js')) res.setHeader('Content-Type', 'application/javascript; charset=utf-8');
  }
}));

// Clean URL aliases — /dashboard, /login, /signup all serve app.html
const appHtml = path.join(__dirname, 'public', 'app.html');
const _htmlUtf8 = { headers: { 'Content-Type': 'text/html; charset=utf-8' } };
app.get('/dashboard',    (req, res) => res.sendFile(appHtml, _htmlUtf8));
app.get('/login',        (req, res) => res.sendFile(appHtml, _htmlUtf8));
app.get('/signup',       (req, res) => res.sendFile(appHtml, _htmlUtf8));
app.get('/about',        (req, res) => res.redirect(301, '/how-it-works'));
// Live in-browser video preview (Remotion Player — plays client-side, no render)
app.get('/preview',      (req, res) => res.sendFile(path.join(__dirname, 'public', 'preview.html'), _htmlUtf8));
const blogIndexHtml = path.join(__dirname, 'public', 'blog', 'index.html');
app.get('/blog',         (req, res) => res.sendFile(blogIndexHtml, _htmlUtf8));

// Raw body needed for Stripe webhook verification
app.use('/webhook', express.raw({ type: 'application/json' }));
app.use(express.json());

// ─── Rate limiting ────────────────────────────────────────────────────────────
const apiLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 30,
  message: { error: 'Too many requests, please slow down.' }
});
app.use('/api/', apiLimiter);

// ─── Auth endpoints ───────────────────────────────────────────────────────────
app.post('/api/auth/signup', async (req, res) => {
  const { email, username, password } = req.body;
  if (!email || !username || !password) {
    return res.status(400).json({ error: 'Email, username, and password are required.' });
  }
  if (password.length < 6) {
    return res.status(400).json({ error: 'Password must be at least 6 characters.' });
  }
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    return res.status(400).json({ error: 'Please enter a valid email address.' });
  }
  const key = email.toLowerCase().trim();
  if (db.prepare('SELECT 1 FROM users WHERE email = ?').get(key)) {
    return res.status(409).json({ error: 'An account with this email already exists. Please log in.' });
  }
  const cleanUsername = username.trim().slice(0, 30);
  db.prepare('INSERT INTO users (email, username, password_hash) VALUES (?, ?, ?)').run(key, cleanUsername, hashPassword(password));
  const token = uuidv4();
  db.prepare('INSERT INTO sessions (token, email) VALUES (?, ?)').run(token, key);
  res.json({ token, username: cleanUsername, email: key });

  notifyOwner(`[ResumeTailored] New signup: ${key}`,
    `<p>🎉 <strong>${cleanUsername}</strong> (${key}) just created an account.</p>`);

  // Welcome email — fire and forget, don't block the response
  try {
    await sendEmail({
      to: key,
      subject: 'Welcome to ResumeTailored AI — You\'re in!',
      html: `
        <div style="font-family:'Inter',Arial,sans-serif;max-width:560px;margin:0 auto;background:#ffffff;border:1px solid #e5e7eb;border-radius:16px;overflow:hidden;">

          <!-- Header -->
          <div style="background:linear-gradient(135deg,#2563eb 0%,#1d4ed8 100%);padding:36px 32px;">
            <div style="display:inline-flex;align-items:center;gap:10px;margin-bottom:20px;">
              <div style="width:40px;height:40px;background:rgba(255,255,255,0.2);border-radius:10px;display:inline-flex;align-items:center;justify-content:center;font-size:20px;font-weight:900;color:#fff;">R</div>
              <span style="font-size:20px;font-weight:800;color:#fff;">ResumeTailored <span style="background:rgba(255,255,255,0.25);padding:2px 8px;border-radius:5px;font-size:12px;">AI</span></span>
            </div>
            <div style="font-size:28px;font-weight:900;color:#fff;line-height:1.2;">Welcome aboard, ${cleanUsername}!</div>
            <div style="font-size:15px;color:rgba(255,255,255,0.8);margin-top:8px;">Your account is ready. Let's land that next job.</div>
          </div>

          <!-- Body -->
          <div style="padding:36px 32px;">
            <p style="font-size:15px;color:#374151;line-height:1.75;margin:0 0 28px;">
              Thanks for joining ResumeTailored AI. You now have access to AI-powered resume tailoring, cover letter generation, and a full career hub — all built to help you stand out and get hired faster.
            </p>

            <!-- Features -->
            <div style="margin-bottom:28px;">
              <div style="font-size:11px;font-weight:800;text-transform:uppercase;letter-spacing:1.5px;color:#9ca3af;margin-bottom:16px;">What's waiting for you</div>
              <div style="display:grid;gap:12px;">

                <div style="display:flex;gap:14px;align-items:flex-start;background:#f9fafb;border:1px solid #e5e7eb;border-radius:10px;padding:14px 16px;">
                  <div style="font-size:22px;line-height:1;">✦</div>
                  <div>
                    <div style="font-weight:700;color:#111827;font-size:14px;margin-bottom:3px;">AI Resume Tailor</div>
                    <div style="font-size:13px;color:#6b7280;line-height:1.6;">Paste any job posting and get a resume tailored to match — highlighting the right keywords and experience to beat ATS filters.</div>
                  </div>
                </div>

                <div style="display:flex;gap:14px;align-items:flex-start;background:#f9fafb;border:1px solid #e5e7eb;border-radius:10px;padding:14px 16px;">
                  <div style="font-size:22px;line-height:1;">✉</div>
                  <div>
                    <div style="font-weight:700;color:#111827;font-size:14px;margin-bottom:3px;">Cover Letter Generator</div>
                    <div style="font-size:13px;color:#6b7280;line-height:1.6;">Generate a personalized, professional cover letter for every application in seconds — not the same generic template everyone else uses.</div>
                  </div>
                </div>

                <div style="display:flex;gap:14px;align-items:flex-start;background:#f9fafb;border:1px solid #e5e7eb;border-radius:10px;padding:14px 16px;">
                  <div style="font-size:22px;line-height:1;">💼</div>
                  <div>
                    <div style="font-weight:700;color:#111827;font-size:14px;margin-bottom:3px;">Career Hub</div>
                    <div style="font-size:13px;color:#6b7280;line-height:1.6;">Salary guides, career check-ins, a community forum, and professional resume templates — everything you need in one place.</div>
                  </div>
                </div>

              </div>
            </div>

            <!-- Pricing callout -->
            <div style="background:#eff6ff;border:1px solid #bfdbfe;border-radius:12px;padding:20px 20px;margin-bottom:28px;">
              <div style="font-size:13px;font-weight:800;text-transform:uppercase;letter-spacing:1px;color:#2563eb;margin-bottom:10px;">Your Plan</div>
              <div style="display:flex;justify-content:space-between;align-items:center;flex-wrap:wrap;gap:10px;">
                <div>
                  <div style="font-size:16px;font-weight:700;color:#111827;">Free Tier</div>
                  <div style="font-size:13px;color:#6b7280;margin-top:3px;">1 free AI tailoring per day · Full template access</div>
                </div>
                <a href="https://resumetailored.com/#pricing" style="display:inline-block;background:#2563eb;color:#fff;font-weight:700;font-size:13px;padding:10px 20px;border-radius:8px;text-decoration:none;white-space:nowrap;">Upgrade to Pro — $19/mo →</a>
              </div>
            </div>

            <!-- CTA -->
            <div style="text-align:center;margin-bottom:28px;">
              <a href="https://resumetailored.com/dashboard" style="display:inline-block;background:#2563eb;color:#fff;font-weight:700;font-size:16px;padding:15px 40px;border-radius:10px;text-decoration:none;">Go to My Dashboard →</a>
            </div>

            <!-- Contact -->
            <div style="border-top:1px solid #e5e7eb;padding-top:20px;">
              <div style="font-size:13px;color:#6b7280;line-height:1.7;text-align:center;">
                Questions? We're here to help.<br/>
                <a href="mailto:support@resumetailored.com" style="color:#2563eb;font-weight:600;text-decoration:none;">support@resumetailored.com</a>
              </div>
            </div>
          </div>

          <!-- Footer -->
          <div style="background:#f9fafb;border-top:1px solid #e5e7eb;padding:16px 32px;text-align:center;">
            <span style="font-size:12px;color:#9ca3af;">© ResumeTailored AI · <a href="https://resumetailored.com" style="color:#2563eb;text-decoration:none;">resumetailored.com</a> · You're receiving this because you just created an account.</span>
          </div>

        </div>
      `
    });
  } catch(err) {
    console.error('[Email] Failed to send welcome email:', err.message);
  }
});

app.post('/api/auth/login', (req, res) => {
  const { email, password } = req.body;
  if (!email || !password) {
    return res.status(400).json({ error: 'Email and password are required.' });
  }
  const key = email.toLowerCase().trim();
  const user = db.prepare('SELECT * FROM users WHERE email = ?').get(key);
  if (!user || !verifyPassword(password, user.password_hash)) {
    return res.status(401).json({ error: 'Invalid email or password.' });
  }
  // Lazy migration: re-hash legacy SHA-256 accounts to bcrypt on successful login.
  if (isLegacyHash(user.password_hash)) {
    try {
      db.prepare('UPDATE users SET password_hash = ? WHERE email = ?').run(hashPassword(password), key);
    } catch (e) { console.error('[auth] lazy bcrypt migration failed for', key, e.message); }
  }
  const token = uuidv4();
  db.prepare('INSERT INTO sessions (token, email) VALUES (?, ?)').run(token, key);
  res.json({ token, username: user.username, email: key });

  const ownerEmail = process.env.OWNER_EMAIL || 'support@resumetailored.com';
  sendEmail({
    to: ownerEmail,
    subject: `[ResumeTailored] Login: ${key}`,
    html: `<p><strong>${key}</strong> just logged in.</p><p>Time: ${new Date().toUTCString()}</p>`
  }).catch(err => console.error('[Alert] Login email failed:', err.message));
});

app.get('/api/auth/me', (req, res) => {
  const token = (req.headers.authorization || '').replace('Bearer ', '');
  const row = token && db.prepare('SELECT email FROM sessions WHERE token = ?').get(token);
  if (!row) return res.status(401).json({ error: 'Not authenticated.' });
  const user = db.prepare('SELECT username FROM users WHERE email = ?').get(row.email);
  res.json({ email: row.email, username: user ? user.username : '' });
});

app.post('/api/auth/logout', (req, res) => {
  const token = (req.headers.authorization || '').replace('Bearer ', '');
  if (token) db.prepare('DELETE FROM sessions WHERE token = ?').run(token);
  res.json({ success: true });
});

// ── Saved resumes (per signed-in user, so they're available on every device) ──
function emailFromToken(req) {
  const token = (req.headers.authorization || '').replace('Bearer ', '');
  if (!token) return null;
  const row = db.prepare('SELECT email FROM sessions WHERE token = ?').get(token);
  return row ? row.email : null;
}

// List the signed-in user's saved resumes, most recent first.
app.get('/api/resumes', (req, res) => {
  const email = emailFromToken(req);
  if (!email) return res.status(401).json({ error: 'Please sign in.' });
  const rows = db.prepare('SELECT id, title, content, created_at FROM saved_resumes WHERE email = ? ORDER BY created_at DESC').all(email);
  res.json({ resumes: rows });
});

// Save a tailored resume (dedupes identical content; keeps the latest 20).
app.post('/api/resumes', (req, res) => {
  const email = emailFromToken(req);
  if (!email) return res.status(401).json({ error: 'Please sign in.' });
  const content = (req.body && typeof req.body.content === 'string') ? req.body.content.trim() : '';
  if (content.length < 40) return res.status(400).json({ error: 'Resume content is required.' });
  const rawTitle = (req.body && typeof req.body.title === 'string' && req.body.title.trim())
    ? req.body.title.trim()
    : (content.split('\n').find((l) => l.trim()) || 'Resume').trim();
  const title = rawTitle.slice(0, 80);
  db.prepare('DELETE FROM saved_resumes WHERE email = ? AND content = ?').run(email, content);
  const info = db.prepare('INSERT INTO saved_resumes (email, title, content, created_at) VALUES (?, ?, ?, ?)')
    .run(email, title, content.slice(0, 60000), Date.now());
  db.prepare('DELETE FROM saved_resumes WHERE email = ? AND id NOT IN (SELECT id FROM saved_resumes WHERE email = ? ORDER BY created_at DESC LIMIT 20)').run(email, email);
  res.json({ success: true, id: info.lastInsertRowid, title });
});

// Delete one of the user's saved resumes.
app.delete('/api/resumes/:id', (req, res) => {
  const email = emailFromToken(req);
  if (!email) return res.status(401).json({ error: 'Please sign in.' });
  db.prepare('DELETE FROM saved_resumes WHERE id = ? AND email = ?').run(req.params.id, email);
  res.json({ success: true });
});

app.post('/api/auth/forgot-password', async (req, res) => {
  const { email } = req.body;
  if (!email) return res.status(400).json({ error: 'Email is required.' });
  const key = email.toLowerCase().trim();

  if (!db.prepare('SELECT 1 FROM users WHERE email = ?').get(key)) {
    // No account found — send a helpful email so the user isn't left wondering
    try {
      await sendEmail({
        to: key,
        subject: 'ResumeTailored AI — No Account Found',
        html: `
          <div style="font-family:'Inter',Arial,sans-serif;max-width:520px;margin:0 auto;background:#ffffff;border:1px solid #e5e7eb;border-radius:16px;overflow:hidden;">
            <div style="background:#2563eb;padding:28px 32px;">
              <div style="display:inline-flex;align-items:center;gap:10px;">
                <div style="width:36px;height:36px;background:rgba(255,255,255,0.2);border-radius:8px;display:inline-flex;align-items:center;justify-content:center;font-size:18px;font-weight:900;color:#fff;">R</div>
                <span style="font-size:18px;font-weight:800;color:#fff;">ResumeTailored <span style="background:rgba(255,255,255,0.25);padding:2px 7px;border-radius:5px;font-size:11px;">AI</span></span>
              </div>
            </div>
            <div style="padding:36px 32px;">
              <div style="font-size:36px;text-align:center;margin-bottom:16px;">🔍</div>
              <h2 style="font-size:22px;font-weight:800;color:#111827;text-align:center;margin:0 0 12px;">No Account Found</h2>
              <p style="font-size:15px;color:#6b7280;line-height:1.7;text-align:center;margin:0 0 28px;">
                We couldn't find an account linked to <strong style="color:#111827;">${key}</strong>.<br/>
                You may need to create a new account — it only takes a minute.
              </p>
              <div style="text-align:center;margin-bottom:28px;">
                <a href="https://resumetailored.com/signup" style="display:inline-block;background:#2563eb;color:#fff;font-weight:700;font-size:16px;padding:14px 36px;border-radius:10px;text-decoration:none;">Create Account →</a>
              </div>
              <p style="font-size:13px;color:#9ca3af;text-align:center;line-height:1.6;margin:0;">
                If you believe this is an error, please contact us at <a href="mailto:support@resumetailored.com" style="color:#2563eb;">support@resumetailored.com</a>
              </p>
            </div>
            <div style="background:#f9fafb;border-top:1px solid #e5e7eb;padding:16px 32px;text-align:center;">
              <span style="font-size:12px;color:#9ca3af;">© ResumeTailored AI · <a href="https://resumetailored.com" style="color:#2563eb;text-decoration:none;">resumetailored.com</a></span>
            </div>
          </div>
        `
      });
    } catch(err) {
      console.error('[Email] Failed to send no-account email:', err.message);
    }
    return res.json({ success: true });
  }

  const token = uuidv4();
  const expiresAt = Date.now() + 60 * 60 * 1000; // 1 hour
  db.prepare('INSERT OR REPLACE INTO reset_tokens (token, email, expires_at) VALUES (?, ?, ?)').run(token, key, expiresAt);

  const origin = req.headers.origin || 'https://resumetailored.com';
  const resetUrl = `${origin}/reset-password.html?token=${token}`;

  console.log(`[PASSWORD RESET] Link for ${key}: ${resetUrl}`);

  const ownerEmail = process.env.OWNER_EMAIL || 'support@resumetailored.com';
  const resetEmailHtml = `
    <div style="font-family:'Inter',Arial,sans-serif;max-width:520px;margin:0 auto;background:#ffffff;border:1px solid #e5e7eb;border-radius:16px;overflow:hidden;">
      <div style="background:#2563eb;padding:28px 32px;">
        <div style="display:inline-flex;align-items:center;gap:10px;">
          <div style="width:36px;height:36px;background:rgba(255,255,255,0.2);border-radius:8px;display:inline-flex;align-items:center;justify-content:center;font-size:18px;font-weight:900;color:#fff;">R</div>
          <span style="font-size:18px;font-weight:800;color:#fff;">ResumeTailored <span style="background:rgba(255,255,255,0.25);padding:2px 7px;border-radius:5px;font-size:11px;">AI</span></span>
        </div>
      </div>
      <div style="padding:36px 32px;">
        <div style="font-size:36px;text-align:center;margin-bottom:16px;">🔐</div>
        <h2 style="font-size:22px;font-weight:800;color:#111827;text-align:center;margin:0 0 12px;">Reset Your Password</h2>
        <p style="font-size:15px;color:#6b7280;line-height:1.7;text-align:center;margin:0 0 28px;">
          We received a request to reset the password for <strong style="color:#111827;">${key}</strong>.<br/>
          This link expires in <strong style="color:#2563eb;">1 hour</strong>.
        </p>
        <div style="text-align:center;margin-bottom:28px;">
          <a href="${resetUrl}" style="display:inline-block;background:#2563eb;color:#fff;font-weight:700;font-size:16px;padding:14px 36px;border-radius:10px;text-decoration:none;">Reset My Password →</a>
        </div>
        <p style="font-size:13px;color:#9ca3af;text-align:center;line-height:1.6;margin:0;">
          If you didn't request this, you can safely ignore this email.<br/>
          Link not working? <a href="${resetUrl}" style="color:#2563eb;word-break:break-all;">${resetUrl}</a>
        </p>
      </div>
      <div style="background:#f9fafb;border-top:1px solid #e5e7eb;padding:16px 32px;text-align:center;">
        <span style="font-size:12px;color:#9ca3af;">© ResumeTailored AI · <a href="https://resumetailored.com" style="color:#2563eb;text-decoration:none;">resumetailored.com</a></span>
      </div>
    </div>
  `;

  try {
    await sendEmail({ to: key, subject: 'Reset your ResumeTailored AI password', html: resetEmailHtml });
  } catch (err) {
    console.error('[Email] Failed to send reset email to user:', err.message);
  }

  // Notify owner of every reset request
  try {
    await sendEmail({
      to: ownerEmail,
      subject: `[ResumeTailored] Password reset requested — ${key}`,
      html: `
        <div style="font-family:Arial,sans-serif;max-width:480px;margin:0 auto;background:#fff;border:1px solid #e5e7eb;border-radius:12px;padding:28px 32px;">
          <h3 style="color:#111827;margin:0 0 16px;">🔔 Password Reset Request</h3>
          <p style="color:#374151;font-size:15px;margin:0 0 12px;">A user has requested a password reset on ResumeTailored AI.</p>
          <table style="width:100%;border-collapse:collapse;font-size:14px;">
            <tr><td style="padding:8px 0;color:#6b7280;width:100px;">Email:</td><td style="padding:8px 0;font-weight:700;color:#111827;">${key}</td></tr>
            <tr><td style="padding:8px 0;color:#6b7280;">Time:</td><td style="padding:8px 0;color:#374151;">${new Date().toUTCString()}</td></tr>
          </table>
          <p style="font-size:13px;color:#9ca3af;margin:16px 0 0;">This is an automated notification from ResumeTailored AI.</p>
        </div>
      `
    });
  } catch (err) {
    console.error('[Email] Failed to send owner reset notification:', err.message);
  }

  res.json({ success: true });
});

app.get('/api/auth/verify-reset-token', (req, res) => {
  const { token } = req.query;
  if (!token) return res.json({ valid: false });
  const record = db.prepare('SELECT expires_at FROM reset_tokens WHERE token = ?').get(token);
  if (!record || Date.now() > record.expires_at) return res.json({ valid: false });
  res.json({ valid: true });
});

app.post('/api/auth/reset-password', (req, res) => {
  const { token, password } = req.body;
  if (!token || !password) return res.status(400).json({ error: 'Token and new password are required.' });
  if (password.length < 6) return res.status(400).json({ error: 'Password must be at least 6 characters.' });

  const record = db.prepare('SELECT email, expires_at FROM reset_tokens WHERE token = ?').get(token);
  if (!record) return res.status(400).json({ error: 'This reset link is invalid or has already been used.' });
  if (Date.now() > record.expires_at) {
    db.prepare('DELETE FROM reset_tokens WHERE token = ?').run(token);
    return res.status(400).json({ error: 'This reset link has expired. Please request a new one.' });
  }

  if (!db.prepare('SELECT 1 FROM users WHERE email = ?').get(record.email)) {
    return res.status(400).json({ error: 'Account not found.' });
  }

  db.prepare('UPDATE users SET password_hash = ? WHERE email = ?').run(hashPassword(password), record.email);
  db.prepare('DELETE FROM reset_tokens WHERE token = ?').run(token);
  db.prepare('DELETE FROM sessions WHERE email = ?').run(record.email);

  res.json({ success: true });
});

// ─── File upload config ───────────────────────────────────────────────────────
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 10 * 1024 * 1024 }, // 10 MB max
  fileFilter: (req, file, cb) => {
    const allowed = ['text/plain', 'application/pdf',
      'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      'application/msword'];
    const ext = (file.originalname || '').toLowerCase().split('.').pop();
    if (allowed.includes(file.mimetype) || ['txt','pdf','doc','docx'].includes(ext)) {
      cb(null, true);
    } else {
      cb(new Error('Only .txt, .pdf, .doc, and .docx files are supported.'));
    }
  }
});

// ─── API: Extract text from uploaded resume ───────────────────────────────────
// multer 2.x surfaces upload problems (rejected file type, size-limit) as errors
// passed to the middleware callback. Wrap upload.single so they return a clean
// 4xx JSON response instead of falling through to Express's default 500 HTML.
function uploadSingleFile(req, res, next) {
  upload.single('file')(req, res, (err) => {
    if (err) {
      const isMulterErr = err instanceof multer.MulterError;
      const msg = err.code === 'LIMIT_FILE_SIZE'
        ? 'File is too large. Maximum size is 10 MB.'
        : err.message || 'Upload failed.';
      return res.status(400).json({ error: msg, code: isMulterErr ? err.code : 'INVALID_FILE' });
    }
    next();
  });
}

app.post('/api/extract-text', uploadSingleFile, async (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'No file uploaded.' });
  const ext = (req.file.originalname || '').toLowerCase().split('.').pop();
  try {
    let text = '';
    if (ext === 'txt') {
      text = req.file.buffer.toString('utf-8');
    } else if (ext === 'pdf') {
      const data = await pdfParse(req.file.buffer);
      text = data.text;
    } else if (ext === 'docx' || ext === 'doc') {
      const result = await mammoth.extractRawText({ buffer: req.file.buffer });
      text = result.value;
    } else {
      return res.status(400).json({ error: 'Unsupported file type.' });
    }
    if (!text.trim()) return res.status(400).json({ error: 'Could not extract text from this file.' });
    res.json({ text: text.trim() });
  } catch (err) {
    console.error('Text extraction error:', err);
    res.status(500).json({ error: 'Failed to read the file. Please paste your resume instead.' });
  }
});

// ─── API: Download tailored result as .docx ───────────────────────────────────
// ─── Template-aware DOCX engine ───────────────────────────────────────────────
// Reproduces the visual resume/cover templates (sidebar, two-column, modern,
// banner, boxed, etc.) in Word so the downloaded .docx matches the on-screen
// design. Word has no flexbox, so multi-column layouts are built with borderless
// tables and shaded cells. Full-page-height colour bleed on sidebars is handled
// by giving the layout row a HeightRule.ATLEAST equal to the page content height
// (see _dxColumnsTable), so the shaded sidebar cell fills the page on single-page
// resumes. Multi-page sidebars are the remaining edge: the colour follows the
// row across the break but the trailing page only fills to its content height.
const _DX_NONE = { style: BorderStyle.NONE, size: 0, color: 'FFFFFF' };
function _dxNoTableBorders() {
  return { top: _DX_NONE, bottom: _DX_NONE, left: _DX_NONE, right: _DX_NONE, insideHorizontal: _DX_NONE, insideVertical: _DX_NONE };
}
const _dxClean = (s) => s.replace(/^#{1,3}\s+/, '').replace(/\*\*(.*?)\*\*/g, '$1').replace(/\*(.*?)\*/g, '$1').trim();
const _DOCX_FONTS = { arial: 'Arial', calibri: 'Calibri', times: 'Times New Roman' };
// Match the web preview / PDF font. The dashboard font picker (selectedDocFont)
// wins for all three outputs; without it, fall back to the template's serif
// default — and sans templates use Arial to match the web (previously Calibri).
const _dxFont = (serif, docFont) => _DOCX_FONTS[docFont] || (serif ? 'Georgia' : 'Arial');
const _DX_SIDE_KEYS = ['SKILL', 'CERTIF', 'LICENSE', 'LICENS', 'EDUCAT', 'LANGUAGE', 'AWARD', 'COMPETENC', 'TOOL', 'TECHNOLOG', 'PROFICIEN'];

function _dxParseResume(text) {
  const lines = String(text || '').split('\n');
  let name = '', contactParts = [], sections = [], cur = null;
  let nameDone = false, contactDone = false;
  for (const raw of lines) {
    const t = raw.trim().replace(/^#{1,3}\s+/, '');
    if (/^[-*_]{3,}$/.test(t)) continue;
    const clean = _dxClean(t);
    if (!clean) continue;
    if (!nameDone) { name = clean; nameDone = true; continue; }
    const isHdr = clean.length >= 2 && clean.length <= 60 && /^[A-Z][A-Z\s&\/\(\)\-:.]+$/.test(clean);
    if (isHdr) { contactDone = true; cur = { title: clean, lines: [] }; sections.push(cur); continue; }
    if (!contactDone) { contactParts.push(clean); continue; }
    if (cur) cur.lines.push(raw.trim());
  }
  return { name, contactParts, sections };
}

function _dxParseCover(text, meta) {
  meta = meta || {};
  const lines = String(text || '').split('\n');
  let name = '', contactStr = '', headerDone = false;
  const rawBody = [];
  for (let i = 0; i < lines.length; i++) {
    const t = _dxClean(lines[i].trim());
    if (!t) { if (name) { if (headerDone) rawBody.push(''); else headerDone = true; } continue; }
    if (!name && /^cover letter$/i.test(t)) continue;
    if (!name) { name = t; continue; }
    if (!headerDone && (t.includes('@') || /\(\d{3}\)|\d{3}[-.\s]\d{3}/.test(t) || (t.includes('|') && t.length < 120))) { contactStr = t; continue; }
    if (!headerDone && /\b(jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)\b/i.test(t) && t.length < 50) { headerDone = true; continue; }
    headerDone = true; rawBody.push(t);
  }
  const paragraphs = []; let acc = [];
  for (const line of rawBody) { if (!line) { if (acc.length) { paragraphs.push(acc.join(' ')); acc = []; } } else acc.push(line); }
  if (acc.length) paragraphs.push(acc.join(' '));
  const CLOSE_RE = /^(sincerely|best regards|regards|warm regards|respectfully|yours truly|cordially|thank you)[,\s]/i;
  // Drop closings and any salutation — the layout renders its own "Dear Hiring Manager,"
  const SALUT_RE = /^dear\b.{0,60}$/i;
  const body = paragraphs.filter(p => !CLOSE_RE.test(p) && !SALUT_RE.test(p));
  const today = new Date().toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' });
  return {
    name: name || meta.name || 'Applicant',
    contact: contactStr || [meta.email, meta.phone, meta.location].filter(Boolean).join(' | '),
    company: meta.company || '', role: meta.role || '', date: today, body,
  };
}

// A single resume/cover content line → Word paragraph(s)
function _dxLinePara(raw, o) {
  const trimmed = String(raw).trim();
  const clean = _dxClean(trimmed);
  if (!clean) return [];
  const bodyColor = o.onDark ? 'EDEDED' : '333333';
  const titleColor = o.onDark ? 'FFFFFF' : '1A1A1A';
  const sz = o.small ? 18 : 21;
  if (/^[•·\-\*]\s/.test(trimmed)) {
    return [new Paragraph({ children: [new TextRun({ text: clean.replace(/^[•·\-\*]\s*/, ''), font: o.font, size: sz, color: bodyColor })], bullet: { level: 0 }, spacing: { after: 40 } })];
  }
  const wasBold = /^\*\*[^*]+\*\*$/.test(trimmed);
  if (wasBold && clean.length < 70) {
    return [new Paragraph({ children: [new TextRun({ text: clean, font: o.font, size: sz + 2, bold: true, color: titleColor })], spacing: { before: 140, after: 20 }, keepNext: true })];
  }
  if ((clean.includes('—') || clean.includes('–') || (clean.includes('|') && /\d{4}/.test(clean))) && clean.length < 150) {
    return [new Paragraph({ children: [new TextRun({ text: clean, font: o.font, size: sz - 1, bold: true, color: o.accentHex })], spacing: { after: 50 }, keepNext: true })];
  }
  return [new Paragraph({ children: [new TextRun({ text: clean, font: o.font, size: sz, color: bodyColor })], spacing: { after: 50 } })];
}

// Section heading in the main column, styled per layout family
function _dxHeading(title, o) {
  const base = { spacing: { before: 300, after: 120 }, keepNext: true };
  const run = (size, spacing, color) => [new TextRun({ text: title, font: o.font, size, bold: true, color: color || o.primaryHex, allCaps: true, characterSpacing: spacing })];
  if (o.style === 'banner-pill') {
    return new Paragraph({ ...base, shading: { type: ShadingType.CLEAR, fill: o.primaryHex, color: 'auto' }, children: [new TextRun({ text: '  ' + title + '  ', font: o.font, size: 18, bold: true, color: 'FFFFFF', allCaps: true, characterSpacing: 30 })] });
  }
  if (o.style === 'left-bar' || o.style === 'icon-bar') {
    return new Paragraph({ ...base, children: run(21, 30), border: { left: { style: BorderStyle.SINGLE, size: 24, color: o.accentHex, space: 10 } }, indent: { left: 150 } });
  }
  if (o.style === 'minimal') {
    return new Paragraph({ ...base, children: run(19, 70) });
  }
  return new Paragraph({ ...base, children: run(21, 30), border: { bottom: { style: BorderStyle.SINGLE, size: 12, color: o.accentHex, space: 4 } } });
}

// Compact heading for sidebar / two-column side sections
function _dxSideHeading(title, o) {
  return new Paragraph({
    children: [new TextRun({ text: title, font: o.font, size: 16, bold: true, color: o.headColor, allCaps: true, characterSpacing: 30 })],
    spacing: { before: 200, after: 70 },
    border: { bottom: { style: BorderStyle.SINGLE, size: 4, color: o.accentHex, space: 3 } },
    keepNext: true,
  });
}

// Signature: line (top border) + cursive-style name. No literal label.
function _dxSig(sigName, primaryHex, font) {
  if (!sigName || !String(sigName).trim()) return [];
  const sig = String(sigName).trim();
  return [
    new Paragraph({ children: [new TextRun({ text: '', font, size: 22 })], spacing: { before: 420 }, border: { top: { style: BorderStyle.SINGLE, size: 6, color: 'CBD5E1', space: 6 } }, keepNext: true, keepLines: true }),
    new Paragraph({ children: [new TextRun({ text: sig, font, size: 44, bold: true, italics: true, color: primaryHex })], spacing: { before: 80, after: 0 }, keepLines: true }),
  ];
}

// Full-width colour header band (used by Modern resume & Modern cover)
function _dxBand(name, contactParts, o) {
  const cell = new TableCell({
    width: { size: o.contentWidth, type: WidthType.DXA },
    shading: { type: ShadingType.CLEAR, fill: o.primaryHex, color: 'auto' },
    margins: { top: 260, bottom: 260, left: 360, right: 360 },
    verticalAlign: VerticalAlign.CENTER,
    children: [
      new Paragraph({ children: [new TextRun({ text: name, font: o.font, size: 34, bold: true, color: 'FFFFFF' })], spacing: { after: contactParts.length ? 50 : 0 } }),
      ...(contactParts.length ? [new Paragraph({ children: [new TextRun({ text: contactParts.join('    |    '), font: o.font, size: 18, color: 'E6E6E6' })] })] : []),
    ],
  });
  return new Table({ width: { size: o.contentWidth, type: WidthType.DXA }, columnWidths: [o.contentWidth], borders: _dxNoTableBorders(), rows: [new TableRow({ children: [cell] })] });
}

// Two-column table for Sidebar (shaded left) and Two-Column (bordered left)
function _dxTwoCol(name, contactParts, sections, o) {
  const isSidebar = o.layout === 'rSidebar';
  const sideSecs = [], mainSecs = [];
  for (const sec of sections) (_DX_SIDE_KEYS.some(k => sec.title.toUpperCase().includes(k)) ? sideSecs : mainSecs).push(sec);
  const leftW = Math.round(o.contentWidth * (isSidebar ? 0.34 : 0.32));
  const rightW = o.contentWidth - leftW;
  const headColor = isSidebar ? 'FFFFFF' : o.primaryHex;
  const onDark = isSidebar;

  const left = [];
  if (isSidebar) {
    left.push(new Paragraph({ alignment: AlignmentType.CENTER, spacing: { after: 60 }, children: [new TextRun({ text: (name.trim()[0] || '?').toUpperCase(), font: o.font, size: 56, bold: true, color: o.accentHex })] }));
    left.push(new Paragraph({ alignment: AlignmentType.CENTER, spacing: { after: 120 }, children: [new TextRun({ text: name, font: o.font, size: 24, bold: true, color: 'FFFFFF' })] }));
  } else {
    left.push(new Paragraph({ children: [new TextRun({ text: name, font: o.font, size: 30, bold: true, color: o.primaryHex })], spacing: { after: 80 } }));
  }
  left.push(_dxSideHeading('Contact', { font: o.font, headColor, accentHex: o.accentHex }));
  for (const cp of contactParts) left.push(new Paragraph({ children: [new TextRun({ text: cp, font: o.font, size: 18, color: onDark ? 'E6E6E6' : '555555' })], spacing: { after: 40 } }));
  for (const sec of sideSecs) {
    left.push(_dxSideHeading(sec.title, { font: o.font, headColor, accentHex: o.accentHex }));
    for (const raw of sec.lines) for (const p of _dxLinePara(raw, { font: o.font, accentHex: o.accentHex, onDark, small: true })) left.push(p);
  }

  const right = [];
  const mainStyle = isSidebar ? 'underline' : 'icon-bar';
  mainSecs.forEach(sec => {
    right.push(_dxHeading(sec.title, { style: mainStyle, primaryHex: o.primaryHex, accentHex: o.accentHex, font: o.font }));
    for (const raw of sec.lines) for (const p of _dxLinePara(raw, { font: o.font, accentHex: o.accentHex, onDark: false })) right.push(p);
  });
  for (const p of _dxSig(o.sigName, o.primaryHex, o.font)) right.push(p);
  if (!left.length) left.push(new Paragraph({}));
  if (!right.length) right.push(new Paragraph({}));

  const leftCell = new TableCell({
    width: { size: leftW, type: WidthType.DXA },
    shading: isSidebar ? { type: ShadingType.CLEAR, fill: o.primaryHex, color: 'auto' } : undefined,
    margins: { top: 300, bottom: 300, left: isSidebar ? 360 : 120, right: isSidebar ? 360 : 280 },
    borders: isSidebar ? undefined : { right: { style: BorderStyle.SINGLE, size: 12, color: o.accentHex }, top: _DX_NONE, bottom: _DX_NONE, left: _DX_NONE },
    verticalAlign: VerticalAlign.TOP,
    children: left,
  });
  const rightCell = new TableCell({
    width: { size: rightW, type: WidthType.DXA },
    margins: { top: 300, bottom: 300, left: 320, right: 120 },
    verticalAlign: VerticalAlign.TOP,
    children: right,
  });
  // Force the row to at least a full page tall so the coloured Sidebar column
  // (and the Two-Column divider) runs the whole page height even when the
  // content is short — and continues down subsequent pages if it overflows.
  const row = new TableRow({ height: { value: o.pageContentHeight || 13680, rule: HeightRule.ATLEAST }, children: [leftCell, rightCell] });
  return new Table({ width: { size: o.contentWidth, type: WidthType.DXA }, columnWidths: [leftW, rightW], borders: _dxNoTableBorders(), rows: [row] });
}

function _dxRenderResume(text, o) {
  const font = _dxFont(o.serif, o.docFont);
  const { name, contactParts, sections } = _dxParseResume(text);
  if (o.layout === 'rSidebar' || o.layout === 'rTwoCol') {
    return [_dxTwoCol(name, contactParts, sections, { ...o, font })];
  }
  if (o.layout === 'rModern') {
    // Full-bleed colour band across the top of the page (page margins are 0 for
    // this layout). The body sits in a borderless table inset from the edges so
    // the text keeps its 0.5in margin while the band runs edge to edge.
    const body = [];
    sections.forEach(sec => {
      body.push(_dxHeading(sec.title, { style: 'icon-bar', primaryHex: o.primaryHex, accentHex: o.accentHex, font }));
      for (const raw of sec.lines) for (const p of _dxLinePara(raw, { font, accentHex: o.accentHex, onDark: false })) body.push(p);
    });
    for (const p of _dxSig(o.sigName, o.primaryHex, font)) body.push(p);
    const inset = new TableCell({ width: { size: o.contentWidth, type: WidthType.DXA }, margins: { top: 240, bottom: 120, left: 720, right: 720 }, children: body.length ? body : [new Paragraph({})] });
    return [
      _dxBand(name, contactParts, { ...o, font }),
      new Table({ width: { size: o.contentWidth, type: WidthType.DXA }, columnWidths: [o.contentWidth], borders: _dxNoTableBorders(), rows: [new TableRow({ children: [inset] })] }),
    ];
  }
  const out = [];
  if (o.layout === 'rBanner') {
    out.push(new Paragraph({ children: [new TextRun({ text: name, font, size: 44, bold: true, color: o.primaryHex })], border: { left: { style: BorderStyle.SINGLE, size: 36, color: o.primaryHex, space: 12 } }, indent: { left: 130 }, spacing: { after: 40 } }));
    if (contactParts.length) out.push(new Paragraph({ children: [new TextRun({ text: contactParts.join('   ·   '), font, size: 18, color: '666666' })], indent: { left: 130 }, spacing: { after: 80 }, border: { bottom: { style: BorderStyle.SINGLE, size: 12, color: o.accentHex, space: 6 } } }));
  } else if (o.layout === 'rMinimal') {
    out.push(new Paragraph({ children: [new TextRun({ text: name, font, size: 40, color: '111827', characterSpacing: 60 })], spacing: { after: 60 } }));
    if (contactParts.length) out.push(new Paragraph({ children: [new TextRun({ text: contactParts.join('   |   '), font, size: 18, color: '666666' })], spacing: { after: 160 }, border: { bottom: { style: BorderStyle.SINGLE, size: 6, color: o.primaryHex, space: 6 } } }));
  } else if (o.layout === 'rExecutive') {
    // Coloured left bar on the name + contact, matching the gallery card.
    const lb = { left: { style: BorderStyle.SINGLE, size: 24, color: o.primaryHex, space: 8 } };
    out.push(new Paragraph({ children: [new TextRun({ text: name, font, size: 44, bold: true, color: o.primaryHex })], border: lb, indent: { left: 60 }, spacing: { after: 40 } }));
    if (contactParts.length) out.push(new Paragraph({ children: [new TextRun({ text: contactParts.join('   |   '), font, size: 19, color: '555555' })], border: lb, indent: { left: 60 }, spacing: { after: 120 } }));
  } else {
    // rClassic — centred name + contact with a full-width rule underneath.
    out.push(new Paragraph({ alignment: AlignmentType.CENTER, children: [new TextRun({ text: name, font, size: 44, bold: true, color: o.primaryHex })], spacing: { after: 40 } }));
    if (contactParts.length) {
      out.push(new Paragraph({ alignment: AlignmentType.CENTER, children: [new TextRun({ text: contactParts.join('   |   '), font, size: 19, color: '555555' })], spacing: { after: 120 }, border: { bottom: { style: BorderStyle.SINGLE, size: 12, color: o.primaryHex, space: 6 } } }));
    } else {
      out.push(new Paragraph({ children: [new TextRun({ text: '', font, size: 2 })], border: { bottom: { style: BorderStyle.SINGLE, size: 12, color: o.primaryHex, space: 6 } }, spacing: { after: 120 } }));
    }
  }
  const headStyle = { rClassic: 'underline', rExecutive: 'left-bar', rMinimal: 'minimal', rModern: 'icon-bar', rBanner: 'banner-pill' }[o.layout] || 'underline';
  sections.forEach(sec => {
    out.push(_dxHeading(sec.title, { style: headStyle, primaryHex: o.primaryHex, accentHex: o.accentHex, font }));
    for (const raw of sec.lines) for (const p of _dxLinePara(raw, { font, accentHex: o.accentHex, onDark: false })) out.push(p);
  });
  for (const p of _dxSig(o.sigName, o.primaryHex, font)) out.push(p);
  return out;
}

function _dxRenderCover(text, o, meta) {
  const font = _dxFont(o.serif, o.docFont);
  const p = _dxParseCover(text, meta);
  const out = [];
  const roleLine = [p.role, p.company].filter(Boolean).join(' — ');
  const band = (nameSize) => _dxBand(p.name, p.contact ? [p.contact] : [], { ...o, font });

  if (o.layout === 'cModern' || o.layout === 'cBold' || o.layout === 'cSplit') {
    out.push(band());
    if (roleLine) out.push(new Paragraph({ children: [new TextRun({ text: roleLine, font, size: 19, bold: true, color: o.accentHex })], spacing: { before: 120, after: 40 } }));
    out.push(new Paragraph({ children: [new TextRun({ text: p.date, font, size: 18, color: '888888' })], spacing: { after: 160 } }));
  } else if (o.layout === 'cBoxed') {
    const inner = new TableCell({
      width: { size: o.contentWidth, type: WidthType.DXA },
      margins: { top: 200, bottom: 200, left: 300, right: 300 },
      borders: { top: { style: BorderStyle.SINGLE, size: 12, color: o.primaryHex }, bottom: { style: BorderStyle.SINGLE, size: 12, color: o.primaryHex }, left: { style: BorderStyle.SINGLE, size: 12, color: o.primaryHex }, right: { style: BorderStyle.SINGLE, size: 12, color: o.primaryHex } },
      children: [
        new Paragraph({ children: [new TextRun({ text: p.name, font, size: 28, bold: true, color: o.primaryHex })] }),
        ...(p.contact ? [new Paragraph({ children: [new TextRun({ text: p.contact, font, size: 18, color: '777777' })], spacing: { before: 40 } })] : []),
      ],
    });
    out.push(new Table({ width: { size: o.contentWidth, type: WidthType.DXA }, columnWidths: [o.contentWidth], borders: _dxNoTableBorders(), rows: [new TableRow({ children: [inner] })] }));
    out.push(new Paragraph({ children: [new TextRun({ text: [p.date, roleLine].filter(Boolean).join('    ·    '), font, size: 18, color: '999999' })], spacing: { before: 160, after: 160 } }));
  } else if (o.layout === 'cClean') {
    out.push(new Paragraph({ children: [new TextRun({ text: p.name, font, size: 52, bold: true, color: o.primaryHex })], spacing: { after: 60 } }));
    if (p.contact) out.push(new Paragraph({ children: [new TextRun({ text: p.contact, font, size: 18, bold: true, color: o.accentHex })], spacing: { after: 80 } }));
    out.push(new Paragraph({ children: [new TextRun({ text: '', font, size: 8 })], border: { bottom: { style: BorderStyle.SINGLE, size: 16, color: o.accentHex, space: 2 } }, spacing: { after: 160 } }));
    out.push(new Paragraph({ children: [new TextRun({ text: [p.date, roleLine ? 'Re: ' + roleLine : ''].filter(Boolean).join('    ·    '), font, size: 18, color: o.primaryHex })], spacing: { after: 200 } }));
  } else {
    // cFormal — classic business letter
    out.push(new Paragraph({ children: [new TextRun({ text: p.name, font, size: 30, bold: true, color: o.primaryHex })], spacing: { after: 40 }, border: { bottom: { style: BorderStyle.SINGLE, size: 12, color: o.primaryHex, space: 6 } } }));
    if (p.contact) out.push(new Paragraph({ children: [new TextRun({ text: p.contact, font, size: 18, color: '888888' })], spacing: { before: 80, after: 200 } }));
    out.push(new Paragraph({ children: [new TextRun({ text: p.date, font, size: 19, color: '777777' })], spacing: { after: 80 } }));
    if (roleLine) out.push(new Paragraph({ children: [new TextRun({ text: roleLine, font, size: 19, color: '666666' })], spacing: { after: 160 } }));
  }

  out.push(new Paragraph({ children: [new TextRun({ text: 'Dear Hiring Manager,', font, size: 23, bold: true, color: o.primaryHex })], spacing: { before: 120, after: 180 } }));
  p.body.forEach(para => out.push(new Paragraph({ children: [new TextRun({ text: para, font, size: 22, color: '333333' })], spacing: { after: 200, line: 300, lineRule: 'auto' } })));
  // Complimentary close. A cover letter ends with "Sincerely, <name>" — NOT the
  // resume-style horizontal signature rule. This matches the on-screen/PDF cover
  // (which renders cover-letter mode without the stylized sig block, so the close
  // shows as plain text) for cross-format consistency. keepNext/keepLines stop the
  // close from orphaning onto a new page.
  const _coverCloser = (o.sigName && String(o.sigName).trim()) || p.name;
  out.push(new Paragraph({ children: [new TextRun({ text: 'Sincerely,', font, size: 22, color: '333333' })], spacing: { before: 240, after: 0 }, keepNext: true, keepLines: true }));
  if (_coverCloser) out.push(new Paragraph({ children: [new TextRun({ text: _coverCloser, font, size: 22, color: '333333' })], spacing: { before: 160, after: 0 }, keepLines: true }));
  return out;
}

function _dxMargins(layout) {
  // Match the PDF/print body margins: print uses a 0.5in (720 twip) page margin
  // for every layout. The Sidebar bleeds its coloured column to the page edge,
  // so its left/right margins are 0 and the inset lives inside the table cells.
  if (layout === 'rSidebar') return { top: 720, bottom: 720, left: 0, right: 0 };
  // Modern bleeds its colour band to the top + side edges; the body is inset by
  // a table instead (see _dxRenderResume), so page side margins are 0 here.
  if (layout === 'rModern') return { top: 0, bottom: 720, left: 0, right: 0 };
  return { top: 720, bottom: 720, left: 720, right: 720 };
}

function _dxHex(c, fallback) { return (c || fallback).replace('#', ''); }

async function buildTemplatedDocxBuffer({ text, coverText, sigName, pageSize, mode, primary, cover, meta, docFont }) {
  const isA4 = pageSize === 'a4';
  const PAGE_WIDTH = isA4 ? 11906 : 12240;
  const PAGE_HEIGHT = isA4 ? 16838 : 15840;

  const buildOpts = (tpl, withSig) => {
    const layout = (tpl && tpl.layout) || 'rClassic';
    const m = _dxMargins(layout);
    const colors = (tpl && tpl.colors) || {};
    return {
      opts: {
        layout, style: (tpl && tpl.style) || 'underline', serif: !!(tpl && tpl.serif),
        docFont: docFont || null,
        primaryHex: _dxHex(colors.primary, '#1a237e'), accentHex: _dxHex(colors.accent, '#5c6bc0'),
        lightHex: _dxHex(colors.light, '#e8eaf6'), sigName: withSig ? (sigName || null) : null,
        contentWidth: PAGE_WIDTH - m.left - m.right,
        pageContentHeight: PAGE_HEIGHT - m.top - m.bottom,
      },
      margin: m,
    };
  };

  const isCover = mode === 'cover_letter';
  const isBoth = mode === 'both';

  const prim = buildOpts(primary, !isBoth); // in 'both' mode the signature lives on the cover
  const primChildren = isCover ? _dxRenderCover(text, prim.opts, meta) : _dxRenderResume(text, prim.opts);
  const sections = [{ properties: { page: { size: { width: PAGE_WIDTH, height: PAGE_HEIGHT }, margin: prim.margin } }, children: primChildren }];

  if (isBoth && coverText) {
    const cv = buildOpts(cover, true);
    sections.push({ properties: { page: { size: { width: PAGE_WIDTH, height: PAGE_HEIGHT }, margin: cv.margin } }, children: _dxRenderCover(coverText, cv.opts, meta) });
  }

  return Packer.toBuffer(new Document({ sections }));
}

async function handleTemplatedDocx(req, res) {
  const { text, coverText, filename, sigName, pageSize, mode, primary, cover, meta, docFont } = req.body;
  const buffer = await buildTemplatedDocxBuffer({ text, coverText, sigName, pageSize, mode, primary, cover, meta, docFont });

  const safeName = (filename || 'tailored-resume').replace(/[^a-z0-9-_\s]/gi, '_');
  res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document');
  res.setHeader('Content-Disposition', `attachment; filename="${safeName}.docx"`);
  res.send(buffer);

  const ownerEmail = process.env.OWNER_EMAIL || 'support@resumetailored.com';
  sendEmail({
    to: ownerEmail,
    subject: `[ResumeTailored] Download: ${safeName}.docx`,
    html: `<p>A user just downloaded <strong>${safeName}.docx</strong>.</p><p>Time: ${new Date().toUTCString()}</p>`
  }).catch(err => console.error('[Alert] Download email failed:', err.message));
}

app.post('/api/download-docx', async (req, res) => {
  const { text, filename, colors, sigName, sigFont: sigFontName, pageSize } = req.body;
  if (!text) return res.status(400).json({ error: 'No text provided.' });
  // Template-aware path: when the client sends template metadata, render the
  // chosen visual layout. Falls back to the legacy single-column builder below.
  if (req.body.primary && req.body.primary.layout) {
    try { return await handleTemplatedDocx(req, res); }
    catch (err) {
      // Surface the failure instead of silently emitting a generic single-column
      // document that ignores the chosen template's layout/margins/fonts.
      console.error('[docx] templated render failed:', err && err.stack ? err.stack : err);
      if (!res.headersSent) {
        return res.status(500).json({ error: 'Could not generate the .docx for this template. Please try again.', detail: String(err && err.message ? err.message : err).slice(0, 300) });
      }
      return;
    }
  }

  const primaryHex = colors?.primary ? colors.primary.replace('#', '') : '1a237e';
  const accentHex  = colors?.accent  ? colors.accent.replace('#', '')  : '5c6bc0';

  // Page size: Letter (default, 8.5×11in) or A4 (210×297mm)
  // 1 inch = 1440 twips; 1mm = 56.69 twips
  const isA4 = pageSize === 'a4';
  const PAGE_WIDTH  = isA4 ? 11906 : 12240; // A4: 210mm | Letter: 8.5in
  const PAGE_HEIGHT = isA4 ? 16838 : 15840; // A4: 297mm | Letter: 11in
  const MARGIN = 1440; // 1 inch on all sides
  const WrapOption = { wrap: 'auto', lineRule: 'auto' };

  const cleanLine = (s) => s.replace(/^#{1,3}\s+/, '').replace(/\*\*(.*?)\*\*/g, '$1').replace(/\*(.*?)\*/g, '$1').trim();

  const lines = text.split('\n');
  const children = [];
  let lineIndex = 0;

  // Skip leading blank lines
  while (lineIndex < lines.length && !lines[lineIndex].trim()) lineIndex++;

  // First non-blank line = name (header)
  if (lineIndex < lines.length) {
    const name = cleanLine(lines[lineIndex]);
    children.push(new Paragraph({
      children: [new TextRun({ text: name, font: 'Calibri', size: 44, bold: true, color: primaryHex })],
      spacing: { after: 60 },
      wordWrap: true,
    }));
    lineIndex++;
  }

  // Contact info lines immediately after name
  while (lineIndex < lines.length) {
    const raw = lines[lineIndex];
    const t = cleanLine(raw);
    if (!t) { lineIndex++; break; }
    const isContact = t.includes('@') || /\(\d{3}\)/.test(t) || /\d{3}[-.\s]\d{3}/.test(t) || (t.includes('|') && t.length < 160 && !/\d{4}/.test(t));
    if (isContact) {
      children.push(new Paragraph({
        children: [new TextRun({ text: t, font: 'Calibri', size: 20, color: '555555' })],
        spacing: { after: 40 },
        wordWrap: true,
      }));
      lineIndex++;
    } else {
      break;
    }
  }

  // Remaining content lines
  for (; lineIndex < lines.length; lineIndex++) {
    const raw = lines[lineIndex];
    const trimmed = raw.trim();
    const clean = cleanLine(trimmed);

    if (!clean) {
      children.push(new Paragraph({ spacing: { after: 80 } }));
      continue;
    }

    // Section heading: all-caps, 2–60 chars
    const isHeading = clean.length >= 2 && clean.length <= 60 &&
      /^[A-Z][A-Z\s&\/\(\)\-:.]+$/.test(clean) && /[A-Z]/.test(clean);
    if (isHeading) {
      children.push(new Paragraph({
        children: [new TextRun({ text: clean, font: 'Calibri', size: 24, bold: true, color: primaryHex })],
        spacing: { before: 320, after: 100 },
        border: { bottom: { style: BorderStyle.SINGLE, size: 8, color: accentHex, space: 4 } },
        wordWrap: true,
      }));
      continue;
    }

    // Bullet point
    if (/^[•·\-\*]\s/.test(trimmed)) {
      const txt = clean.replace(/^[•·\-\*]\s*/, '');
      children.push(new Paragraph({
        children: [new TextRun({ text: txt, font: 'Calibri', size: 22, color: '333333' })],
        bullet: { level: 0 },
        spacing: { after: 50 },
        wordWrap: true,
      }));
      continue;
    }

    // Date/company line (em-dash, en-dash, or pipe with year)
    if ((clean.includes('—') || clean.includes('–') || (clean.includes('|') && /\d{4}/.test(clean))) && clean.length < 200) {
      children.push(new Paragraph({
        children: [new TextRun({ text: clean, font: 'Calibri', size: 22, color: accentHex, bold: true })],
        spacing: { after: 50 },
        wordWrap: true,
      }));
      continue;
    }

    // Bold-only line (job title / sub-heading)
    const wasBold = /^\*\*[^*]+\*\*$/.test(trimmed);
    if (wasBold && clean.length < 120) {
      children.push(new Paragraph({
        children: [new TextRun({ text: clean, font: 'Calibri', size: 24, bold: true, color: '222222' })],
        spacing: { before: 140, after: 50 },
        wordWrap: true,
      }));
      continue;
    }

    // Regular body text
    children.push(new Paragraph({
      children: [new TextRun({ text: clean, font: 'Calibri', size: 22, color: '333333' })],
      spacing: { after: 50 },
      wordWrap: true,
    }));
  }

  // Signature block.
  // RULE A (room available): a modest 1/3-inch gap places the signature directly
  // under the content. The old 2-inch forced gap pushed it onto a near-empty
  // trailing page. keepNext glues the line to the name and keepLines keeps the
  // name whole, so the block never splits or strands on a page by itself.
  // No literal "Signature" label — the rule (top border) is the designated slot.
  if (sigName && sigName.trim()) {
    const sig = sigName.trim();
    // Signature line (horizontal rule) — keepNext keeps it glued to the name below
    children.push(new Paragraph({
      children: [new TextRun({ text: '', font: 'Calibri', size: 22 })],
      spacing: { before: 480 },
      border: { top: { style: BorderStyle.SINGLE, size: 6, color: 'cbd5e1', space: 6 } },
      keepNext: true,
      keepLines: true,
    }));
    // Signature name — keepLines prevents its lines from splitting; it stays whole
    children.push(new Paragraph({
      children: [new TextRun({ text: sig, font: 'Calibri', size: 52, bold: true, color: primaryHex, italics: true })],
      spacing: { before: 80, after: 0 },
      keepLines: true,
    }));
  }

  const doc = new Document({
    sections: [{
      properties: {
        page: {
          size: { width: PAGE_WIDTH, height: PAGE_HEIGHT },
          margin: { top: MARGIN, bottom: MARGIN, left: MARGIN, right: MARGIN },
        },
      },
      children,
    }],
  });
  const buffer = await Packer.toBuffer(doc);

  const safeName = (filename || 'tailored-resume').replace(/[^a-z0-9-_\s]/gi, '_');
  res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document');
  res.setHeader('Content-Disposition', `attachment; filename="${safeName}.docx"`);
  res.send(buffer);

  const ownerEmail = process.env.OWNER_EMAIL || 'support@resumetailored.com';
  sendEmail({
    to: ownerEmail,
    subject: `[ResumeTailored] Download: ${safeName}.docx`,
    html: `<p>A user just downloaded <strong>${safeName}.docx</strong>.</p><p>Time: ${new Date().toUTCString()}</p>`
  }).catch(err => console.error('[Alert] Download email failed:', err.message));
});

// ─── Helpers ──────────────────────────────────────────────────────────────────
function getTodayKey(userKey, mode) {
  const today = new Date().toISOString().slice(0, 10);
  return `${userKey}_${mode}_${today}`;
}

function hasFreeTierLeft(userKey, mode) {
  const key = getTodayKey(userKey, mode);
  const row = db.prepare('SELECT count FROM usage_store WHERE key = ?').get(key);
  return !row || row.count < 1;
}

function consumeFreeTier(userKey, mode) {
  const key = getTodayKey(userKey, mode);
  db.prepare('INSERT INTO usage_store (key, count) VALUES (?, 1) ON CONFLICT(key) DO UPDATE SET count = count + 1').run(key);
}

// Returns the authenticated email from the Bearer token, or null
function getSessionEmail(req) {
  const token = (req.headers.authorization || '').replace('Bearer ', '').trim();
  if (!token) return null;
  const row = db.prepare('SELECT email FROM sessions WHERE token = ?').get(token);
  return row ? row.email : null;
}

// Returns a per-user key for free tier tracking: email (if logged in) or IP
function getUsageKey(req) {
  const email = getSessionEmail(req);
  return email ? `user:${email.toLowerCase()}` : `ip:${req.ip}`;
}

// Comped accounts are treated as active subscribers (unlimited access, pro
// voice). Includes the owner email plus any COMP_EMAILS (comma-separated).
const COMP_EMAILS = (process.env.COMP_EMAILS || 'marvinperson11@gmail.com')
  .split(',').map(e => e.trim().toLowerCase()).filter(Boolean);

function isSubscriber(email) {
  if (!email) return false;
  const e = email.toLowerCase();
  const ownerEmail = (process.env.OWNER_EMAIL || 'support@resumetailored.com').toLowerCase();
  if (e === ownerEmail) return true;
  if (COMP_EMAILS.includes(e)) return true;
  return !!db.prepare('SELECT 1 FROM subscribers WHERE email = ?').get(e);
}

// ─── API: Free Tool — ATS Keyword Extractor ──────────────────────────────────
const keywordExtractorLimiter = rateLimit({ windowMs: 60 * 1000, max: 8, message: { error: 'Too many requests — please wait a minute and try again.' } });

app.post('/api/tools/extract-keywords', keywordExtractorLimiter, async (req, res) => {
  const { jobDescription } = req.body;
  if (!jobDescription || typeof jobDescription !== 'string' || jobDescription.trim().length < 50) {
    return res.status(400).json({ error: 'Please paste a complete job description (at least 50 characters).' });
  }
  if (jobDescription.length > 12000) {
    return res.status(400).json({ error: 'Job description too long — paste the key sections only (under 12,000 characters).' });
  }
  try {
    const msg = await anthropic.messages.create({
      model: 'claude-sonnet-4-6',
      max_tokens: 600,
      messages: [{
        role: 'user',
        content: `Extract the top 15 ATS keywords from this job description. Return ONLY a valid JSON array of strings — no explanation, no markdown, no extra text. Focus on: required technical skills, tools/software, certifications, methodologies, domain terms, and key hard-skill phrases that an Applicant Tracking System would score. Prioritize terms that appear multiple times or are listed under "Requirements."

Job description:
${jobDescription.slice(0, 10000)}`
      }]
    });
    const raw = msg.content[0].text.trim();
    const jsonMatch = raw.match(/\[[\s\S]*\]/);
    if (!jsonMatch) return res.status(500).json({ error: 'Failed to parse keywords — please try again.' });
    const keywords = JSON.parse(jsonMatch[0]);
    if (!Array.isArray(keywords)) return res.status(500).json({ error: 'Unexpected response format — please try again.' });
    res.json({ keywords: keywords.slice(0, 15) });
  } catch (err) {
    console.error('[extract-keywords]', err.message);
    res.status(500).json({ error: 'AI extraction failed — please try again in a moment.' });
  }
});

// ─── API: Health check ────────────────────────────────────────────────────────
app.get('/api/health', (req, res) => {
  res.json({
    status: 'ok',
    anthropic: !!process.env.ANTHROPIC_API_KEY,
    stripe: !!process.env.STRIPE_SECRET_KEY,
    stripePrice: !!process.env.STRIPE_PRICE_ID
  });
});

// ─── API: AI connection test ──────────────────────────────────────────────────
app.get('/api/test-ai', async (req, res) => {
  // Test the model the app actually uses. (Don't pick models.list()[0] — that
  // first-listed model may be one the account can't access, e.g. Fable, which
  // returns a misleading 404 even though tailoring works fine.)
  const model = 'claude-sonnet-4-6';
  try {
    const msg = await anthropic.messages.create({
      model,
      max_tokens: 10,
      messages: [{ role: 'user', content: 'Say "ok"' }]
    });
    res.json({ success: true, modelUsed: model, response: msg.content[0].text });
  } catch (err) {
    res.json({ success: false, status: err?.status, error: err?.message || String(err) });
  }
});

// ─── API: Check usage status ──────────────────────────────────────────────────
app.get('/api/status', (req, res) => {
  const usageKey = getUsageKey(req);
  const email = req.query.email || '';
  res.json({
    freeResumesLeft: hasFreeTierLeft(usageKey, 'resume') ? 1 : 0,
    freeCoverLettersLeft: hasFreeTierLeft(usageKey, 'cover_letter') ? 1 : 0,
    freeLinkedInLeft: hasFreeTierLeft(usageKey, 'linkedin') ? 1 : 0,
    freeAtsLeft: hasFreeTierLeft(usageKey, 'ats_scan') ? 1 : 0,
    isSubscriber: isSubscriber(email)
  });
});

// ─── API: ATS scan (Claude-powered) ──────────────────────────────────────────
// ─── API: Fetch job posting from URL ─────────────────────────────────────────
const ALLOWED_JOB_DOMAINS = new Set([
  'linkedin.com','indeed.com','glassdoor.com','ziprecruiter.com','monster.com',
  'careerbuilder.com','dice.com','theladders.com','simplyhired.com','snagajob.com',
  'flexjobs.com','themuse.com','hired.com','wellfound.com','angel.co',
  'builtin.com','remote.co','weworkremotely.com','remoteok.com','remoteok.io',
  'lever.co','greenhouse.io','ashbyhq.com','bamboohr.com','myworkdayjobs.com',
  'workday.com','icims.com','smartrecruiters.com','jobvite.com','taleo.net',
  'breezy.hr','workable.com','recruitee.com','pinpoint.com','teamtailor.com',
  'handshake.com','wayup.com','internships.com','chegg.com','recruiter.com',
  'zippia.com','jora.com','jobrapido.com','otta.com','cord.co',
  'techinasia.com','careers.google.com','jobs.apple.com',
  'microsoft.com','amazon.jobs','meta.com','netflix.jobs',
  // Chinese platforms
  'zhipin.com','liepin.com','zhaopin.com','lagou.com','51job.com','maimai.cn',
]);

function isAllowedJobUrl(raw) {
  try {
    const u = new URL(raw);
    if (u.protocol !== 'https:') return false;
    const host = u.hostname.replace(/^www\./, '');
    for (const d of ALLOWED_JOB_DOMAINS) {
      if (host === d || host.endsWith('.' + d)) return true;
    }
    return false;
  } catch { return false; }
}

function extractJsonLdJob(html) {
  // Many job boards (Indeed, LinkedIn, Glassdoor) embed structured job data in JSON-LD
  const matches = html.match(/<script[^>]+type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi) || [];
  for (const block of matches) {
    try {
      const json = JSON.parse(block.replace(/<script[^>]*>|<\/script>/gi, ''));
      const objs = Array.isArray(json) ? json : [json];
      for (const obj of objs) {
        if (obj['@type'] === 'JobPosting') {
          const parts = [];
          if (obj.title) parts.push(obj.title);
          if (obj.hiringOrganization?.name) parts.push('Company: ' + obj.hiringOrganization.name);
          if (obj.jobLocation?.address) {
            const a = obj.jobLocation.address;
            parts.push('Location: ' + [a.addressLocality, a.addressRegion, a.addressCountry].filter(Boolean).join(', '));
          }
          if (obj.description) parts.push(obj.description.replace(/<[^>]+>/g, ' ').replace(/\s{3,}/g, '\n\n').trim());
          if (obj.employmentType) parts.push('Employment Type: ' + obj.employmentType);
          if (obj.baseSalary?.value) {
            const s = obj.baseSalary.value;
            parts.push('Salary: ' + (s.minValue || '') + (s.maxValue ? '–' + s.maxValue : '') + ' ' + (s.unitText || ''));
          }
          const text = parts.join('\n\n').trim();
          if (text.length > 200) return text;
        }
      }
    } catch { /* not valid JSON, skip */ }
  }
  return null;
}

function stripHtml(html) {
  // Remove scripts, styles, nav, footer, header blocks entirely
  let text = html
    .replace(/<script[\s\S]*?<\/script>/gi, '')
    .replace(/<style[\s\S]*?<\/style>/gi, '')
    .replace(/<(nav|header|footer|aside)[^>]*>[\s\S]*?<\/\1>/gi, '')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>')
    .replace(/&nbsp;/g, ' ').replace(/&#\d+;/g, ' ').replace(/&[a-z]+;/g, ' ')
    .replace(/\s{3,}/g, '\n\n')
    .trim();
  // Truncate to ~8000 chars to keep prompt size reasonable
  return text.length > 8000 ? text.slice(0, 8000) + '…' : text;
}

app.post('/api/fetch-job-url', async (req, res) => {
  const { url } = req.body;
  if (!url) return res.status(400).json({ error: 'URL is required.' });
  if (!isAllowedJobUrl(url)) {
    return res.status(400).json({ error: 'Only URLs from supported job boards are accepted.' });
  }

  try {
    const response = await fetch(url, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36',
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8',
        'Accept-Language': 'en-US,en;q=0.9',
        'Accept-Encoding': 'gzip, deflate, br',
        'Cache-Control': 'no-cache',
        'Pragma': 'no-cache',
        'Sec-Fetch-Dest': 'document',
        'Sec-Fetch-Mode': 'navigate',
        'Sec-Fetch-Site': 'none',
        'Upgrade-Insecure-Requests': '1',
      },
      redirect: 'follow',
      signal: AbortSignal.timeout(15000),
    });

    if (response.status === 401 || response.status === 403) {
      return res.status(422).json({ error: 'This job board requires a login to view postings. Please copy and paste the job description text instead.' });
    }
    if (!response.ok) {
      return res.status(422).json({ error: `Could not load that page (HTTP ${response.status}). Please paste the job description manually.` });
    }

    const html = await response.text();

    // Try structured JSON-LD first (works reliably for Indeed, Glassdoor, etc.)
    const jsonLdText = extractJsonLdJob(html);
    if (jsonLdText) {
      return res.json({ text: jsonLdText });
    }

    const rawText = stripHtml(html);

    if (rawText.length < 100) {
      return res.status(422).json({ error: 'Could not extract job text — the page may require a login. Please paste the job description manually.' });
    }

    // Use Claude to extract just the job description portion
    const msg = await anthropic.messages.create({
      model: 'claude-sonnet-4-6',
      max_tokens: 2048,
      system: 'You extract job descriptions from raw webpage text. Output ONLY the job posting content — title, company, responsibilities, requirements, qualifications. Remove all navigation, ads, footers, related jobs, and unrelated site content. Preserve structure. No preamble.',
      messages: [{ role: 'user', content: rawText }],
    });

    const text = msg.content[0]?.text?.trim() || rawText;
    res.json({ text });
  } catch (err) {
    if (err.name === 'TimeoutError' || err.name === 'AbortError') {
      return res.status(422).json({ error: 'Request timed out. The job board may be blocking automated access — please paste the job description manually.' });
    }
    console.error('fetch-job-url error:', err.message);
    res.status(500).json({ error: 'Failed to fetch the job posting. Please paste the job description manually.' });
  }
});

app.post('/api/ats-scan', async (req, res) => {
  const { resume, jobPosting } = req.body;
  if (!resume || !jobPosting) {
    return res.status(400).json({ error: 'Resume and job posting are required.' });
  }

  const usageKey = getUsageKey(req);
  const email = getSessionEmail(req);
  const subscribed = isSubscriber(email);

  if (!subscribed && !hasFreeTierLeft(usageKey, 'ats_scan')) {
    return res.status(402).json({
      error: 'free_limit_reached',
      message: 'You\'ve used your free daily ATS scan. Upgrade to Pro for unlimited scans.'
    });
  }

  try {
    const msg = await anthropic.messages.create({
      model: 'claude-sonnet-4-6',
      max_tokens: 1024,
      messages: [{
        role: 'user',
        content: `You are an expert ATS (Applicant Tracking System) analyst. Analyze how well this resume matches the job description.

Return ONLY valid JSON in this exact format — no markdown, no explanation, nothing else:
{
  "score": <integer 0-100>,
  "verdict": "<exactly one of: Strong Match, Good Match, Fair Match, Weak Match>",
  "matched": [<array of strings — keywords and phrases found in both resume and job description, max 20>],
  "missing": [<array of strings — critical keywords from the job description missing from the resume, max 15>],
  "suggestions": [<array of 4-5 strings — specific, actionable rewrite suggestions referencing exact words from the job posting>]
}

Scoring guide:
- 80-100: Strong Match — most required skills and keywords are present
- 60-79: Good Match — many key requirements covered, minor gaps
- 40-59: Fair Match — partial match, significant missing keywords
- 0-39: Weak Match — poor match, major gaps

Be specific in suggestions — name the exact keyword and where to add it.

RESUME:
${resume.slice(0, 4000)}

JOB DESCRIPTION:
${jobPosting.slice(0, 4000)}`
      }]
    });

    const raw = msg.content[0].text.trim();
    const jsonMatch = raw.match(/\{[\s\S]*\}/);
    if (!jsonMatch) throw new Error('No JSON in response');
    const result = JSON.parse(jsonMatch[0]);

    if (!subscribed) consumeFreeTier(usageKey, 'ats_scan');
    res.json(result);
  } catch(e) {
    console.error('ATS scan error:', e.message);
    res.status(500).json({ error: 'Analysis failed. Please try again.' });
  }
});

// ─── API: Tailor resume ───────────────────────────────────────────────────────
app.post('/api/tailor', async (req, res) => {
  const { resume, jobPosting, mode, email } = req.body;

  if (!['resume', 'cover_letter', 'both'].includes(mode)) {
    return res.status(400).json({ error: 'Invalid mode.' });
  }
  if (!jobPosting) {
    return res.status(400).json({ error: 'Job posting is required.' });
  }
  if (mode !== 'cover_letter' && !resume) {
    return res.status(400).json({ error: 'Resume is required.' });
  }

  const usageKey = getUsageKey(req);
  const subscribed = isSubscriber(email);

  if (!subscribed) {
    const resumeLeft = hasFreeTierLeft(usageKey, 'resume');
    const coverLeft = hasFreeTierLeft(usageKey, 'cover_letter');

    if (mode === 'resume' && !resumeLeft) {
      return res.status(402).json({ error: 'free_limit_reached', mode: 'resume', message: 'You\'ve used your free daily resume tailoring. Upgrade to Pro for unlimited access.' });
    }
    if (mode === 'cover_letter' && !coverLeft) {
      return res.status(402).json({ error: 'free_limit_reached', mode: 'cover_letter', message: 'You\'ve used your free daily cover letter. Upgrade to Pro for unlimited access.' });
    }
    if (mode === 'both' && !resumeLeft && !coverLeft) {
      return res.status(402).json({ error: 'free_limit_reached', mode: 'both', message: 'You\'ve used your free daily tailorings. Upgrade to Pro for unlimited access.' });
    }
  }

  try {
    // Detect Chinese job board context to add bilingual keyword guidance
    const chinesePlatformHints = ['zhipin.com', 'liepin.com', 'zhaopin.com', 'boss直聘', 'bosszhipin', '猎聘', '智联招聘', 'lagou.com', '拉勾'];
    const isChineseMarket = chinesePlatformHints.some(h => jobPosting.toLowerCase().includes(h.toLowerCase()));

    const systemPrompt = `You are a senior professional resume writer and executive career strategist with 20+ years placing candidates at Fortune 500 companies, elite startups, and leading multinational corporations (MNCs) across global markets. Your writing is indistinguishable from a human expert — specific, grounded, and free of AI clichés.

DEEP ANALYSIS PROTOCOL — apply to every job posting before writing:
1. Extract the CORE COMPETENCIES: the 3–5 capabilities the hiring manager truly needs (not just listed requirements).
2. Identify PROOF POINTS the job signals: specific metrics, scale indicators, tools, methodologies, and team dynamics they describe.
3. Note LANGUAGE FINGERPRINTS: exact phrases, industry jargon, and verbs the job posting uses — mirror these precisely.
4. Assess the SENIORITY SIGNAL: leadership scope, strategic vs. tactical balance, budget/team ownership expectations.
5. Flag any DIFFERENTIATOR GAPS the candidate can address with their strongest achievements.
6. MULTINATIONAL CORPORATION (MNC) DETECTION: If the posting is from or targets a global/multinational company, identify and prioritize:
   - Cross-border collaboration and global stakeholder management keywords
   - Compliance standards (ISO, SOX, GDPR, local regulatory frameworks)
   - International market expansion, P&L ownership across geographies
   - Keywords valued by leading MNCs: "cross-functional", "matrixed organization", "global alignment", "go-to-market", "OKRs/KPIs at scale"
   - For Chinese technology MNCs (Alibaba/阿里巴巴, Tencent/腾讯, Baidu/百度, Huawei/华为, ByteDance/字节跳动, Xiaomi/小米, JD.com/京东, NetEase/网易, Meituan/美团, DiDi/滴滴): emphasize digital ecosystem thinking, rapid iteration, product-market fit in high-growth markets, operational efficiency at massive scale, and data-driven decision-making
   - For Western MNCs hiring in Asian markets: cultural bridge capabilities, local market expertise, bilingual communication skills${isChineseMarket ? '\n7. CHINESE JOB MARKET: This posting appears to be from a Chinese job platform (Boss直聘, 猎聘, or 智联招聘). Optimize for Chinese market expectations: emphasize team collaboration (团队协作), results-orientation (结果导向), continuous learning (持续学习), and align keywords with common Chinese HR screening criteria.' : ''}

WRITING STANDARDS — non-negotiable:
- Every bullet must contain a measurable outcome OR a clear scope indicator (e.g. "across 12 markets", "for 200K+ users", "$4M portfolio")
- Use the job's exact language where the candidate's experience warrants it — do not invent synonyms
- Strip all weak openers: never start a bullet with "Responsible for", "Helped", "Assisted", "Worked on", "Involved in", "Supported", "Contributed to", or any passive construction
- No filler phrases: no "leveraged", "utilized", "spearheaded synergies", "dynamic environment", "results-driven", "detail-oriented", "team player", "hard worker", or similar hollow clichés
- Every bullet must begin with a powerful past-tense action verb that implies ownership: Led, Built, Drove, Grew, Cut, Launched, Engineered, Negotiated, Redesigned, Secured, Scaled, Automated, Trained, Managed, Delivered
- Summaries must be specific to this exact role — not generic career overviews. Name the role and company type if known.
- The output must read as if a real senior career coach wrote it, not an AI`;

    let userPrompt = '';

    if (mode === 'resume' || mode === 'both') {
      userPrompt += `## Task: Deeply tailor the resume below to the specific job posting.

A resume is a FACTUAL CREDENTIAL DOCUMENT — not a narrative, not a letter. It uses implied third-person (no "I"), bullet points, and quantified achievements. It answers "What has this person accomplished?" in a scannable, ATS-optimized format. No storytelling, no motivation, no personality — just clean, powerful facts.

**Step 1 — Analyze the job posting:**
Before writing, silently identify: (a) the 3 most critical competencies this role demands, (b) the measurable proof points the hiring manager wants to see, (c) the exact vocabulary and keywords they use.

**Step 2 — Tailor the resume:**
Rules (all mandatory):
- Include EVERY job, position, and role from the original resume — never omit or merge entries
- Never fabricate experience, credentials, or metrics — only reframe what the candidate actually did
- Rewrite every bullet to foreground measurable impact and mirror the job's language
- Prioritize and reorder bullets within each job: most relevant achievements first
- Rewrite the summary to speak directly to this specific role and company type
- Every bullet starts with a strong past-tense action verb (never "Responsible for", "Helped", etc.)
- Quantify results wherever possible: %, $, headcount, timeframes, scale
- No periods at end of bullets (standard resume convention)
- ALL section headers in ALL CAPS: EXPERIENCE, EDUCATION, SKILLS, SUMMARY, CERTIFICATIONS
- Plain text output only — no markdown, no asterisks, no hash symbols

## Output format (follow exactly — do not add extra blank lines or deviate):
[Full Name]
[City, State | Phone | Email]

SUMMARY
[2–3 sentences targeting this specific role — specific, not generic]

EXPERIENCE
[Job Title]
[Company | Start – End]
• [bullet with action verb + measurable outcome]
• [bullet with action verb + measurable outcome]

[Repeat for ALL jobs in the original resume — every position must appear]

EDUCATION
[Degree]
[School | Year]

SKILLS
[comma-separated list using the job posting's terminology where applicable]

## Candidate Resume:
${resume}

## Job Posting:
${jobPosting}

---
OUTPUT: Tailored Resume
`;
    }

    if (mode === 'cover_letter' || mode === 'both') {
      if (mode === 'both') userPrompt += '\n\n===COVER_LETTER_START===\n\n';
      userPrompt += `## Task: Write a cover letter that COMPLEMENTS — not repeats — the attached resume.

FUNDAMENTAL DIFFERENCE between these two documents:
- The RESUME (already written) is a factual credential inventory: bullet points, no "I", quantified metrics, implied third-person, ATS keywords. It answers "What have you done?"
- The COVER LETTER (your task now) is a personal first-person argument. It answers "Why do you want THIS role at THIS company, and why should they choose you as a person?" It adds motivation, personality, and narrative context that a resume structurally cannot provide.

**Step 1 — Analyze before writing:**
(a) What is THIS company's specific mission, product, or industry challenge — what makes them different?
(b) What ONE achievement from the candidate's background is the strongest match for the core need of this role?
(c) What is the posting's tone — technical startup, enterprise, creative, analytical? Match it precisely.

**Step 2 — Write the letter using this exact 4-paragraph structure:**

PARAGRAPH 1 — OPENING HOOK (2–3 sentences):
Why THIS company, why THIS role, why now. Reference something specific and real about the company — their product, market position, a problem they're solving, or the industry context. This must be impossible to copy-paste to another application. NEVER start with "I am writing to express my interest" or any variation of that phrase.

PARAGRAPH 2 — ACHIEVEMENT STORY (3–5 sentences):
Pick the ONE achievement from the candidate's background that most directly maps to what this role needs. Tell it as a brief narrative story — describe the situation or challenge, what the candidate did, and the specific outcome. Do NOT list multiple achievements like a resume. Write it as a person speaking, not as a bullet point expanded into prose. Use concrete numbers or scope only where they add meaning to the story.

PARAGRAPH 3 — BROADER FIT & MOTIVATION (3–4 sentences):
Why is this candidate right for this role beyond that one story? Connect their broader skills, working style, or values to what this company needs. This paragraph should feel personal and genuine — it should reveal something about who they are as a professional, not just repeat more credentials. Tie their career direction to this specific opportunity.

PARAGRAPH 4 — CLOSING (2–3 sentences):
A direct, confident close. State briefly what they would bring on day one. Invite a conversation — not "I hope to hear from you" (that's passive and weak), but something forward-leaning and assured.

CRITICAL RULES — the cover letter must read like a different document from the resume:
- Write entirely in first person throughout ("I", "my", "I've built", "I believe") — this is the clearest signal it's a different document
- NEVER copy resume bullet text verbatim or near-verbatim — paraphrase into natural conversational prose
- Do NOT produce a list of multiple achievements; tell one story well
- Show genuine enthusiasm for this specific company — not a generic "I am passionate about opportunities"
- Warm, confident, human tone — not stiff corporate-speak, not buzzword-heavy
- Every sentence must be grammatically complete with correct punctuation
- No bullet points, no section headers inside the letter body
- Plain text output only — no markdown symbols

## Output format (follow exactly):
[Full Name]
[City, State | Phone | Email]

[Paragraph 1]

[Paragraph 2]

[Paragraph 3]

[Paragraph 4]

Sincerely,
[Full Name]

## Candidate Resume:
${resume}

## Job Posting:
${jobPosting}

---
OUTPUT: Cover Letter
`;
    }

    const message = await anthropic.messages.create({
      model: 'claude-sonnet-4-6',
      max_tokens: 8192,
      system: systemPrompt,
      messages: [{ role: 'user', content: userPrompt }]
    });

    if (!subscribed) {
      if (mode === 'resume' || mode === 'both') consumeFreeTier(usageKey, 'resume');
      if (mode === 'cover_letter' || mode === 'both') consumeFreeTier(usageKey, 'cover_letter');
    }

    res.json({ result: message.content[0].text });

    const who = email ? email : `anonymous (${usageKey})`;
    const what = mode === 'both' ? 'a resume + cover letter' : (mode === 'cover_letter' ? 'a cover letter' : 'a resume');
    notifyOwner(`[ResumeTailored] Tailored: ${who}`,
      `<p>✍️ <strong>${who}</strong> just tailored <strong>${what}</strong>${subscribed ? ' (Pro)' : ' (free tier)'}.</p>`);
  } catch (err) {
    console.error('Claude API error:', err?.status, err?.message || err);
    let userMessage = 'AI processing failed. Please try again.';
    if (err?.status === 401) userMessage = 'AI service authentication error. Please contact support.';
    else if (err?.status === 429) userMessage = 'AI is rate limited. Please wait a moment and try again.';
    else if (err?.status >= 500 || err?.message?.toLowerCase().includes('overloaded')) userMessage = 'AI service is temporarily busy. Please try again in 30 seconds.';
    res.status(500).json({ error: userMessage });
  }
});

// ─── API: Generate an animated resume highlight video (Remotion) ──────────────
// Renders the tailored resume into a short vertical MP4 the user can share on
// LinkedIn / Shorts / Reels. Rendering is CPU-heavy, so we serve one at a time
// and lazy-load the Remotion packages only when the first video is requested.
// Single in-flight render lock. We record WHEN the render started rather than a
// bare boolean so a hung render (e.g. the headless browser stalls during launch)
// can't brick the feature until the next process restart: a request arriving
// after MAX_RENDER_MS steals the stale lock. Each render is also wrapped in an
// overall timeout so a hang becomes a surfaced error instead of an infinite wait.
let videoRenderStartedAt = 0;
const MAX_RENDER_MS = 6 * 60 * 1000;

function videoRenderBusy() {
  if (!videoRenderStartedAt) return false;
  if (Date.now() - videoRenderStartedAt > MAX_RENDER_MS) {
    console.warn('[resume-video] Stale render lock held too long — releasing it.');
    videoRenderStartedAt = 0;
    return false;
  }
  return true;
}

// Reject `promise` if it doesn't settle within `ms` (the underlying work may keep
// running, but the request stops waiting and the lock is freed).
function withTimeout(promise, ms, label) {
  let timer;
  const timeout = new Promise((_, reject) => {
    timer = setTimeout(() => reject(new Error(`${label} timed out after ${Math.round(ms / 1000)}s`)), ms);
  });
  return Promise.race([promise, timeout]).finally(() => clearTimeout(timer));
}

// Async render jobs. A render takes ~2 minutes, which is far too long to hold a
// single HTTP request open — mobile carrier NAT/proxies drop connections that
// sit idle (no bytes flowing) for ~30–60s, and phone browsers throttle
// backgrounded tabs, so the request dies before the MP4 is ready (this is why a
// render that worked on desktop wifi failed on a phone). Instead the POST kicks
// off a background job and returns a jobId immediately; the client polls a tiny
// status endpoint and downloads the finished file separately. Every request
// stays short, so a dropped connection just means the next poll reconnects.
const videoJobs = new Map(); // jobId -> { status, outPath, error, startedAt, finishedAt }
const VIDEO_JOB_TTL_MS = 10 * 60 * 1000;

function cleanupVideoJobs() {
  const now = Date.now();
  for (const [id, job] of videoJobs) {
    if (job.finishedAt && now - job.finishedAt > VIDEO_JOB_TTL_MS) {
      if (job.outPath) fs.unlink(job.outPath, () => {});
      videoJobs.delete(id);
    }
  }
}

// Build props, generate narration, and render the MP4 for a job in the
// background. Releases the in-flight render lock when finished (success or not).
async function runVideoRender(jobId, body, mods) {
  const job = videoJobs.get(jobId);
  if (!job) return;
  const { renderModule, parseModule } = mods;
  const { resume, name, accentColor, voice, photoUrl, voiceGender, recipientName, recipientTitle, email, speed, outro } = body || {};
  const subscribed = isSubscriber(email);
  const outPath = path.join(os.tmpdir(), `resume-video-${jobId}.mp4`);
  try {
    const props = parseModule.parseResume(resume, {
      accentColor: typeof accentColor === 'string' ? accentColor : undefined,
    });
    if (name && typeof name === 'string' && name.trim().length >= 2 && /[A-Za-z]/.test(name)) {
      props.name = name.trim().slice(0, 60);
    }

    // Optional candidate photo (small, client-downscaled image data URL).
    if (typeof photoUrl === 'string' &&
        /^data:image\/(png|jpe?g|webp);base64,/i.test(photoUrl) &&
        photoUrl.length < 800000) {
      props.photoUrl = photoUrl;
    }

    // Optional recipient the video is addressed to (e.g. the hiring manager).
    if (typeof recipientName === 'string' && recipientName.trim()) {
      props.recipientName = recipientName.trim().slice(0, 60);
      if (typeof recipientTitle === 'string' && recipientTitle.trim()) {
        props.recipientTitle = recipientTitle.trim().slice(0, 80);
      }
    }

    // Optional closing line (a preset key or custom text); resolved + capped in
    // data.js (outroText). Defaults to a polite thank-you when absent.
    if (typeof outro === 'string' && outro.trim()) {
      props.outro = outro.trim().slice(0, 400);
    }

    // Quiet background music bed (best-effort; BACKGROUND_MUSIC=off to disable).
    try {
      const music = require('./remotion/music').backgroundMusic();
      if (music && music.src) props.musicSrc = music.src;
    } catch (_) { /* no music */ }

    // Optional voiceover. Subscribers get the studio-quality ElevenLabs voice
    // (server owner's key) when configured. Best-effort: any failure ⇒ silent video.
    if (voice !== false) {
      try {
        const allowEleven = subscribed || process.env.ELEVENLABS_FREE_TIER === 'on';
        const vg = (voiceGender === 'male' || voiceGender === 'female') ? voiceGender : undefined;
        // Optional specific voice the user picked from the catalog (validated in
        // resolveVoiceId); falls back to the per-gender default if unknown.
        const voiceKey = typeof voice === 'string' ? voice : undefined;
        // Optional subscriber-chosen narration pace (clamped in narration.js).
        const spd = (speed != null && Number.isFinite(Number(speed))) ? Number(speed) : undefined;
        const vo = await require('./remotion/narration').generateNarrationAsync(props, { allowEleven, voiceGender: vg, voice: voiceKey, speed: spd });
        if (vo && vo.src) {
          const { FPS } = require('./remotion/data');
          props.audioSrc = vo.src;
          props.audioDurationInFrames = Math.ceil((vo.seconds || 0) * FPS);
          if (vo.segments && vo.segments.length) props.segments = vo.segments;
        }
      } catch (e) {
        console.error('Narration unavailable:', e.message);
      }
    }

    try {
      await withTimeout(renderModule.renderResumeVideo(props, outPath), MAX_RENDER_MS, 'Video render');
    } catch (err) {
      // If a render with audio fails, retry once without it so the user still
      // gets a (silent) video rather than an error.
      if (props.audioSrc) {
        console.error('Render with audio failed, retrying silent:', err?.message || err);
        delete props.audioSrc;
        delete props.audioDurationInFrames;
        delete props.segments;
        await withTimeout(renderModule.renderResumeVideo(props, outPath), MAX_RENDER_MS, 'Video render (silent retry)');
      } else {
        throw err;
      }
    }
    job.outPath = outPath;
    job.status = 'done';
  } catch (err) {
    console.error('Video render error:', err?.message || err);
    fs.unlink(outPath, () => {});
    job.error = String(err?.message || err).slice(0, 200);
    job.status = 'error';
  } finally {
    job.finishedAt = Date.now();
    videoRenderStartedAt = 0;
    cleanupVideoJobs();
  }
}

// The list of narration voices the picker offers (labels only — no raw IDs).
app.get('/api/video-voices', (req, res) => {
  try {
    const voices = require('./remotion/narration').videoVoiceOptions();
    res.json({ voices });
  } catch (_) {
    res.json({ voices: [] });
  }
});

// The list of closing-line (outro) presets the picker offers.
app.get('/api/video-outros', (req, res) => {
  try {
    const outros = require('./remotion/data').outroOptions();
    res.json({ outros });
  } catch (_) {
    res.json({ outros: [] });
  }
});

// Start a render job. Returns a jobId immediately; the heavy work runs in the
// background so the request doesn't have to stay open for the whole ~2-min
// render (which mobile networks won't tolerate). Poll /status and fetch /file.
app.post('/api/resume-video', (req, res) => {
  const { resume, email } = req.body || {};
  if (!resume || !resume.trim()) {
    return res.status(400).json({ error: 'Tailored resume text is required.' });
  }

  // The resume video is a Pro feature — subscribers (and the owner) only.
  if (!isSubscriber(email)) {
    return res.status(402).json({ error: 'pro_only', mode: 'video', message: 'The resume video is a Pro feature. Upgrade to Pro to generate one.' });
  }

  if (videoRenderBusy()) {
    return res.status(429).json({ error: 'busy', message: 'A video is already rendering. Please try again in a moment.' });
  }

  let renderModule, parseModule;
  try {
    renderModule = require('./remotion/render');
    parseModule = require('./remotion/parseResume');
  } catch (e) {
    console.error('Remotion not available:', e.message);
    return res.status(501).json({ error: 'Video rendering is not available on this server.' });
  }

  const jobId = uuidv4();
  videoJobs.set(jobId, { status: 'rendering', outPath: null, error: null, startedAt: Date.now(), finishedAt: 0 });
  videoRenderStartedAt = Date.now(); // hold the single-render lock for this job
  res.status(202).json({ jobId });
  // Fire-and-forget: the job updates its own status; errors are captured there.
  runVideoRender(jobId, req.body, { renderModule, parseModule }).catch((e) => {
    console.error('Unexpected render job failure:', e?.message || e);
  });
});

// Poll a render job's status: 'rendering' | 'done' | 'error' (or 404 if expired).
app.get('/api/resume-video/status/:jobId', (req, res) => {
  const job = videoJobs.get(req.params.jobId);
  if (!job) return res.status(404).json({ status: 'unknown', error: 'Render job not found or expired.' });
  res.json({ status: job.status, error: job.error || undefined });
});

// Download the finished MP4 for a job. Kept available (re-downloadable) until the
// job's TTL so a dropped download on mobile can simply be retried.
app.get('/api/resume-video/file/:jobId', (req, res) => {
  const job = videoJobs.get(req.params.jobId);
  if (!job) return res.status(404).json({ error: 'Render job not found or expired.' });
  if (job.status === 'error') return res.status(500).json({ error: job.error || 'Video generation failed.' });
  if (job.status !== 'done' || !job.outPath) return res.status(409).json({ error: 'Video is not ready yet.' });
  res.download(job.outPath, 'resume-video.mp4', (err) => {
    if (err && !res.headersSent) console.error('Video send error:', err.message);
  });
});

// ─── API: Translate resume Chinese → English ──────────────────────────────────
app.post('/api/translate-resume', async (req, res) => {
  const { resume, email } = req.body;
  if (!resume || !resume.trim()) return res.status(400).json({ error: 'Resume text is required.' });

  const usageKey = getUsageKey(req);
  const subscribed = isSubscriber(email);
  if (!subscribed && !hasFreeTierLeft(usageKey, 'translate')) {
    return res.status(402).json({ error: 'free_limit_reached', message: 'You\'ve used your free daily translation. Upgrade to Pro for unlimited access.' });
  }

  try {
    const message = await anthropic.messages.create({
      model: 'claude-sonnet-4-6',
      max_tokens: 4096,
      system: `You are an expert bilingual career consultant specializing in helping Chinese professionals apply for positions at American and international companies. You translate Chinese resumes into polished, professional English that reads naturally to Western hiring managers and ATS systems. Your translations:
- Preserve all factual content (companies, dates, metrics, titles) exactly
- Localize Chinese job titles and company descriptions for a Western audience (e.g., "互联网公司" → "tech company")
- Convert Chinese date formats and number conventions to Western style
- Use strong action verbs and clear professional English phrasing
- Do NOT add or invent any details not present in the original`,
      messages: [{
        role: 'user',
        content: `Translate the following Chinese resume into professional English. Output ONLY the translated resume text — no preamble, no explanation, no notes.\n\n${resume}`
      }]
    });

    if (!subscribed) consumeFreeTier(usageKey, 'translate');
    const translated = message.content[0]?.text || '';
    res.json({ translated });
  } catch (err) {
    console.error('Translation error:', err.message);
    let msg = 'Translation failed. Please try again.';
    if (err?.status === 429) msg = 'AI is rate limited. Please wait a moment and try again.';
    else if (err?.status >= 500) msg = 'AI service is temporarily busy. Please try again in 30 seconds.';
    res.status(500).json({ error: msg });
  }
});

// ─── API: LinkedIn profile optimizer ─────────────────────────────────────────
app.post('/api/optimize-linkedin', async (req, res) => {
  const { profileText, targetRole, email } = req.body;
  if (!profileText) return res.status(400).json({ error: 'Profile text is required.' });
  if (!targetRole)  return res.status(400).json({ error: 'Target role is required.' });

  const usageKey = getUsageKey(req);
  const subscribed = isSubscriber(email);
  if (!subscribed && !hasFreeTierLeft(usageKey, 'linkedin')) {
    return res.status(402).json({ error: 'free_limit_reached', message: 'You\'ve used your free LinkedIn optimization today. Upgrade to Pro for unlimited access.' });
  }

  try {
    const message = await anthropic.messages.create({
      model: 'claude-sonnet-4-6',
      max_tokens: 4096,
      system: `You are a LinkedIn profile strategist who has helped thousands of professionals land senior roles at top companies. You write LinkedIn copy that reads as genuinely human, avoids buzzwords, and is optimized for both the LinkedIn algorithm and real recruiters. Your output is always specific, achievement-oriented, and impossible to confuse with a generic AI-generated profile.`,
      messages: [{
        role: 'user',
        content: `## Task: Optimize this LinkedIn profile for the target role.

**Target Role:** ${targetRole}

**Analysis protocol (apply silently before writing):**
1. Extract the 4–5 keywords and phrases recruiters search when hiring for "${targetRole}"
2. Identify the candidate's 3 strongest proof points (metrics, scope, outcomes) from the profile text
3. Note any credibility signals (companies, tools, certifications) that should be prominent
4. Assess what the current profile is missing vs. best-in-class profiles for this role

**Output exactly these three sections — use these exact section headers:**

OPTIMIZED HEADLINE
[Single line, max 220 characters. Format: [Strong Identity Statement] | [Key Skill 1] • [Key Skill 2] • [Key Skill 3]. Should contain searchable keywords without sounding robotic. No emojis.]

OPTIMIZED ABOUT SECTION
[5–7 sentences, first-person, conversational but professional. Open with a specific hook (a result, a mission, or a distinctive POV — never "I am a seasoned professional"). Middle: 2–3 specific achievements with metrics that prove the headline's claims. Close: what the candidate is focused on now or looking for. Under 2,000 characters total. No buzzwords, no clichés, no hollow phrases.]

OPTIMIZED EXPERIENCE BULLETS
[For each job detected in the profile, provide 3–4 rewritten bullet points. Format:
**[Job Title] at [Company]**
• [Verb + outcome + metric or scope]
• [Verb + outcome + metric or scope]
Each bullet starts with an action verb that implies ownership. Every bullet must have a concrete outcome or scale indicator. Never start a bullet with "Responsible for", "Helped", "Assisted", or "Worked on". Mirror the language of the target role.]

## Current LinkedIn Profile:
${profileText}

---
OUTPUT: LinkedIn Optimization (three labeled sections only — no preamble or explanation)`
      }]
    });

    if (!subscribed) consumeFreeTier(usageKey, 'linkedin');
    res.json({ result: message.content[0].text });
  } catch (err) {
    console.error('LinkedIn optimizer error:', err?.status, err?.message || err);
    let userMessage = 'AI processing failed. Please try again.';
    if (err?.status === 429) userMessage = 'AI is rate limited. Please wait a moment and try again.';
    else if (err?.status >= 500) userMessage = 'AI service is temporarily busy. Please try again in 30 seconds.';
    res.status(500).json({ error: userMessage });
  }
});

// ─── API: Create Stripe checkout session ──────────────────────────────────────
app.post('/api/subscribe', async (req, res) => {
  const { email } = req.body;
  if (!email) return res.status(400).json({ error: 'Email required.' });

  try {
    const session = await stripe.checkout.sessions.create({
      payment_method_types: ['card'],
      mode: 'subscription',
      customer_email: email,
      line_items: [{ price: process.env.STRIPE_PRICE_ID, quantity: 1 }],
      success_url: `${req.headers.origin || 'http://localhost:3000'}/success.html?session_id={CHECKOUT_SESSION_ID}`,
      cancel_url: `${req.headers.origin || 'http://localhost:3000'}/dashboard`,
      metadata: { email }
    });
    res.json({ url: session.url });
  } catch (err) {
    console.error('Stripe error:', err);
    res.status(500).json({ error: 'Could not create checkout session.' });
  }
});

// ─── API: Create Stripe lifetime checkout session ─────────────────────────────
app.post('/api/subscribe-lifetime', async (req, res) => {
  const { email } = req.body;
  if (!email) return res.status(400).json({ error: 'Email required.' });

  const lifetimePriceId = process.env.STRIPE_LIFETIME_PRICE_ID;
  if (!lifetimePriceId) {
    return res.status(503).json({ error: 'Lifetime plan not yet available. Please use the monthly plan.' });
  }

  try {
    const session = await stripe.checkout.sessions.create({
      payment_method_types: ['card'],
      mode: 'payment',
      customer_email: email,
      line_items: [{ price: lifetimePriceId, quantity: 1 }],
      success_url: `${req.headers.origin || 'http://localhost:3000'}/success.html?session_id={CHECKOUT_SESSION_ID}&plan=lifetime`,
      cancel_url: `${req.headers.origin || 'http://localhost:3000'}/#pricing`,
      metadata: { email, plan: 'lifetime' }
    });
    res.json({ url: session.url });
  } catch (err) {
    console.error('Stripe lifetime error:', err);
    res.status(500).json({ error: 'Could not create checkout session.' });
  }
});

// ─── Stripe webhook: activate subscription ────────────────────────────────────
app.post('/webhook', (req, res) => {
  const sig = req.headers['stripe-signature'];
  let event;

  try {
    event = stripe.webhooks.constructEvent(req.body, sig, process.env.STRIPE_WEBHOOK_SECRET);
  } catch (err) {
    console.error('Webhook signature error:', err.message);
    return res.status(400).send(`Webhook Error: ${err.message}`);
  }

  if (event.type === 'checkout.session.completed') {
    const session = event.data.object;
    const email = (session.metadata?.email || session.customer_email || '').toLowerCase();
    if (email) {
      const isLifetime = session.metadata?.plan === 'lifetime' || session.mode === 'payment';
      // Lifetime subscribers get a sentinel customer_id so deletion webhooks never remove them
      const customerId = isLifetime ? `lifetime_${email}` : session.customer;
      db.prepare('INSERT OR REPLACE INTO subscribers (email, customer_id) VALUES (?, ?)').run(email, customerId);
      console.log(`New ${isLifetime ? 'lifetime' : 'monthly'} subscriber: ${email}`);
      const plan = isLifetime ? 'lifetime ($129)' : 'monthly ($19/mo)';
      notifyOwner(`[ResumeTailored] 💰 New ${isLifetime ? 'lifetime' : 'monthly'} subscriber: ${email}`,
        `<p>💰 <strong>${email}</strong> just subscribed — <strong>${plan}</strong>. Cha-ching!</p>`);
    }
  }

  if (event.type === 'customer.subscription.deleted') {
    const customerId = event.data.object.customer;
    // Look up the email before deleting so we can name them in the alert
    const row = db.prepare('SELECT email FROM subscribers WHERE customer_id = ?').get(customerId);
    db.prepare('DELETE FROM subscribers WHERE customer_id = ?').run(customerId);
    console.log(`Removed subscriber with customer_id: ${customerId}`);
    notifyOwner(`[ResumeTailored] Subscription canceled: ${row?.email || customerId}`,
      `<p>👋 <strong>${row?.email || `customer ${customerId}`}</strong>'s subscription was canceled.</p>`);
  }

  res.json({ received: true });
});

// ─── API: Forum ───────────────────────────────────────────────────────────────
app.get('/api/forum', (req, res) => {
  const posts = db.prepare('SELECT * FROM forum_posts ORDER BY id DESC').all();
  const replies = db.prepare('SELECT * FROM forum_replies').all();
  const replyMap = {};
  for (const r of replies) {
    if (!replyMap[r.post_id]) replyMap[r.post_id] = [];
    replyMap[r.post_id].push({ author: r.author, text: r.text, time: r.time });
  }
  res.json(posts.map(p => ({ ...p, replies: replyMap[p.id] || [] })));
});

app.post('/api/forum', (req, res) => {
  const { author, role, text } = req.body;
  if (!text || text.trim().length < 5) return res.status(400).json({ error: 'Post too short.' });
  const result = db.prepare('INSERT INTO forum_posts (author, role, time, text, likes) VALUES (?, ?, ?, ?, 0)')
    .run(author || 'Anonymous', role || 'Professional', 'just now', text.trim());
  const post = db.prepare('SELECT * FROM forum_posts WHERE id = ?').get(result.lastInsertRowid);
  res.json({ ...post, replies: [] });
});

app.post('/api/forum/:id/like', (req, res) => {
  const id = parseInt(req.params.id);
  if (!db.prepare('SELECT 1 FROM forum_posts WHERE id = ?').get(id)) return res.status(404).json({ error: 'Not found.' });
  db.prepare('UPDATE forum_posts SET likes = likes + 1 WHERE id = ?').run(id);
  const { likes } = db.prepare('SELECT likes FROM forum_posts WHERE id = ?').get(id);
  res.json({ likes });
});

app.post('/api/forum/:id/reply', (req, res) => {
  const id = parseInt(req.params.id);
  if (!db.prepare('SELECT 1 FROM forum_posts WHERE id = ?').get(id)) return res.status(404).json({ error: 'Not found.' });
  const { author, text } = req.body;
  if (!text || text.trim().length < 2) return res.status(400).json({ error: 'Reply too short.' });
  db.prepare('INSERT INTO forum_replies (post_id, author, text, time) VALUES (?, ?, ?, ?)')
    .run(id, author || 'Anonymous', text.trim(), 'just now');
  res.json({ author: author || 'Anonymous', text: text.trim(), time: 'just now' });
});

// ─── API: Career check-in ─────────────────────────────────────────────────────
app.get('/api/checkin', (req, res) => {
  const email = (req.query.email || '').toLowerCase();
  const row = email && db.prepare('SELECT * FROM check_ins WHERE email = ?').get(email);
  if (row) {
    res.json({
      lastCheckIn: row.last_check_in,
      goals: row.goals,
      currentRole: row.current_role,
      targetRole: row.target_role,
      nextPrompt: row.next_prompt || getCheckInPrompt()
    });
  } else {
    res.json({ lastCheckIn: null, goals: '', nextPrompt: getCheckInPrompt() });
  }
});

app.post('/api/checkin', (req, res) => {
  const { email, goals, currentRole, targetRole } = req.body;
  const key = (email || '').toLowerCase();
  db.prepare('INSERT OR REPLACE INTO check_ins (email, last_check_in, goals, current_role, target_role, next_prompt) VALUES (?, ?, ?, ?, ?, ?)')
    .run(key, new Date().toISOString(), goals || '', currentRole || '', targetRole || '', getCheckInPrompt());
  res.json({ success: true });
});

function getCheckInPrompt() {
  const prompts = [
    "What new skills have you developed in the last 3 months?",
    "Are you being paid what you're worth? When did you last benchmark your salary?",
    "Have you updated your resume to reflect your latest accomplishments?",
    "What's your next career move? Is it time to aim higher?",
    "Have you connected with 3 new people in your industry this quarter?",
    "What would make your work more fulfilling? Is it time for a change?"
  ];
  return prompts[Math.floor(Math.random() * prompts.length)];
}

// ─── API: Contact / Help form ─────────────────────────────────────────────────
app.post('/api/contact', async (req, res) => {
  const { name, email, subject, message } = req.body;
  if (!name || !email || !message) {
    return res.status(400).json({ error: 'Name, email, and message are required.' });
  }

  const ownerEmail = process.env.OWNER_EMAIL || 'support@resumetailored.com';

  try {
    await sendEmail({
      to: ownerEmail,
      subject: `[ResumeTailored Support] ${subject || 'New message from ' + name}`,
      replyTo: email,
      html: `
            <h2>New Support Message</h2>
            <p><strong>From:</strong> ${name} (${email})</p>
            <p><strong>Subject:</strong> ${subject || 'No subject'}</p>
            <hr />
            <p>${message.replace(/\n/g, '<br>')}</p>
            <hr />
            <p style="color:#888;font-size:12px;">Sent from ResumeTailored AI Help form</p>
          `
    });
  } catch (err) {
    console.error('[Email] Contact form send error:', err.message);
  }

  res.json({ success: true });
});

// ─── API: Admin broadcast email ───────────────────────────────────────────────
// POST /api/admin/broadcast  { secret: "ADMIN_SECRET value" }
// Returns { sent, failed, total, errors[] }
app.post('/api/admin/broadcast', async (req, res) => {
  const { secret } = req.body;
  const adminSecret = process.env.ADMIN_SECRET;
  if (!adminSecret || secret !== adminSecret) {
    return res.status(403).json({ error: 'Unauthorized' });
  }

  const allUsers = db.prepare('SELECT email, username FROM users').all();
  if (allUsers.length === 0) {
    return res.json({ sent: 0, failed: 0, total: 0, message: 'No users in database' });
  }

  let sent = 0, failed = 0;
  const errors = [];

  for (const user of allUsers) {
    try {
      await sendEmail({
        to: user.email,
        subject: "We've made some big improvements to ResumeTailored AI 🚀",
        html: broadcastEmailHtml(user.username || 'there')
      });
      sent++;
      // Small delay to stay within Resend rate limits
      await new Promise(r => setTimeout(r, 120));
    } catch (e) {
      failed++;
      errors.push({ email: user.email, error: e.message });
      console.error(`[Broadcast] Failed for ${user.email}:`, e.message);
    }
  }

  console.log(`[Broadcast] Done — sent: ${sent}, failed: ${failed}, total: ${allUsers.length}`);
  res.json({ sent, failed, total: allUsers.length, errors: errors.slice(0, 20) });
});

// GET /api/admin/users-list?secret=ADMIN_SECRET — quick email export
app.get('/api/admin/users-list', (req, res) => {
  const adminSecret = process.env.ADMIN_SECRET;
  if (!adminSecret || req.query.secret !== adminSecret) {
    return res.status(403).json({ error: 'Unauthorized' });
  }
  const rows = db.prepare('SELECT email, username FROM users ORDER BY email').all();
  res.json({ total: rows.length, users: rows });
});

function broadcastEmailHtml(username) {
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width,initial-scale=1.0" />
</head>
<body style="font-family:'Helvetica Neue',Arial,sans-serif;background:#f1f5f9;margin:0;padding:40px 16px;">
  <div style="max-width:580px;margin:0 auto;background:#ffffff;border-radius:20px;overflow:hidden;box-shadow:0 4px 32px rgba(0,0,0,0.08);">

    <!-- Header -->
    <div style="background:linear-gradient(135deg,#1d4ed8,#2563eb);padding:36px 40px;text-align:center;">
      <div style="display:inline-block;background:rgba(255,255,255,0.18);border-radius:14px;padding:10px 18px;">
        <span style="font-size:22px;font-weight:900;color:#fff;letter-spacing:-0.5px;">ResumeTailored AI</span>
      </div>
    </div>

    <!-- Body -->
    <div style="padding:40px 40px 32px;">
      <h1 style="font-size:26px;font-weight:900;color:#111827;margin:0 0 14px;line-height:1.3;">
        Hey ${username}, we've been busy 👋
      </h1>
      <p style="font-size:16px;color:#374151;line-height:1.75;margin:0 0 24px;">
        Since you first signed up, we've completely upgraded ResumeTailored AI. If you remember it as a simple resume paste tool, you're in for a real surprise.
      </p>

      <!-- What's new -->
      <div style="background:#f8fafc;border-radius:14px;padding:28px;margin-bottom:28px;border:1px solid #e5e7eb;">
        <p style="font-size:13px;font-weight:800;text-transform:uppercase;letter-spacing:1.5px;color:#2563eb;margin:0 0 20px;">What's new</p>

        <div style="display:flex;gap:14px;margin-bottom:18px;">
          <span style="font-size:22px;line-height:1;flex-shrink:0;">✍️</span>
          <div>
            <div style="font-size:15px;font-weight:700;color:#111827;margin-bottom:4px;">Resume Builder — Fill Out a Form, Get a Resume</div>
            <div style="font-size:14px;color:#6b7280;line-height:1.65;">No resume on hand? Build one from scratch directly inside the app. Fill in your experience, education, and skills — the AI takes it from there.</div>
          </div>
        </div>

        <div style="display:flex;gap:14px;margin-bottom:18px;">
          <span style="font-size:22px;line-height:1;flex-shrink:0;">🔗</span>
          <div>
            <div style="font-size:15px;font-weight:700;color:#111827;margin-bottom:4px;">LinkedIn Profile Optimizer</div>
            <div style="font-size:14px;color:#6b7280;line-height:1.65;">Paste your LinkedIn profile and target role — get an AI-rewritten headline, About section, and experience bullets that make recruiters stop scrolling.</div>
          </div>
        </div>

        <div style="display:flex;gap:14px;margin-bottom:18px;">
          <span style="font-size:22px;line-height:1;flex-shrink:0;">📄</span>
          <div>
            <div style="font-size:15px;font-weight:700;color:#111827;margin-bottom:4px;">100+ Professional Templates</div>
            <div style="font-size:14px;color:#6b7280;line-height:1.65;">56 resume templates + 48 cover letter templates designed for every industry and style. Pick one, tailor it, download it as a PDF or Word doc.</div>
          </div>
        </div>

        <div style="display:flex;gap:14px;margin-bottom:18px;">
          <span style="font-size:22px;line-height:1;flex-shrink:0;">📊</span>
          <div>
            <div style="font-size:15px;font-weight:700;color:#111827;margin-bottom:4px;">Career Hub — Salary Guides, Forum &amp; Check-Ins</div>
            <div style="font-size:14px;color:#6b7280;line-height:1.65;">Word-for-word salary negotiation scripts, a community forum to share wins and tips, and quarterly career check-ins to keep you progressing.</div>
          </div>
        </div>

        <div style="display:flex;gap:14px;">
          <span style="font-size:22px;line-height:1;flex-shrink:0;">🌐</span>
          <div>
            <div style="font-size:15px;font-weight:700;color:#111827;margin-bottom:4px;">Full Chinese Language Support (中文)</div>
            <div style="font-size:14px;color:#6b7280;line-height:1.65;">The entire dashboard is now available in Simplified Chinese. Works with Boss直聘, 猎聘, and 智联招聘 job postings — just paste and tailor.</div>
          </div>
        </div>
      </div>

      <!-- Free tier reminder -->
      <div style="background:#eff6ff;border-radius:12px;padding:18px 20px;margin-bottom:28px;border-left:4px solid #2563eb;">
        <p style="font-size:15px;font-weight:700;color:#1d4ed8;margin:0 0 4px;">Your free tier is still active</p>
        <p style="font-size:14px;color:#3b82f6;margin:0;line-height:1.6;">You still get 1 free resume tailoring + 1 free cover letter every day — no credit card needed. Come give the new version a try.</p>
      </div>

      <!-- CTA -->
      <div style="text-align:center;margin-bottom:36px;">
        <a href="https://resumetailored.com/dashboard" style="display:inline-block;background:#2563eb;color:#ffffff;font-size:18px;font-weight:800;padding:18px 48px;border-radius:12px;text-decoration:none;letter-spacing:-0.3px;">
          Go to My Dashboard →
        </a>
        <div style="margin-top:10px;font-size:13px;color:#9ca3af;">1 free tailoring waiting for you today</div>
      </div>

      <hr style="border:none;border-top:1px solid #e5e7eb;margin:0 0 24px;" />

      <p style="font-size:13px;color:#9ca3af;line-height:1.65;margin:0;">
        You're receiving this because you created an account at
        <a href="https://resumetailored.com" style="color:#2563eb;text-decoration:none;">resumetailored.com</a>.
        Don't want future emails? Simply reply to this email and we'll take you off the list immediately.
      </p>
    </div>
  </div>
</body>
</html>`;
}

const PORT = process.env.PORT || 3000;
if (require.main === module) {
  app.listen(PORT, () => console.log(`ResumeTailored running on http://localhost:${PORT}`));
}

// Exported for offline rendering/tests (e.g. DOCX alignment verification).
module.exports = { app, buildTemplatedDocxBuffer };
