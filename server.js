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
const multer = require('multer');
const pdfParse = require('pdf-parse');
const mammoth = require('mammoth');
const { Document, Packer, Paragraph, TextRun, HeadingLevel, AlignmentType, BorderStyle } = require('docx');
const Database = require('better-sqlite3');
const nodemailer = require('nodemailer');

const app = express();
const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
const stripe = new Stripe(process.env.STRIPE_SECRET_KEY);

// Warn loudly on startup if critical env vars are missing
if (!process.env.ANTHROPIC_API_KEY) console.error('STARTUP ERROR: ANTHROPIC_API_KEY is not set â€” AI tailoring will fail for all users.');
if (!process.env.STRIPE_SECRET_KEY) console.error('STARTUP ERROR: STRIPE_SECRET_KEY is not set â€” payments will fail.');
if (!process.env.STRIPE_PRICE_ID) console.error('STARTUP ERROR: STRIPE_PRICE_ID is not set â€” checkout will fail.');

// â”€â”€â”€ Email helper â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
// Priority: Resend (RESEND_API_KEY) â†’ SMTP (SMTP_USER + SMTP_PASS) â†’ console log
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
      body: JSON.stringify({ from: `ResumeTailor AI <${fromAddr}>`, to, subject, html, reply_to: effectiveReplyTo })
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
    await transporter.sendMail({ from: `ResumeTailor AI <${fromAddr || smtpUser}>`, to, subject, html, replyTo: effectiveReplyTo });
    console.log(`[SMTP] Email sent to ${to}`);
    return;
  }

  // Neither configured â€” log the content so it can be found in Railway logs
  console.log(`[EMAIL] No sender configured. Subject: "${subject}" To: ${to}`);
  console.log('[EMAIL] Set RESEND_API_KEY or SMTP_USER+SMTP_PASS in Railway env vars to enable real emails.');
}

// â”€â”€â”€ SQLite database â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
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
`);

// Seed default forum posts on first run
if (db.prepare('SELECT COUNT(*) as c FROM forum_posts').get().c === 0) {
  const ins = db.prepare('INSERT INTO forum_posts (author, role, time, text, likes) VALUES (?, ?, ?, ?, ?)');
  ins.run('Sarah M.', 'Software Engineer', '2 hours ago', 'Just accepted an offer at a Fortune 500! ResumeTailor helped me tailor 30+ applications. Happy to answer questions about the process.', 14);
  ins.run('James R.', 'Marketing Manager', '5 hours ago', 'Salary negotiation tip: always get the offer in writing before negotiating. They said my ask was "too high" verbally but came back with 8% more once I sent a counter via email. Never negotiate on the phone!', 22);
  ins.run('Priya K.', 'Product Designer', '1 day ago', 'For anyone in tech design â€” portfolio matters MORE than your resume. But a tailored resume got me the interview so I could show my portfolio. Both matter!', 9);
}

function hashPw(pw) {
  return crypto.createHash('sha256').update('rta_salt_2026_' + pw).digest('hex');
}

app.set('trust proxy', 1); // Required on Railway â€” reads real client IP from X-Forwarded-For
app.use(cors());

// Force UTF-8 charset in Content-Type for every text response.
// Hooks res.end() — the lowest-level flush point — so it fires regardless of
// whether the response comes from express.static, res.sendFile, or a route handler.
app.use((req, res, next) => {
  const _end = res.end.bind(res);
  res.end = function (chunk, encoding, callback) {
    const ct = res.getHeader('Content-Type');
    if (typeof ct === 'string' && !ct.includes('charset') &&
        (ct.startsWith('text/') || ct.startsWith('application/javascript'))) {
      res.setHeader('Content-Type', ct + '; charset=utf-8');
    }
    return _end(chunk, encoding, callback);
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

app.use(express.static(path.join(__dirname, 'public'), {
  extensions: ['html'],
  setHeaders: (res, filePath) => {
    if (filePath.endsWith('.html')) res.setHeader('Content-Type', 'text/html; charset=utf-8');
    else if (filePath.endsWith('.css')) res.setHeader('Content-Type', 'text/css; charset=utf-8');
    else if (filePath.endsWith('.js')) res.setHeader('Content-Type', 'application/javascript; charset=utf-8');
  }
}));

// Clean URL aliases â€” /dashboard, /login, /signup all serve app.html
const appHtml = path.join(__dirname, 'public', 'app.html');
const _htmlUtf8 = { headers: { 'Content-Type': 'text/html; charset=utf-8' } };
app.get('/dashboard',    (req, res) => res.sendFile(appHtml, _htmlUtf8));
app.get('/login',        (req, res) => res.sendFile(appHtml, _htmlUtf8));
app.get('/signup',       (req, res) => res.sendFile(appHtml, _htmlUtf8));
app.get('/app',          (req, res) => res.redirect(301, '/dashboard'));
const aboutHtml = path.join(__dirname, 'public', 'about.html');
app.get('/how-it-works', (req, res) => res.sendFile(aboutHtml, _htmlUtf8));
app.get('/about',        (req, res) => res.redirect(301, '/how-it-works'));
const blogIndexHtml = path.join(__dirname, 'public', 'blog', 'index.html');
app.get('/blog',         (req, res) => res.sendFile(blogIndexHtml, _htmlUtf8));

// Raw body needed for Stripe webhook verification
app.use('/webhook', express.raw({ type: 'application/json' }));
app.use(express.json());

// â”€â”€â”€ Rate limiting â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
const apiLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 30,
  message: { error: 'Too many requests, please slow down.' }
});
app.use('/api/', apiLimiter);

// â”€â”€â”€ Auth endpoints â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
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
  db.prepare('INSERT INTO users (email, username, password_hash) VALUES (?, ?, ?)').run(key, cleanUsername, hashPw(password));
  const token = uuidv4();
  db.prepare('INSERT INTO sessions (token, email) VALUES (?, ?)').run(token, key);
  res.json({ token, username: cleanUsername, email: key });

  // Welcome email â€” fire and forget, don't block the response
  try {
    await sendEmail({
      to: key,
      subject: 'Welcome to ResumeTailored AI â€” You\'re in!',
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
              Thanks for joining ResumeTailored AI. You now have access to AI-powered resume tailoring, cover letter generation, and a full career hub â€” all built to help you stand out and get hired faster.
            </p>

            <!-- Features -->
            <div style="margin-bottom:28px;">
              <div style="font-size:11px;font-weight:800;text-transform:uppercase;letter-spacing:1.5px;color:#9ca3af;margin-bottom:16px;">What's waiting for you</div>
              <div style="display:grid;gap:12px;">

                <div style="display:flex;gap:14px;align-items:flex-start;background:#f9fafb;border:1px solid #e5e7eb;border-radius:10px;padding:14px 16px;">
                  <div style="font-size:22px;line-height:1;">âœ¦</div>
                  <div>
                    <div style="font-weight:700;color:#111827;font-size:14px;margin-bottom:3px;">AI Resume Tailor</div>
                    <div style="font-size:13px;color:#6b7280;line-height:1.6;">Paste any job posting and get a resume tailored to match â€” highlighting the right keywords and experience to beat ATS filters.</div>
                  </div>
                </div>

                <div style="display:flex;gap:14px;align-items:flex-start;background:#f9fafb;border:1px solid #e5e7eb;border-radius:10px;padding:14px 16px;">
                  <div style="font-size:22px;line-height:1;">âœ‰</div>
                  <div>
                    <div style="font-weight:700;color:#111827;font-size:14px;margin-bottom:3px;">Cover Letter Generator</div>
                    <div style="font-size:13px;color:#6b7280;line-height:1.6;">Generate a personalized, professional cover letter for every application in seconds â€” not the same generic template everyone else uses.</div>
                  </div>
                </div>

                <div style="display:flex;gap:14px;align-items:flex-start;background:#f9fafb;border:1px solid #e5e7eb;border-radius:10px;padding:14px 16px;">
                  <div style="font-size:22px;line-height:1;">ðŸ’¼</div>
                  <div>
                    <div style="font-weight:700;color:#111827;font-size:14px;margin-bottom:3px;">Career Hub</div>
                    <div style="font-size:13px;color:#6b7280;line-height:1.6;">Salary guides, career check-ins, a community forum, and professional resume templates â€” everything you need in one place.</div>
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
                  <div style="font-size:13px;color:#6b7280;margin-top:3px;">1 free AI tailoring per day Â· Full template access</div>
                </div>
                <a href="https://resumetailored.com/#pricing" style="display:inline-block;background:#2563eb;color:#fff;font-weight:700;font-size:13px;padding:10px 20px;border-radius:8px;text-decoration:none;white-space:nowrap;">Upgrade to Pro â€” $19/mo â†’</a>
              </div>
            </div>

            <!-- CTA -->
            <div style="text-align:center;margin-bottom:28px;">
              <a href="https://resumetailored.com/dashboard" style="display:inline-block;background:#2563eb;color:#fff;font-weight:700;font-size:16px;padding:15px 40px;border-radius:10px;text-decoration:none;">Go to My Dashboard â†’</a>
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
            <span style="font-size:12px;color:#9ca3af;">Â© ResumeTailored AI Â· <a href="https://resumetailored.com" style="color:#2563eb;text-decoration:none;">resumetailored.com</a> Â· You're receiving this because you just created an account.</span>
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
  if (!user || user.password_hash !== hashPw(password)) {
    return res.status(401).json({ error: 'Invalid email or password.' });
  }
  const token = uuidv4();
  db.prepare('INSERT INTO sessions (token, email) VALUES (?, ?)').run(token, key);
  res.json({ token, username: user.username, email: key });

  const ownerEmail = process.env.OWNER_EMAIL || 'support@resumetailored.com';
  sendEmail({
    to: ownerEmail,
    subject: `[ResumeTailor] Login: ${key}`,
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

app.post('/api/auth/forgot-password', async (req, res) => {
  const { email } = req.body;
  if (!email) return res.status(400).json({ error: 'Email is required.' });
  const key = email.toLowerCase().trim();

  if (!db.prepare('SELECT 1 FROM users WHERE email = ?').get(key)) {
    // No account found â€” send a helpful email so the user isn't left wondering
    try {
      await sendEmail({
        to: key,
        subject: 'ResumeTailored AI â€” No Account Found',
        html: `
          <div style="font-family:'Inter',Arial,sans-serif;max-width:520px;margin:0 auto;background:#ffffff;border:1px solid #e5e7eb;border-radius:16px;overflow:hidden;">
            <div style="background:#2563eb;padding:28px 32px;">
              <div style="display:inline-flex;align-items:center;gap:10px;">
                <div style="width:36px;height:36px;background:rgba(255,255,255,0.2);border-radius:8px;display:inline-flex;align-items:center;justify-content:center;font-size:18px;font-weight:900;color:#fff;">R</div>
                <span style="font-size:18px;font-weight:800;color:#fff;">ResumeTailored <span style="background:rgba(255,255,255,0.25);padding:2px 7px;border-radius:5px;font-size:11px;">AI</span></span>
              </div>
            </div>
            <div style="padding:36px 32px;">
              <div style="font-size:36px;text-align:center;margin-bottom:16px;">ðŸ”</div>
              <h2 style="font-size:22px;font-weight:800;color:#111827;text-align:center;margin:0 0 12px;">No Account Found</h2>
              <p style="font-size:15px;color:#6b7280;line-height:1.7;text-align:center;margin:0 0 28px;">
                We couldn't find an account linked to <strong style="color:#111827;">${key}</strong>.<br/>
                You may need to create a new account â€” it only takes a minute.
              </p>
              <div style="text-align:center;margin-bottom:28px;">
                <a href="https://resumetailored.com/signup" style="display:inline-block;background:#2563eb;color:#fff;font-weight:700;font-size:16px;padding:14px 36px;border-radius:10px;text-decoration:none;">Create Account â†’</a>
              </div>
              <p style="font-size:13px;color:#9ca3af;text-align:center;line-height:1.6;margin:0;">
                If you believe this is an error, please contact us at <a href="mailto:support@resumetailored.com" style="color:#2563eb;">support@resumetailored.com</a>
              </p>
            </div>
            <div style="background:#f9fafb;border-top:1px solid #e5e7eb;padding:16px 32px;text-align:center;">
              <span style="font-size:12px;color:#9ca3af;">Â© ResumeTailored AI Â· <a href="https://resumetailored.com" style="color:#2563eb;text-decoration:none;">resumetailored.com</a></span>
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
        <div style="font-size:36px;text-align:center;margin-bottom:16px;">ðŸ”</div>
        <h2 style="font-size:22px;font-weight:800;color:#111827;text-align:center;margin:0 0 12px;">Reset Your Password</h2>
        <p style="font-size:15px;color:#6b7280;line-height:1.7;text-align:center;margin:0 0 28px;">
          We received a request to reset the password for <strong style="color:#111827;">${key}</strong>.<br/>
          This link expires in <strong style="color:#2563eb;">1 hour</strong>.
        </p>
        <div style="text-align:center;margin-bottom:28px;">
          <a href="${resetUrl}" style="display:inline-block;background:#2563eb;color:#fff;font-weight:700;font-size:16px;padding:14px 36px;border-radius:10px;text-decoration:none;">Reset My Password â†’</a>
        </div>
        <p style="font-size:13px;color:#9ca3af;text-align:center;line-height:1.6;margin:0;">
          If you didn't request this, you can safely ignore this email.<br/>
          Link not working? <a href="${resetUrl}" style="color:#2563eb;word-break:break-all;">${resetUrl}</a>
        </p>
      </div>
      <div style="background:#f9fafb;border-top:1px solid #e5e7eb;padding:16px 32px;text-align:center;">
        <span style="font-size:12px;color:#9ca3af;">Â© ResumeTailored AI Â· <a href="https://resumetailored.com" style="color:#2563eb;text-decoration:none;">resumetailored.com</a></span>
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
      subject: `[ResumeTailored] Password reset requested â€” ${key}`,
      html: `
        <div style="font-family:Arial,sans-serif;max-width:480px;margin:0 auto;background:#fff;border:1px solid #e5e7eb;border-radius:12px;padding:28px 32px;">
          <h3 style="color:#111827;margin:0 0 16px;">ðŸ”” Password Reset Request</h3>
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

  db.prepare('UPDATE users SET password_hash = ? WHERE email = ?').run(hashPw(password), record.email);
  db.prepare('DELETE FROM reset_tokens WHERE token = ?').run(token);
  db.prepare('DELETE FROM sessions WHERE email = ?').run(record.email);

  res.json({ success: true });
});

// â”€â”€â”€ File upload config â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
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

// â”€â”€â”€ API: Extract text from uploaded resume â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
app.post('/api/extract-text', upload.single('file'), async (req, res) => {
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

// â”€â”€â”€ API: Download tailored result as .docx â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
app.post('/api/download-docx', async (req, res) => {
  const { text, filename, colors, sigName, sigFont: sigFontName, pageSize } = req.body;
  if (!text) return res.status(400).json({ error: 'No text provided.' });

  const primaryHex = colors?.primary ? colors.primary.replace('#', '') : '1a237e';
  const accentHex  = colors?.accent  ? colors.accent.replace('#', '')  : '5c6bc0';

  // Page size: Letter (default, 8.5Ã—11in) or A4 (210Ã—297mm)
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

    // Section heading: all-caps, 2â€“60 chars
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
    if (/^[â€¢Â·\-\*]\s/.test(trimmed)) {
      const txt = clean.replace(/^[â€¢Â·\-\*]\s*/, '');
      children.push(new Paragraph({
        children: [new TextRun({ text: txt, font: 'Calibri', size: 22, color: '333333' })],
        bullet: { level: 0 },
        spacing: { after: 50 },
        wordWrap: true,
      }));
      continue;
    }

    // Date/company line (em-dash, en-dash, or pipe with year)
    if ((clean.includes('â€”') || clean.includes('â€“') || (clean.includes('|') && /\d{4}/.test(clean))) && clean.length < 200) {
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

  // Signature block â€” placed in document flow with proper spacing
  if (sigName && sigName.trim()) {
    const sig = sigName.trim();
    // Horizontal rule above signature
    children.push(new Paragraph({
      children: [new TextRun({ text: '', font: 'Calibri', size: 22 })],
      spacing: { before: 480 },
      border: { top: { style: BorderStyle.SINGLE, size: 6, color: 'e2e8f0', space: 4 } },
    }));
    children.push(new Paragraph({
      children: [new TextRun({ text: 'Signature', font: 'Calibri', size: 18, color: '94a3b8', allCaps: true })],
      spacing: { before: 60, after: 40 },
    }));
    // Use the closest Calibri rendition for the signature name (cursive fonts aren't embeddable in docx without the font file)
    children.push(new Paragraph({
      children: [new TextRun({ text: sig, font: 'Calibri', size: 52, bold: true, color: primaryHex, italics: true })],
      spacing: { after: 0 },
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
    subject: `[ResumeTailor] Download: ${safeName}.docx`,
    html: `<p>A user just downloaded <strong>${safeName}.docx</strong>.</p><p>Time: ${new Date().toUTCString()}</p>`
  }).catch(err => console.error('[Alert] Download email failed:', err.message));
});

// â”€â”€â”€ Helpers â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
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

function isSubscriber(email) {
  if (!email) return false;
  const ownerEmail = process.env.OWNER_EMAIL || 'support@resumetailored.com';
  if (email.toLowerCase() === ownerEmail.toLowerCase()) return true;
  return !!db.prepare('SELECT 1 FROM subscribers WHERE email = ?').get(email.toLowerCase());
}

// â”€â”€â”€ API: Health check â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
app.get('/api/health', (req, res) => {
  res.json({
    status: 'ok',
    anthropic: !!process.env.ANTHROPIC_API_KEY,
    stripe: !!process.env.STRIPE_SECRET_KEY,
    stripePrice: !!process.env.STRIPE_PRICE_ID
  });
});

// â”€â”€â”€ API: AI connection test â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
app.get('/api/test-ai', async (req, res) => {
  try {
    const modelList = await anthropic.models.list();
    const models = modelList.data.map(m => m.id);
    if (models.length === 0) {
      return res.json({ success: false, error: 'No models available on this account', models: [] });
    }
    const model = models[0];
    const msg = await anthropic.messages.create({
      model,
      max_tokens: 10,
      messages: [{ role: 'user', content: 'Say "ok"' }]
    });
    res.json({ success: true, modelUsed: model, availableModels: models, response: msg.content[0].text });
  } catch (err) {
    res.json({ success: false, status: err?.status, error: err?.message || String(err) });
  }
});

// â”€â”€â”€ API: Check usage status â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
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

// â”€â”€â”€ API: ATS scan (Claude-powered) â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
// â”€â”€â”€ API: Fetch job posting from URL â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
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
  return text.length > 8000 ? text.slice(0, 8000) + 'â€¦' : text;
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
        'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
        'Accept-Language': 'en-US,en;q=0.9,zh-CN;q=0.8',
      },
      signal: AbortSignal.timeout(10000),
    });

    if (response.status === 401 || response.status === 403) {
      return res.status(422).json({ error: 'This job board requires a login to view postings. Please copy and paste the job description text instead.' });
    }
    if (!response.ok) {
      return res.status(422).json({ error: `Could not load that page (HTTP ${response.status}). Please paste the job description manually.` });
    }

    const html = await response.text();
    const rawText = stripHtml(html);

    if (rawText.length < 100) {
      return res.status(422).json({ error: 'Could not extract job text â€” the page may require a login. Please paste the job description manually.' });
    }

    // Use Claude to extract just the job description portion
    const msg = await anthropic.messages.create({
      model: 'claude-sonnet-4-6',
      max_tokens: 2048,
      system: 'You extract job descriptions from raw webpage text. Output ONLY the job posting content â€” title, company, responsibilities, requirements, qualifications. Remove all navigation, ads, footers, related jobs, and unrelated site content. Preserve structure. No preamble.',
      messages: [{ role: 'user', content: rawText }],
    });

    const text = msg.content[0]?.text?.trim() || rawText;
    res.json({ text });
  } catch (err) {
    if (err.name === 'TimeoutError' || err.name === 'AbortError') {
      return res.status(422).json({ error: 'Request timed out. The job board may be blocking automated access â€” please paste the job description manually.' });
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

Return ONLY valid JSON in this exact format â€” no markdown, no explanation, nothing else:
{
  "score": <integer 0-100>,
  "verdict": "<exactly one of: Strong Match, Good Match, Fair Match, Weak Match>",
  "matched": [<array of strings â€” keywords and phrases found in both resume and job description, max 20>],
  "missing": [<array of strings â€” critical keywords from the job description missing from the resume, max 15>],
  "suggestions": [<array of 4-5 strings â€” specific, actionable rewrite suggestions referencing exact words from the job posting>]
}

Scoring guide:
- 80-100: Strong Match â€” most required skills and keywords are present
- 60-79: Good Match â€” many key requirements covered, minor gaps
- 40-59: Fair Match â€” partial match, significant missing keywords
- 0-39: Weak Match â€” poor match, major gaps

Be specific in suggestions â€” name the exact keyword and where to add it.

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

// â”€â”€â”€ API: Tailor resume â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
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
    const chinesePlatformHints = ['zhipin.com', 'liepin.com', 'zhaopin.com', 'bossç›´è˜', 'bosszhipin', 'çŒŽè˜', 'æ™ºè”æ‹›è˜', 'lagou.com', 'æ‹‰å‹¾'];
    const isChineseMarket = chinesePlatformHints.some(h => jobPosting.toLowerCase().includes(h.toLowerCase()));

    const systemPrompt = `You are a senior professional resume writer and executive career strategist with 20+ years placing candidates at Fortune 500 companies, elite startups, and leading multinational corporations (MNCs) across global markets. Your writing is indistinguishable from a human expert â€” specific, grounded, and free of AI clichÃ©s.

DEEP ANALYSIS PROTOCOL â€” apply to every job posting before writing:
1. Extract the CORE COMPETENCIES: the 3â€“5 capabilities the hiring manager truly needs (not just listed requirements).
2. Identify PROOF POINTS the job signals: specific metrics, scale indicators, tools, methodologies, and team dynamics they describe.
3. Note LANGUAGE FINGERPRINTS: exact phrases, industry jargon, and verbs the job posting uses â€” mirror these precisely.
4. Assess the SENIORITY SIGNAL: leadership scope, strategic vs. tactical balance, budget/team ownership expectations.
5. Flag any DIFFERENTIATOR GAPS the candidate can address with their strongest achievements.
6. MULTINATIONAL CORPORATION (MNC) DETECTION: If the posting is from or targets a global/multinational company, identify and prioritize:
   - Cross-border collaboration and global stakeholder management keywords
   - Compliance standards (ISO, SOX, GDPR, local regulatory frameworks)
   - International market expansion, P&L ownership across geographies
   - Keywords valued by leading MNCs: "cross-functional", "matrixed organization", "global alignment", "go-to-market", "OKRs/KPIs at scale"
   - For Chinese technology MNCs (Alibaba/é˜¿é‡Œå·´å·´, Tencent/è…¾è®¯, Baidu/ç™¾åº¦, Huawei/åŽä¸º, ByteDance/å­—èŠ‚è·³åŠ¨, Xiaomi/å°ç±³, JD.com/äº¬ä¸œ, NetEase/ç½‘æ˜“, Meituan/ç¾Žå›¢, DiDi/æ»´æ»´): emphasize digital ecosystem thinking, rapid iteration, product-market fit in high-growth markets, operational efficiency at massive scale, and data-driven decision-making
   - For Western MNCs hiring in Asian markets: cultural bridge capabilities, local market expertise, bilingual communication skills${isChineseMarket ? '\n7. CHINESE JOB MARKET: This posting appears to be from a Chinese job platform (Bossç›´è˜, çŒŽè˜, or æ™ºè”æ‹›è˜). Optimize for Chinese market expectations: emphasize team collaboration (å›¢é˜Ÿåä½œ), results-orientation (ç»“æžœå¯¼å‘), continuous learning (æŒç»­å­¦ä¹ ), and align keywords with common Chinese HR screening criteria.' : ''}

WRITING STANDARDS â€” non-negotiable:
- Every bullet must contain a measurable outcome OR a clear scope indicator (e.g. "across 12 markets", "for 200K+ users", "$4M portfolio")
- Use the job's exact language where the candidate's experience warrants it â€” do not invent synonyms
- Strip all weak openers: never start a bullet with "Responsible for", "Helped", "Assisted", "Worked on", "Involved in", "Supported", "Contributed to", or any passive construction
- No filler phrases: no "leveraged", "utilized", "spearheaded synergies", "dynamic environment", "results-driven", "detail-oriented", "team player", "hard worker", or similar hollow clichÃ©s
- Every bullet must begin with a powerful past-tense action verb that implies ownership: Led, Built, Drove, Grew, Cut, Launched, Engineered, Negotiated, Redesigned, Secured, Scaled, Automated, Trained, Managed, Delivered
- Summaries must be specific to this exact role â€” not generic career overviews. Name the role and company type if known.
- The output must read as if a real senior career coach wrote it, not an AI`;

    let userPrompt = '';

    if (mode === 'resume' || mode === 'both') {
      userPrompt += `## Task: Deeply tailor the resume below to the specific job posting.

**Step 1 â€” Analyze the job posting:**
Before writing, silently identify: (a) the 3 most critical competencies this role demands, (b) the measurable proof points the hiring manager wants to see, (c) the exact vocabulary and keywords they use.

**Step 2 â€” Tailor the resume:**
Rules (all mandatory):
- Include EVERY job, position, and role from the original resume â€” never omit or merge entries
- Never fabricate experience, credentials, or metrics â€” only reframe what the candidate actually did
- Rewrite every bullet to foreground measurable impact and mirror the job's language
- Prioritize and reorder bullets within each job: most relevant achievements first
- Rewrite the summary to speak directly to this specific role and company type
- Every bullet starts with a strong past-tense action verb (never "Responsible for", "Helped", etc.)
- Quantify results wherever possible: %, $, headcount, timeframes, scale
- No periods at end of bullets (standard resume convention)
- ALL section headers in ALL CAPS: EXPERIENCE, EDUCATION, SKILLS, SUMMARY, CERTIFICATIONS
- Plain text output only â€” no markdown, no asterisks, no hash symbols

## Output format (follow exactly â€” do not add extra blank lines or deviate):
[Full Name]
[City, State | Phone | Email]

SUMMARY
[2â€“3 sentences targeting this specific role â€” specific, not generic]

EXPERIENCE
[Job Title]
[Company | Start â€“ End]
â€¢ [bullet with action verb + measurable outcome]
â€¢ [bullet with action verb + measurable outcome]

[Repeat for ALL jobs in the original resume â€” every position must appear]

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
      userPrompt += `## Task: Write a distinctive, job-specific cover letter.

**Step 1 â€” Analyze before writing:**
Identify: (a) the company's specific mission or differentiator mentioned in the posting, (b) the 2â€“3 achievements from the candidate's background that best match the role's core needs, (c) the exact tone and language of the posting (technical? startup? enterprise?).

**Step 2 â€” Write the letter:**
Rules (all mandatory):
- 3â€“4 paragraphs, professional but human â€” sounds like a real person wrote it, not an AI
- Opening paragraph: a specific, compelling hook tied to THIS company or role â€” NOT "I am writing to express my interest" or any generic opener. Reference something real about the company, role challenge, or industry moment.
- Body paragraphs: connect 2â€“3 of the candidate's strongest, most relevant achievements directly to the key needs the job signals â€” always with concrete proof (metrics, scope, outcomes)
- Closing: confident, forward-looking call to action â€” no hedging ("I hope to hear from you")
- Mirror the job posting's vocabulary and tone throughout
- Every sentence must be grammatically complete with correct punctuation
- No bullet points, no section headers inside the letter body
- The letter must be impossible to send to any other company â€” it must read as written for this role only
- Plain text output only â€” no markdown symbols

## Output format (follow exactly):
[Full Name]
[City, State | Phone | Email]

[3 to 4 full paragraphs â€” each separated by a blank line]

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
  } catch (err) {
    console.error('Claude API error:', err?.status, err?.message || err);
    let userMessage = 'AI processing failed. Please try again.';
    if (err?.status === 401) userMessage = 'AI service authentication error. Please contact support.';
    else if (err?.status === 429) userMessage = 'AI is rate limited. Please wait a moment and try again.';
    else if (err?.status >= 500 || err?.message?.toLowerCase().includes('overloaded')) userMessage = 'AI service is temporarily busy. Please try again in 30 seconds.';
    res.status(500).json({ error: userMessage });
  }
});

// â”€â”€â”€ API: Translate resume Chinese â†’ English â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
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
- Localize Chinese job titles and company descriptions for a Western audience (e.g., "äº’è”ç½‘å…¬å¸" â†’ "tech company")
- Convert Chinese date formats and number conventions to Western style
- Use strong action verbs and clear professional English phrasing
- Do NOT add or invent any details not present in the original`,
      messages: [{
        role: 'user',
        content: `Translate the following Chinese resume into professional English. Output ONLY the translated resume text â€” no preamble, no explanation, no notes.\n\n${resume}`
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

// â”€â”€â”€ API: LinkedIn profile optimizer â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
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
1. Extract the 4â€“5 keywords and phrases recruiters search when hiring for "${targetRole}"
2. Identify the candidate's 3 strongest proof points (metrics, scope, outcomes) from the profile text
3. Note any credibility signals (companies, tools, certifications) that should be prominent
4. Assess what the current profile is missing vs. best-in-class profiles for this role

**Output exactly these three sections â€” use these exact section headers:**

OPTIMIZED HEADLINE
[Single line, max 220 characters. Format: [Strong Identity Statement] | [Key Skill 1] â€¢ [Key Skill 2] â€¢ [Key Skill 3]. Should contain searchable keywords without sounding robotic. No emojis.]

OPTIMIZED ABOUT SECTION
[5â€“7 sentences, first-person, conversational but professional. Open with a specific hook (a result, a mission, or a distinctive POV â€” never "I am a seasoned professional"). Middle: 2â€“3 specific achievements with metrics that prove the headline's claims. Close: what the candidate is focused on now or looking for. Under 2,000 characters total. No buzzwords, no clichÃ©s, no hollow phrases.]

OPTIMIZED EXPERIENCE BULLETS
[For each job detected in the profile, provide 3â€“4 rewritten bullet points. Format:
**[Job Title] at [Company]**
â€¢ [Verb + outcome + metric or scope]
â€¢ [Verb + outcome + metric or scope]
Each bullet starts with an action verb that implies ownership. Every bullet must have a concrete outcome or scale indicator. Never start a bullet with "Responsible for", "Helped", "Assisted", or "Worked on". Mirror the language of the target role.]

## Current LinkedIn Profile:
${profileText}

---
OUTPUT: LinkedIn Optimization (three labeled sections only â€” no preamble or explanation)`
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

// â”€â”€â”€ API: Create Stripe checkout session â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
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

// â”€â”€â”€ API: Create Stripe lifetime checkout session â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
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

// â”€â”€â”€ Stripe webhook: activate subscription â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
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
    }
  }

  if (event.type === 'customer.subscription.deleted') {
    const customerId = event.data.object.customer;
    db.prepare('DELETE FROM subscribers WHERE customer_id = ?').run(customerId);
    console.log(`Removed subscriber with customer_id: ${customerId}`);
  }

  res.json({ received: true });
});

// â”€â”€â”€ API: Forum â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
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

// â”€â”€â”€ API: Career check-in â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
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

// â”€â”€â”€ API: Contact / Help form â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
app.post('/api/contact', async (req, res) => {
  const { name, email, subject, message } = req.body;
  if (!name || !email || !message) {
    return res.status(400).json({ error: 'Name, email, and message are required.' });
  }

  const ownerEmail = process.env.OWNER_EMAIL || 'support@resumetailored.com';

  try {
    await sendEmail({
      to: ownerEmail,
      subject: `[ResumeTailor Support] ${subject || 'New message from ' + name}`,
      replyTo: email,
      html: `
            <h2>New Support Message</h2>
            <p><strong>From:</strong> ${name} (${email})</p>
            <p><strong>Subject:</strong> ${subject || 'No subject'}</p>
            <hr />
            <p>${message.replace(/\n/g, '<br>')}</p>
            <hr />
            <p style="color:#888;font-size:12px;">Sent from ResumeTailor AI Help form</p>
          `
    });
  } catch (err) {
    console.error('[Email] Contact form send error:', err.message);
  }

  res.json({ success: true });
});

// â”€â”€â”€ API: Admin broadcast email â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
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
        subject: "We've made some big improvements to ResumeTailored AI ðŸš€",
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

  console.log(`[Broadcast] Done â€” sent: ${sent}, failed: ${failed}, total: ${allUsers.length}`);
  res.json({ sent, failed, total: allUsers.length, errors: errors.slice(0, 20) });
});

// GET /api/admin/users-list?secret=ADMIN_SECRET â€” quick email export
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
        Hey ${username}, we've been busy ðŸ‘‹
      </h1>
      <p style="font-size:16px;color:#374151;line-height:1.75;margin:0 0 24px;">
        Since you first signed up, we've completely upgraded ResumeTailored AI. If you remember it as a simple resume paste tool, you're in for a real surprise.
      </p>

      <!-- What's new -->
      <div style="background:#f8fafc;border-radius:14px;padding:28px;margin-bottom:28px;border:1px solid #e5e7eb;">
        <p style="font-size:13px;font-weight:800;text-transform:uppercase;letter-spacing:1.5px;color:#2563eb;margin:0 0 20px;">What's new</p>

        <div style="display:flex;gap:14px;margin-bottom:18px;">
          <span style="font-size:22px;line-height:1;flex-shrink:0;">âœï¸</span>
          <div>
            <div style="font-size:15px;font-weight:700;color:#111827;margin-bottom:4px;">Resume Builder â€” Fill Out a Form, Get a Resume</div>
            <div style="font-size:14px;color:#6b7280;line-height:1.65;">No resume on hand? Build one from scratch directly inside the app. Fill in your experience, education, and skills â€” the AI takes it from there.</div>
          </div>
        </div>

        <div style="display:flex;gap:14px;margin-bottom:18px;">
          <span style="font-size:22px;line-height:1;flex-shrink:0;">ðŸ”—</span>
          <div>
            <div style="font-size:15px;font-weight:700;color:#111827;margin-bottom:4px;">LinkedIn Profile Optimizer</div>
            <div style="font-size:14px;color:#6b7280;line-height:1.65;">Paste your LinkedIn profile and target role â€” get an AI-rewritten headline, About section, and experience bullets that make recruiters stop scrolling.</div>
          </div>
        </div>

        <div style="display:flex;gap:14px;margin-bottom:18px;">
          <span style="font-size:22px;line-height:1;flex-shrink:0;">ðŸ“„</span>
          <div>
            <div style="font-size:15px;font-weight:700;color:#111827;margin-bottom:4px;">40 Professional Templates</div>
            <div style="font-size:14px;color:#6b7280;line-height:1.65;">20 resume templates + 20 cover letter templates designed for every industry and style. Pick one, tailor it, download it as a PDF or Word doc.</div>
          </div>
        </div>

        <div style="display:flex;gap:14px;margin-bottom:18px;">
          <span style="font-size:22px;line-height:1;flex-shrink:0;">ðŸ“Š</span>
          <div>
            <div style="font-size:15px;font-weight:700;color:#111827;margin-bottom:4px;">Career Hub â€” Salary Guides, Forum &amp; Check-Ins</div>
            <div style="font-size:14px;color:#6b7280;line-height:1.65;">Word-for-word salary negotiation scripts, a community forum to share wins and tips, and quarterly career check-ins to keep you progressing.</div>
          </div>
        </div>

        <div style="display:flex;gap:14px;">
          <span style="font-size:22px;line-height:1;flex-shrink:0;">ðŸŒ</span>
          <div>
            <div style="font-size:15px;font-weight:700;color:#111827;margin-bottom:4px;">Full Chinese Language Support (ä¸­æ–‡)</div>
            <div style="font-size:14px;color:#6b7280;line-height:1.65;">The entire dashboard is now available in Simplified Chinese. Works with Bossç›´è˜, çŒŽè˜, and æ™ºè”æ‹›è˜ job postings â€” just paste and tailor.</div>
          </div>
        </div>
      </div>

      <!-- Free tier reminder -->
      <div style="background:#eff6ff;border-radius:12px;padding:18px 20px;margin-bottom:28px;border-left:4px solid #2563eb;">
        <p style="font-size:15px;font-weight:700;color:#1d4ed8;margin:0 0 4px;">Your free tier is still active</p>
        <p style="font-size:14px;color:#3b82f6;margin:0;line-height:1.6;">You still get 1 free resume tailoring + 1 free cover letter every day â€” no credit card needed. Come give the new version a try.</p>
      </div>

      <!-- CTA -->
      <div style="text-align:center;margin-bottom:36px;">
        <a href="https://resumetailored.com/dashboard" style="display:inline-block;background:#2563eb;color:#ffffff;font-size:18px;font-weight:800;padding:18px 48px;border-radius:12px;text-decoration:none;letter-spacing:-0.3px;">
          Go to My Dashboard â†’
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
app.listen(PORT, () => console.log(`ResumeTailor running on http://localhost:${PORT}`));
