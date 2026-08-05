require('dotenv').config();
const express = require('express');
const compression = require('compression');
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
const { Document, Packer, Paragraph, TextRun, HeadingLevel, AlignmentType, BorderStyle, Table, TableRow, TableCell, WidthType, VerticalAlign, ShadingType, HeightRule, ImageRun, Footer } = require('docx');
const Database = require('better-sqlite3');
const nodemailer = require('nodemailer');
const CH = require('./career-hub.js');           // Career Hub pure core (taxonomy, prompts, validators, scoring)
const EH = require('./employer-hub.js');         // Employer Portal pure core (validation, limits, ranking)
const JP = require('./job-providers.js');        // Multi-source live job search (Adzuna, JSearch, free fallbacks)
const { renderBadgePage } = require('./badge-page.js');
/* Video duration probing for site-media uploads. This is `@remotion/media-parser`
   — a pure container-format parser (reads MP4/WebM/MOV box headers for their
   declared duration), not the heavy render stack. It needs no browser and no
   chrome-headless-shell, so it stays available even in an environment where
   @remotion/renderer's video pipeline is not (the resume-video route already
   degrades to 501 there; this must not take the whole server down with it). */
let _parseMedia = null, _mediaParserController = null, _mediaParserNodeReader = null;
try {
  ({ parseMedia: _parseMedia, mediaParserController: _mediaParserController } = require('@remotion/media-parser'));
  ({ nodeReader: _mediaParserNodeReader } = require('@remotion/media-parser/node'));
} catch (e) {
  console.error('STARTUP ERROR: @remotion/media-parser failed to load — the 2-minute video cap will not be enforced:', e.message);
}

const app = express();
app.disable('x-powered-by');
// Gzip every compressible response (the landing page alone is ~237KB of HTML
// raw, ~40KB gzipped) — Railway's proxy does not compress for us.
app.use(compression());
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

/* The one templated email in the codebase read from its own file rather than
   inlined as a template literal (every other email here — password reset,
   owner alerts — is inline). Read fresh per send: publish is a rare, human-
   paced action, so there is no meaningful cost to re-reading a small file,
   and it means editing emails/publish-success.html takes effect without a
   restart. `{{TOKEN}}` substitution, not a real templating engine — the only
   values that ever go in here are a URL this server just built itself. */
function _publishSuccessEmailHtml(siteUrl, editorUrl) {
  const tplPath = path.join(__dirname, 'emails', 'publish-success.html');
  let tpl = fs.readFileSync(tplPath, 'utf8');
  const display = siteUrl.replace(/^https?:\/\//, '');
  tpl = tpl.replace(/\{\{SITE_URL_DISPLAY\}\}/g, _escHtml(display));
  tpl = tpl.replace(/\{\{SITE_URL\}\}/g, siteUrl);
  tpl = tpl.replace(/\{\{EDITOR_URL\}\}/g, editorUrl);
  return tpl;
}

/* Fire-and-forget, same shape as notifyOwner: never blocks or throws into the
   request path that triggered it. A failed send is logged and nothing else —
   the site is published either way, and the in-app toast + success page
   already told the user so; the email is a nice-to-have on top; it must
   never be the thing that makes a successful publish look like it failed. */
function _sendPublishSuccessEmail(email, siteUrl, origin) {
  try {
    const html = _publishSuccessEmailHtml(siteUrl, `${origin}/app.html`);
    sendEmail({ to: email, subject: '🌐 Your ResumeTailored website is now live!', html })
      .catch((err) => console.error('[Publish email] Failed:', err && err.message));
  } catch (err) {
    console.error('[Publish email] Failed to build:', err && err.message);
  }
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
  CREATE TABLE IF NOT EXISTS saved_cover_letters (
    id         INTEGER PRIMARY KEY AUTOINCREMENT,
    email      TEXT NOT NULL,
    title      TEXT NOT NULL DEFAULT 'Cover Letter',
    content    TEXT NOT NULL,
    created_at INTEGER NOT NULL
  );
  CREATE INDEX IF NOT EXISTS idx_saved_cover_letters_email ON saved_cover_letters(email);
  CREATE TABLE IF NOT EXISTS saved_videos (
    id         INTEGER PRIMARY KEY AUTOINCREMENT,
    email      TEXT NOT NULL,
    title      TEXT NOT NULL DEFAULT 'Resume Video',
    path       TEXT NOT NULL,
    source     TEXT NOT NULL DEFAULT 'generated',
    bytes      INTEGER NOT NULL DEFAULT 0,
    created_at INTEGER NOT NULL
  );
  CREATE INDEX IF NOT EXISTS idx_saved_videos_email ON saved_videos(email);
  CREATE TABLE IF NOT EXISTS site_media (
    id         INTEGER PRIMARY KEY AUTOINCREMENT,
    email      TEXT NOT NULL,
    kind       TEXT NOT NULL,
    path       TEXT NOT NULL,
    mime       TEXT NOT NULL,
    bytes      INTEGER NOT NULL DEFAULT 0,
    created_at INTEGER NOT NULL
  );
  CREATE INDEX IF NOT EXISTS idx_site_media_email ON site_media(email);
  CREATE TABLE IF NOT EXISTS site_leads (
    id         INTEGER PRIMARY KEY AUTOINCREMENT,
    sub        TEXT NOT NULL,
    email      TEXT NOT NULL,
    name       TEXT DEFAULT '',
    visitor_email TEXT DEFAULT '',
    message    TEXT DEFAULT '',
    created_at INTEGER NOT NULL
  );
  CREATE INDEX IF NOT EXISTS idx_site_leads_email ON site_leads(email);
  CREATE TABLE IF NOT EXISTS site_visits (
    id            INTEGER PRIMARY KEY AUTOINCREMENT,
    sub           TEXT NOT NULL,
    ts            INTEGER NOT NULL,
    referrer_host TEXT DEFAULT ''
  );
  CREATE INDEX IF NOT EXISTS idx_site_visits_sub ON site_visits(sub);
  CREATE TABLE IF NOT EXISTS shared_resumes (
    slug         TEXT PRIMARY KEY,
    name         TEXT,
    text         TEXT NOT NULL,
    accent       TEXT,
    primary_hex  TEXT,
    serif        INTEGER DEFAULT 0,
    photo        TEXT,
    hide_contact INTEGER DEFAULT 0,
    created_at   INTEGER NOT NULL,
    expires_at   INTEGER,
    views        INTEGER DEFAULT 0
  );
  /* Where an address used to point. When someone changes their web address the
     old one must not simply die — they may already have put it on an
     application, and a bare 404 tells the reader nothing. */
  CREATE TABLE IF NOT EXISTS site_aliases (
    old_sub    TEXT PRIMARY KEY,
    new_sub    TEXT NOT NULL,
    email      TEXT NOT NULL,
    created_at INTEGER NOT NULL
  );
  CREATE INDEX IF NOT EXISTS idx_site_aliases_new ON site_aliases(new_sub);

  CREATE TABLE IF NOT EXISTS personal_sites (
    subdomain    TEXT PRIMARY KEY,
    email        TEXT NOT NULL,
    name         TEXT,
    text         TEXT NOT NULL,
    accent       TEXT,
    primary_hex  TEXT,
    serif        INTEGER DEFAULT 0,
    photo        TEXT,
    hide_contact INTEGER DEFAULT 0,
    layout       TEXT,
    published    INTEGER DEFAULT 1,
    created_at   INTEGER NOT NULL,
    updated_at   INTEGER NOT NULL,
    views        INTEGER DEFAULT 0
  );

  /* ─── Career Hub ─────────────────────────────────────────────────────────
     Cross-user CONTENT caches (quiz/interview/gap/scenario/job) are keyed by a
     content hash + PROMPT_VERSION, so an identical request is generated once
     for the whole user base and then bills nothing. Per-user tables track
     attempts, badges, practice progress, saved jobs and reports. */
  CREATE TABLE IF NOT EXISTS quiz_cache (
    cache_key     TEXT PRIMARY KEY,
    profession_id TEXT NOT NULL,
    seniority     TEXT,
    topic         TEXT,
    payload       TEXT NOT NULL,
    created_at    INTEGER NOT NULL
  );
  CREATE TABLE IF NOT EXISTS skill_attempts (
    id            INTEGER PRIMARY KEY AUTOINCREMENT,
    email         TEXT NOT NULL,
    profession_id TEXT NOT NULL,
    topic         TEXT,
    score         INTEGER NOT NULL DEFAULT 0,
    band          TEXT,
    taken_at      INTEGER NOT NULL
  );
  CREATE INDEX IF NOT EXISTS idx_skill_attempts_email ON skill_attempts(email, profession_id);
  CREATE TABLE IF NOT EXISTS badges (
    slug          TEXT PRIMARY KEY,
    email         TEXT NOT NULL,
    profession_id TEXT NOT NULL,
    topic         TEXT,
    band          TEXT NOT NULL,
    score         INTEGER NOT NULL,
    created_at    INTEGER NOT NULL
  );
  CREATE INDEX IF NOT EXISTS idx_badges_email ON badges(email);
  CREATE TABLE IF NOT EXISTS interview_cache (
    cache_key     TEXT PRIMARY KEY,
    profession_id TEXT NOT NULL,
    seniority     TEXT,
    kind          TEXT NOT NULL,
    payload       TEXT NOT NULL,
    created_at    INTEGER NOT NULL
  );
  CREATE TABLE IF NOT EXISTS interview_progress (
    id            INTEGER PRIMARY KEY AUTOINCREMENT,
    email         TEXT NOT NULL,
    profession_id TEXT NOT NULL,
    question_hash TEXT NOT NULL,
    confidence    INTEGER NOT NULL DEFAULT 3,
    practiced_at  INTEGER NOT NULL,
    UNIQUE(email, question_hash)
  );
  CREATE INDEX IF NOT EXISTS idx_interview_progress_email ON interview_progress(email, profession_id);
  CREATE TABLE IF NOT EXISTS gap_cache (
    cache_key   TEXT PRIMARY KEY,
    payload     TEXT NOT NULL,
    created_at  INTEGER NOT NULL
  );
  CREATE TABLE IF NOT EXISTS gap_reports (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    email       TEXT NOT NULL,
    resume_id   INTEGER,
    job_id      TEXT,
    match_score INTEGER,
    payload     TEXT NOT NULL,
    created_at  INTEGER NOT NULL
  );
  CREATE INDEX IF NOT EXISTS idx_gap_reports_email ON gap_reports(email);
  CREATE TABLE IF NOT EXISTS job_cache (
    cache_key  TEXT PRIMARY KEY,
    payload    TEXT NOT NULL,
    fetched_at INTEGER NOT NULL
  );
  CREATE TABLE IF NOT EXISTS saved_jobs (
    id       INTEGER PRIMARY KEY AUTOINCREMENT,
    email    TEXT NOT NULL,
    job_id   TEXT NOT NULL,
    title    TEXT,
    company  TEXT,
    location TEXT,
    url      TEXT,
    snapshot TEXT,
    saved_at INTEGER NOT NULL,
    UNIQUE(email, job_id)
  );
  CREATE INDEX IF NOT EXISTS idx_saved_jobs_email ON saved_jobs(email);
  CREATE TABLE IF NOT EXISTS scenario_cache (
    cache_key     TEXT PRIMARY KEY,
    profession_id TEXT NOT NULL,
    scenario_type TEXT NOT NULL,
    payload       TEXT NOT NULL,
    created_at    INTEGER NOT NULL
  );
  CREATE TABLE IF NOT EXISTS scenario_progress (
    id            INTEGER PRIMARY KEY AUTOINCREMENT,
    email         TEXT NOT NULL,
    profession_id TEXT NOT NULL,
    scenario_type TEXT NOT NULL,
    completed     INTEGER NOT NULL DEFAULT 0,
    perfect       INTEGER NOT NULL DEFAULT 0,
    completed_at  INTEGER NOT NULL,
    UNIQUE(email, profession_id, scenario_type)
  );
  CREATE INDEX IF NOT EXISTS idx_scenario_progress_email ON scenario_progress(email);
`);

// Lightweight column migrations for tables that predate a new column. SQLite has
// no "ADD COLUMN IF NOT EXISTS", so we check PRAGMA table_info first.
function _ensureColumn(table, column, ddl) {
  try {
    const cols = db.prepare(`PRAGMA table_info(${table})`).all();
    if (!cols.some(c => c.name === column)) db.exec(`ALTER TABLE ${table} ADD COLUMN ${ddl}`);
  } catch (e) { console.error(`[migrate] ${table}.${column} failed:`, e && e.message ? e.message : e); }
}
// Remember which template family a shared resume was created with, so /r/:slug can
// render it in the layout the user actually chose (sidebar, two-column, etc.).
_ensureColumn('shared_resumes', 'layout', 'layout TEXT');
// Website Creator (Pro) config blob: theme, section order/placement, selected
// asset ids, media refs, feature toggles. NULL on sites that predate the creator
// — _renderPersonalSite() treats NULL as a legacy default (renders exactly like
// today's output) and the column is populated lazily on first save in the creator.
_ensureColumn('personal_sites', 'config', 'config TEXT');
// Custom contact-form fields beyond name/email/message, as a JSON object. Those
// three keep their own columns because the leads list and the notification email
// were built around them; anything the owner adds lands here rather than being
// dropped on the way to their inbox.
_ensureColumn('site_leads', 'extra', "extra TEXT DEFAULT ''");
// Which site a media upload belongs to. Uploads used to be one shared library
// per account, so a photo or video from a template you tried once and moved on
// from stayed in the pool forever, silently eating into the count/storage caps
// of every site you built after it — reported as "I hit my video limit on my
// first upload" by someone whose ACTUAL current site had none. Media now
// belongs to the site it was uploaded on: deleting a site deletes its media
// with it, and a rename carries it across rather than losing it. Existing rows
// predate this column and stay NULL — excluded from every site-scoped query
// below, which is exactly the fix: they stop counting against anything.
_ensureColumn('site_media', 'site_sub', 'site_sub TEXT');

// Career Hub: the user's chosen target profession lives on their existing
// check-in row (the per-user career-state record) rather than a new profile
// table. It is the single source of truth every Career Hub tool reads.
_ensureColumn('check_ins', 'profession_id', "profession_id TEXT DEFAULT ''");
_ensureColumn('check_ins', 'profession_cat', "profession_cat TEXT DEFAULT ''");
_ensureColumn('check_ins', 'seniority', "seniority TEXT DEFAULT ''");
_ensureColumn('check_ins', 'profession_set_at', 'profession_set_at INTEGER');
// Career Hub Job Finder: daily "new jobs for your profession" digest opt-in.
_ensureColumn('check_ins', 'job_alerts', 'job_alerts INTEGER DEFAULT 0');
// Preferred UI language, so server-side emails (the job digest) match what the
// user reads in the app.
_ensureColumn('check_ins', 'lang', "lang TEXT DEFAULT 'en'");

// ═══════════════════════════════════════════════════════════════════════════
// Employer Portal: turns a signed-in account into a job poster via a "Hire
// Mode" toggle rather than a second login system (reuses the existing
// users/sessions auth exactly like every other feature). Pure validation/
// limits logic lives in employer-hub.js (EH); these tables + the /api/employer
// routes are the SQLite + Stripe wiring, mirroring the Career Hub's own
// pure-core/server-wiring split.
// ═══════════════════════════════════════════════════════════════════════════
db.exec(`
  CREATE TABLE IF NOT EXISTS employer_profiles (
    email        TEXT PRIMARY KEY,
    company_name TEXT NOT NULL,
    website      TEXT DEFAULT '',
    created_at   INTEGER NOT NULL
  );
  CREATE TABLE IF NOT EXISTS employer_subscribers (
    email       TEXT PRIMARY KEY,
    customer_id TEXT
  );
  CREATE TABLE IF NOT EXISTS job_postings (
    id             INTEGER PRIMARY KEY AUTOINCREMENT,
    employer_email TEXT NOT NULL,
    title          TEXT NOT NULL,
    description    TEXT NOT NULL DEFAULT '',
    requirements   TEXT NOT NULL DEFAULT '',
    salary_min     INTEGER,
    salary_max     INTEGER,
    location       TEXT NOT NULL DEFAULT '',
    work_mode      TEXT NOT NULL,
    job_type       TEXT NOT NULL,
    is_gig         INTEGER NOT NULL DEFAULT 0,
    gig_rate       INTEGER,
    gig_schedule   TEXT DEFAULT '',
    gig_type       TEXT DEFAULT '',
    status         TEXT NOT NULL DEFAULT 'active',
    created_at     INTEGER NOT NULL,
    updated_at     INTEGER NOT NULL
  );
  CREATE INDEX IF NOT EXISTS idx_job_postings_employer ON job_postings(employer_email);
  CREATE INDEX IF NOT EXISTS idx_job_postings_status ON job_postings(status);
  CREATE TABLE IF NOT EXISTS job_applications (
    id           INTEGER PRIMARY KEY AUTOINCREMENT,
    job_id       INTEGER NOT NULL,
    candidate_email TEXT NOT NULL,
    resume_id    INTEGER,
    status       TEXT NOT NULL DEFAULT 'new',
    rating       INTEGER,
    notes        TEXT DEFAULT '',
    interview_note TEXT DEFAULT '',
    created_at   INTEGER NOT NULL,
    updated_at   INTEGER NOT NULL,
    UNIQUE(job_id, candidate_email)
  );
  CREATE INDEX IF NOT EXISTS idx_job_applications_job ON job_applications(job_id);
  CREATE INDEX IF NOT EXISTS idx_job_applications_candidate ON job_applications(candidate_email);
  CREATE TABLE IF NOT EXISTS candidate_profiles (
    email          TEXT PRIMARY KEY,
    searchable     INTEGER NOT NULL DEFAULT 0,
    open_to_work   INTEGER NOT NULL DEFAULT 0,
    remote_pref    TEXT DEFAULT '',
    location       TEXT DEFAULT '',
    gig_available  INTEGER NOT NULL DEFAULT 0,
    hourly_rate    INTEGER,
    gig_schedule   TEXT DEFAULT '',
    max_travel_mi  INTEGER,
    updated_at     INTEGER NOT NULL
  );
  CREATE INDEX IF NOT EXISTS idx_candidate_profiles_searchable ON candidate_profiles(searchable);
  CREATE TABLE IF NOT EXISTS employer_contact_requests (
    id              INTEGER PRIMARY KEY AUTOINCREMENT,
    employer_email  TEXT NOT NULL,
    candidate_email TEXT NOT NULL,
    message         TEXT DEFAULT '',
    status          TEXT NOT NULL DEFAULT 'pending',
    created_at      INTEGER NOT NULL,
    updated_at      INTEGER NOT NULL,
    UNIQUE(employer_email, candidate_email)
  );
  CREATE INDEX IF NOT EXISTS idx_contact_requests_candidate ON employer_contact_requests(candidate_email);
  CREATE TABLE IF NOT EXISTS job_feed (
    id            INTEGER PRIMARY KEY AUTOINCREMENT,
    source        TEXT NOT NULL,
    external_id   TEXT NOT NULL,
    title         TEXT NOT NULL,
    company       TEXT DEFAULT '',
    location      TEXT DEFAULT '',
    url           TEXT NOT NULL,
    description   TEXT DEFAULT '',
    remote        INTEGER DEFAULT 0,
    job_type      TEXT DEFAULT '',
    profession_id TEXT DEFAULT '',
    priority      INTEGER NOT NULL DEFAULT 0,
    posted_at     INTEGER,
    fetched_at    INTEGER NOT NULL,
    UNIQUE(source, external_id)
  );
  CREATE INDEX IF NOT EXISTS idx_job_feed_profession ON job_feed(profession_id);
  CREATE INDEX IF NOT EXISTS idx_job_feed_priority ON job_feed(priority DESC, posted_at DESC);
  CREATE TABLE IF NOT EXISTS interviews (
    id              INTEGER PRIMARY KEY AUTOINCREMENT,
    employer_email  TEXT NOT NULL,
    candidate_email TEXT NOT NULL,
    job_id          INTEGER,
    application_id  INTEGER,
    scheduled_at    INTEGER NOT NULL,
    mode            TEXT NOT NULL DEFAULT 'video',
    location_or_link TEXT DEFAULT '',
    status          TEXT NOT NULL DEFAULT 'scheduled',
    notes           TEXT DEFAULT '',
    created_at      INTEGER NOT NULL,
    updated_at      INTEGER NOT NULL
  );
  CREATE INDEX IF NOT EXISTS idx_interviews_employer ON interviews(employer_email);
  CREATE TABLE IF NOT EXISTS employer_messages (
    id              INTEGER PRIMARY KEY AUTOINCREMENT,
    employer_email  TEXT NOT NULL,
    candidate_email TEXT NOT NULL,
    sender          TEXT NOT NULL,
    body            TEXT NOT NULL,
    read_at         INTEGER,
    created_at      INTEGER NOT NULL
  );
  CREATE INDEX IF NOT EXISTS idx_employer_messages_thread ON employer_messages(employer_email, candidate_email);
`);
// Employer profile extras (logo, description, notification prefs) added after
// the base table shipped — see _ensureColumn (idempotent).
_ensureColumn('employer_profiles', 'logo_url', "TEXT DEFAULT ''");
_ensureColumn('employer_profiles', 'description', "TEXT DEFAULT ''");
_ensureColumn('employer_profiles', 'notify_applications', 'INTEGER DEFAULT 1');
_ensureColumn('employer_profiles', 'notify_messages', 'INTEGER DEFAULT 1');

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

// ─── Host-based personal websites (name.resumetailored.com) ───────────────────
// When a request arrives on a personal-site subdomain, serve that user's
// published resume page directly — the same renderer as the path-based
// /site/:name route. This is INERT until a wildcard *.resumetailored.com DNS
// record + TLS actually point such hosts at this app (see docs/RAILWAY_SETUP.md
// §9): the apex, www, reserved names, the Railway/Netlify hosts and localhost
// never match, so behaviour is unchanged today. Only the root document is
// intercepted — assets and API paths fall through to their normal handlers.
const PERSONAL_SITE_HOST_RE = /^([a-z0-9](?:[a-z0-9-]{1,28}[a-z0-9]))\.resumetailored\.com$/i;
app.use((req, res, next) => {
  const host = String(req.hostname || '').toLowerCase();
  const m = host.match(PERSONAL_SITE_HOST_RE);
  if (!m) return next();
  const sub = _validSubdomain(m[1]);          // rejects reserved names (www, api, …)
  if (!sub) return next();                    // reserved host → normal handling
  // llms.txt is checked before the seg regex below, which excludes dots (it's
  // built for page slugs like "about", not filenames) and would otherwise
  // fall through to next() and 404 rather than ever reaching the site lookup.
  if (req.path === '/llms.txt') {
    const row = db.prepare('SELECT * FROM personal_sites WHERE subdomain = ? AND published = 1').get(sub);
    const origin = `${req.protocol}://${host}`;
    if (!row) {
      const alias = db.prepare('SELECT new_sub FROM site_aliases WHERE old_sub = ?').get(sub);
      const live = alias ? db.prepare('SELECT subdomain FROM personal_sites WHERE subdomain = ? AND published = 1').get(alias.new_sub) : null;
      if (live) return res.redirect(301, `${sitePublicUrl(live.subdomain, origin)}/llms.txt`);
      res.status(404); return res.sendFile(path.join(__dirname, 'public', '404.html'));
    }
    return _serveLlmsTxt(row, origin, res);
  }
  // Root, or a single-segment page slug. Anything else (assets, /api/…, files
  // with an extension) falls through to the normal handlers untouched.
  const seg = req.path === '/' ? '' : (req.path.match(/^\/([a-z0-9-]{1,60})\/?$/i) || [])[1];
  if (req.path !== '/' && !seg) return next();
  const row = db.prepare('SELECT * FROM personal_sites WHERE subdomain = ? AND published = 1').get(sub);
  const origin = `${req.protocol}://${host}`;
  if (!row) {
    // A renamed address forwards here too, or the fix would only work on the
    // path-based URL and not the one people are actually given.
    const moved = _movedTarget(sub, origin, req.path === '/' ? '' : req.path.slice(1));
    if (moved) return res.redirect(301, moved);
    res.status(404); return res.sendFile(path.join(__dirname, 'public', '404.html'));
  }
  // A multi-page site's nav must stay ON the subdomain. Without an explicit
  // baseUrl the renderer builds links as `<origin>/site/<sub>/<page>`, so page
  // two of alice.resumetailored.com landed on
  // alice.resumetailored.com/site/alice/work — it resolved, but the URL was
  // nonsense and the canonical tag disagreed with itself.
  const pageSlug = (seg || '').toLowerCase();
  if (pageSlug) {
    let cfg = null; try { cfg = row.config ? JSON.parse(row.config) : null; } catch (_) {}
    const pages = cfg && Array.isArray(cfg.pages) ? cfg.pages : null;
    // Not a page of this site → let the normal routes have it rather than 404
    // on something that might be a real path.
    if (!pages || !pages.some((p) => String((p && p.slug) || '').toLowerCase() === pageSlug)) return next();
  }
  try { db.prepare('UPDATE personal_sites SET views = views + 1 WHERE subdomain = ?').run(sub); } catch (_) {}
  _recordVisit(sub, req);
  res.setHeader('Content-Type', 'text/html; charset=utf-8');
  res.setHeader('Cache-Control', 'no-cache');
  return res.send(_renderPersonalSite(row, origin, {
    indexable: true, footer: '', page: pageSlug,
    baseUrl: origin,
    canonicalUrl: `${origin}/${pageSlug}`,
  }));
});

// Redirect /app -> /dashboard. Must run BEFORE express.static, otherwise the
// static handler serves public/app.html for /app and shadows this redirect.
app.get('/app', (req, res) => res.redirect(301, '/dashboard'));

// Consolidate competitor comparison pages onto the /alternatives/* structure
// (the scalable, canonical home for these). The legacy flat /x-alternative URLs
// 301 to their /alternatives/x equivalent so existing backlinks/bookmarks funnel
// to one page and link equity isn't split. Must run BEFORE express.static so the
// redirect wins over the on-disk flat HTML file. Only the four competitors that
// have an /alternatives/ page are redirected; enhancv/resume-io/zety have no
// /alternatives/ counterpart and are intentionally left as-is.
const ALTERNATIVE_REDIRECTS = { teal: 'teal', jobscan: 'jobscan', rezi: 'rezi', kickresume: 'kickresume' };
for (const [flat, slug] of Object.entries(ALTERNATIVE_REDIRECTS)) {
  app.get(`/${flat}-alternative`, (req, res) => res.redirect(301, `/alternatives/${slug}`));
}

// ── Cache-busting for CSS/JS referenced by HTML pages ────────────────────────
// The no-cache headers above are necessary but NOT sufficient: Cloudflare
// (the CDN in front of Railway) silently overrides Cache-Control for
// recognized static extensions (.css/.js) with its own fixed Browser Cache
// TTL, REGARDLESS of what origin sends — confirmed live: origin sends
// `no-cache`, the response a browser actually receives says
// `max-age=14400` (4h). That's the real reason three rounds of CSS/JS
// fixes shipped correctly and still didn't reach real browsers for hours —
// no origin header can fix that, because the intermediary is proven to
// ignore it. HTML itself is unaffected (Cloudflare passes `no-cache`
// through for text/html, confirmed live too), so the fix is to version the
// asset REFERENCES inside the HTML: a content change becomes a brand-new
// URL, which is a guaranteed cache miss everywhere (browser, Cloudflare,
// any future CDN) — no intermediary's cache-control handling has to be
// trusted at all.
const ASSET_VERSION = (process.env.RAILWAY_GIT_COMMIT_SHA || String(Date.now())).slice(0, 10);
const ASSET_REWRITES = [
  ['href="/theme.css"', `href="/theme.css?v=${ASSET_VERSION}"`],
  ['href="/career-hub.css"', `href="/career-hub.css?v=${ASSET_VERSION}"`],
  ['href="/app-theme.css"', `href="/app-theme.css?v=${ASSET_VERSION}"`],
  ['href="style.css"', `href="style.css?v=${ASSET_VERSION}"`],
  ['src="/career-hub.js"', `src="/career-hub.js?v=${ASSET_VERSION}"`],
];
function _versionAssetRefs(html) {
  for (const [from, to] of ASSET_REWRITES) html = html.split(from).join(to);
  return html;
}
// Reads an HTML file, versions its asset references, and sends it — the one
// path every HTML response (explicit routes below AND the static fallback)
// goes through, so nothing can serve app.html/score.html/etc. un-versioned.
function _sendVersionedHtml(res, filePath) {
  fs.readFile(filePath, 'utf8', (err, html) => {
    if (err) { res.status(404); return res.sendFile(path.join(__dirname, 'public', '404.html')); }
    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    res.setHeader('Cache-Control', 'no-cache');
    res.send(_versionAssetRefs(html));
  });
}
// Mirrors express.static's own `extensions:['html']` + `index.html`
// resolution just enough to find which on-disk file a clean URL maps to,
// without ever matching a non-.html file (a bare `/theme.css` must stay a
// CSS response, not fall through to here).
function _resolveHtmlFile(reqPath) {
  const clean = reqPath.split('?')[0];
  if (clean.includes('..')) return null;
  const publicDir = path.join(__dirname, 'public');
  if (clean.endsWith('.html')) {
    const p = path.join(publicDir, clean);
    try { if (fs.statSync(p).isFile()) return p; } catch (e) {}
    return null;
  }
  const base = path.join(publicDir, clean);
  const withExt = base + '.html';
  try { if (fs.statSync(withExt).isFile()) return withExt; } catch (e) {}
  const indexFile = path.join(base, 'index.html');
  try { if (fs.statSync(indexFile).isFile()) return indexFile; } catch (e) {}
  return null;
}
// Placed exactly where express.static's own HTML serving used to sit — every
// route above still wins (registration order), everything that resolves to
// an .html file is versioned and sent from here, and express.static below
// goes back to serving only non-HTML static files (it no longer tries the
// `.html` extension fallback itself, so it can never race this handler).
app.get(/.*/, (req, res, next) => {
  if (req.method !== 'GET') return next();
  const file = _resolveHtmlFile(req.path);
  if (!file) return next();
  _sendVersionedHtml(res, file);
});

app.use(express.static(path.join(__dirname, 'public'), {
  setHeaders: (res, filePath) => {
    if (filePath.endsWith('.html')) {
      // Dead branch in practice — every .html resolution is now handled by
      // _resolveHtmlFile above before express.static ever sees the request.
      // Left as a safety net, not the primary path.
      res.setHeader('Content-Type', 'text/html; charset=utf-8');
      res.setHeader('Cache-Control', 'no-cache');
    } else if (filePath.endsWith('.css')) {
      res.setHeader('Content-Type', 'text/css; charset=utf-8');
      // Every CSS file here is COUPLED to some no-cache HTML page the exact
      // same way the comment below describes for JS: the HTML (and any class
      // names / markup it depends on) updates instantly on deploy, but a
      // 24h public cache meant a returning browser kept rendering new markup
      // against a day-old stylesheet — which is exactly why three separate
      // rounds of mobile contrast / tab-bar CSS fixes shipped to production
      // and visibly changed nothing for anyone whose browser had already
      // cached theme.css. no-cache still revalidates via ETag (a cheap 304
      // when the file hasn't changed); it is not "no store".
      res.setHeader('Cache-Control', 'no-cache');
    } else if (filePath.endsWith('.js')) {
      res.setHeader('Content-Type', 'application/javascript; charset=utf-8');
      // Was previously "coupled modules only" (site-fields/vibes/doc-store);
      // the SiteFields incident that motivated that carve-out is a special
      // case of a general problem — EVERY .js file here is loaded by a
      // no-cache HTML page and can be called differently the moment that
      // page's markup/behavior changes. A day-long public cache on any of
      // them (career-hub.js included) risks the same "x is not a function"
      // /  silently-stale-behavior failure mode, just with a different
      // module. no-cache still revalidates (304 when unchanged).
      res.setHeader('Cache-Control', 'no-cache');
    } else if (/\.(png|jpe?g|svg|webp|ico|gif|woff2?)$/i.test(filePath)) {
      // Images/fonts change rarely and are the heaviest assets.
      res.setHeader('Cache-Control', 'public, max-age=2592000');
    }
  }
}));

// Clean URL aliases — /dashboard, /login, /signup all serve app.html. These
// are VIRTUAL routes (no same-named file on disk), so the _resolveHtmlFile
// catch-all above never matches them — they need _sendVersionedHtml called
// explicitly, same as it is everywhere else, or app.html (and the
// career-hub.js/style.css it references) would go right back to being
// unversioned on exactly the pages this bug was reported on.
const appHtml = path.join(__dirname, 'public', 'app.html');
app.get('/dashboard',    (req, res) => _sendVersionedHtml(res, appHtml));
app.get('/login',        (req, res) => _sendVersionedHtml(res, appHtml));
app.get('/signup',       (req, res) => _sendVersionedHtml(res, appHtml));
app.get('/about',        (req, res) => res.redirect(301, '/how-it-works'));
// Live in-browser video preview (Remotion Player — plays client-side, no render)
app.get('/preview',      (req, res) => _sendVersionedHtml(res, path.join(__dirname, 'public', 'preview.html')));
const blogIndexHtml = path.join(__dirname, 'public', 'blog', 'index.html');
app.get('/blog',         (req, res) => _sendVersionedHtml(res, blogIndexHtml));

// Raw body needed for Stripe webhook verification
app.use('/webhook', express.raw({ type: 'application/json' }));
app.use(express.json());

// ─── Rate limiting ────────────────────────────────────────────────────────────
// Set only by the test harness, which fires a few hundred requests from one IP
// in a couple of seconds and would otherwise measure throttling, not rendering.
const RATE_LIMIT_OFF = process.env.RT_DISABLE_RATE_LIMIT === '1';

// The Templates panel loads every starter template as a live <iframe> thumbnail,
// so opening it is a dozen requests in one second. That route renders static
// HTML with no database or AI work behind it, so it gets its own generous
// budget rather than eating the shared 30/min one and locking the user out of
// the rest of the app for a minute.
// Site thumbnails, in both flavours: the template gallery's sample previews and
// the Back Office's render of the user's own sites. Both are pure HTML off one
// row, and a Back Office with eight sites would otherwise spend a quarter of the
// shared 30/min budget just drawing itself.
// The template DOCUMENT belongs here too, not just its preview. Opening the
// editor spends a chunk of the shared 30/min budget, and every "Use" tap spent
// another — so switching template a few times returned 429, which the client
// could only report as "Could not load that template." It is static content
// off a module, exactly like the preview beside it.
const TPL_PREVIEW_PATH_RE = /^\/(site-templates\/[^/]+(\/preview)?|personal-sites\/[^/]+\/render)\/?$/;
// Every rate-limit body below carries BOTH `error` (a stable code) and
// `message` (the human text) — frontend code consistently reads
// `res.data.message || <generic fallback>`, so a body with only `error`
// silently degrades to that generic fallback instead of the real reason.
// That's how a rate-limited Job Finder search showed a bare "Search failed."
// instead of "you're doing this too fast" — this global limiter's message
// had no `message` field at all.
const tplPreviewLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 180,
  skip: () => RATE_LIMIT_OFF,
  message: { error: 'rate_limited', message: 'Too many requests, please slow down.' },
});

const apiLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 30,
  skip: (req) => RATE_LIMIT_OFF || TPL_PREVIEW_PATH_RE.test(req.path),
  message: { error: 'rate_limited', message: 'Too many requests, please slow down.' }
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

// ─── LinkedIn OAuth import (free onboarding feature) ──────────────────────────
// Official "Sign In with LinkedIn using OpenID Connect" flow (no scraping). We
// use it only to PRE-FILL the resume builder — name/email/photo (and headline
// if the granted scopes return it). Standard OIDC does NOT expose full work
// history / education / skills, so the client prompts the user to complete the
// rest by hand. The feature is optional: if LINKEDIN_CLIENT_ID/SECRET are
// unset, the routes report disabled and the client hides the button — nothing
// else breaks (same pattern as Resend/ElevenLabs).
const LINKEDIN_CLIENT_ID = process.env.LINKEDIN_CLIENT_ID || '';
const LINKEDIN_CLIENT_SECRET = process.env.LINKEDIN_CLIENT_SECRET || '';
function linkedInRedirectUri(req) {
  return process.env.LINKEDIN_REDIRECT_URI || `${req.protocol}://${req.get('host')}/api/auth/linkedin/callback`;
}
const linkedInConfigured = () => !!(LINKEDIN_CLIENT_ID && LINKEDIN_CLIENT_SECRET);

// Short-lived in-memory stores. `states` guards CSRF on the round-trip and
// remembers whether this trip is a profile IMPORT or a LOGIN; `drafts` hands the
// result (parsed profile, or a session for login) back to the SPA exactly once.
const _liStates = new Map(); // state -> { exp, mode }
const _liDrafts = new Map();
function _liSweep() {
  const now = Date.now();
  for (const [k, v] of _liStates) if (v.exp < now) _liStates.delete(k);
  for (const [k, v] of _liDrafts) if (v.exp < now) _liDrafts.delete(k);
}

// Create or fetch the account for a LinkedIn-authenticated email and open a
// session for it. New accounts are created password-less (a random bcrypt hash);
// the user can set a password later via "forgot password". An existing email
// (whether it signed up with a password or LinkedIn) is simply logged in.
function _linkedInUpsertSession(email, name) {
  const key = String(email).toLowerCase().trim();
  let user = db.prepare('SELECT email, username FROM users WHERE email = ?').get(key);
  if (!user) {
    const uname = (String(name || '').trim().slice(0, 30)) || key.split('@')[0];
    db.prepare('INSERT INTO users (email, username, password_hash) VALUES (?, ?, ?)')
      .run(key, uname, hashPassword(crypto.randomBytes(24).toString('hex')));
    user = { email: key, username: uname };
  }
  const token = uuidv4();
  db.prepare('INSERT INTO sessions (token, email) VALUES (?, ?)').run(token, key);
  return { token, email: key, username: user.username };
}

// Whether the button should show. The client calls this on load.
app.get('/api/auth/linkedin/status', (req, res) => {
  res.json({ enabled: linkedInConfigured() });
});

// Step 1 — send the user to LinkedIn's consent screen. If the feature isn't
// configured, bounce back to the dashboard with a friendly error (a full-page
// redirect must never dump raw JSON at the user) — this also makes a missing
// LINKEDIN_CLIENT_ID/SECRET obvious instead of failing silently.
app.get('/api/auth/linkedin', (req, res) => {
  if (!linkedInConfigured()) return res.redirect('/dashboard?linkedin_error=not_configured');
  _liSweep();
  const mode = req.query.mode === 'login' ? 'login' : 'import';
  const state = crypto.randomBytes(16).toString('hex');
  _liStates.set(state, { exp: Date.now() + 10 * 60 * 1000, mode }); // 10-min validity
  const params = new URLSearchParams({
    response_type: 'code',
    client_id: LINKEDIN_CLIENT_ID,
    redirect_uri: linkedInRedirectUri(req),
    scope: 'openid profile email',
    state,
  });
  res.redirect(`https://www.linkedin.com/oauth/v2/authorization?${params.toString()}`);
});

// Step 2 — LinkedIn redirects back with a code; exchange it, fetch the profile,
// stash a one-time draft, and bounce to the dashboard with a handoff token.
app.get('/api/auth/linkedin/callback', async (req, res) => {
  const backTo = (msg) => res.redirect(`/dashboard?linkedin_error=${encodeURIComponent(msg)}`);
  try {
    if (!linkedInConfigured()) return backTo('not_configured');
    const { code, state, error, error_description } = req.query;
    if (error) return backTo(String(error_description || error).slice(0, 120));
    _liSweep();
    const stateEntry = state && _liStates.get(String(state));
    if (!code || !stateEntry) return backTo('invalid_state');
    _liStates.delete(String(state));
    const mode = stateEntry.mode || 'import';

    // Exchange the authorization code for an access token.
    const tokRes = await fetch('https://www.linkedin.com/oauth/v2/accessToken', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        grant_type: 'authorization_code',
        code: String(code),
        client_id: LINKEDIN_CLIENT_ID,
        client_secret: LINKEDIN_CLIENT_SECRET,
        redirect_uri: linkedInRedirectUri(req),
      }),
    });
    if (!tokRes.ok) return backTo('token_exchange_failed');
    const tok = await tokRes.json();
    if (!tok.access_token) return backTo('no_token');

    // Fetch the OIDC userinfo (name, email, picture; headline only if the
    // account's granted scopes include it — usually not on standard apps).
    const uiRes = await fetch('https://api.linkedin.com/v2/userinfo', {
      headers: { Authorization: `Bearer ${tok.access_token}` },
    });
    if (!uiRes.ok) return backTo('profile_fetch_failed');
    const ui = await uiRes.json();

    const fullName = ui.name || [ui.given_name, ui.family_name].filter(Boolean).join(' ') || '';

    // LOGIN mode: authenticate the account tied to this LinkedIn email and hand
    // a fresh session back to the SPA (which stores the token and drops into the
    // dashboard). Requires an email from LinkedIn.
    if (mode === 'login') {
      if (!ui.email) return backTo('no_email');
      const sess = _linkedInUpsertSession(ui.email, fullName);
      const handoff = crypto.randomBytes(16).toString('hex');
      _liDrafts.set(handoff, { session: sess, exp: Date.now() + 5 * 60 * 1000 });
      return res.redirect(`/dashboard?linkedin_login=${handoff}`);
    }

    // IMPORT mode: hand the parsed profile back to prefill a tool.
    const draft = {
      name: fullName,
      headline: ui.headline || '', // typically empty on standard OIDC
      email: ui.email || '',
      photo: ui.picture || '',
      locale: (ui.locale && (ui.locale.language || ui.locale)) || '',
      partial: true, // signals the client to prompt the user to complete the rest
    };
    const handoff = crypto.randomBytes(16).toString('hex');
    _liDrafts.set(handoff, { draft, exp: Date.now() + 5 * 60 * 1000 });
    res.redirect(`/dashboard?linkedin=${handoff}`);
  } catch (err) {
    console.error('[linkedin] callback failed:', err && err.message ? err.message : err);
    backTo('unexpected_error');
  }
});

// Step 3a (import) — the SPA exchanges the handoff token for the parsed profile.
app.get('/api/auth/linkedin/draft', (req, res) => {
  _liSweep();
  const t = String(req.query.token || '');
  const entry = t && _liDrafts.get(t);
  if (!entry || !entry.draft) return res.status(404).json({ error: 'expired' });
  _liDrafts.delete(t);
  res.json({ profile: entry.draft });
});

// Step 3b (login) — the SPA exchanges the handoff token for a session, once.
app.get('/api/auth/linkedin/session', (req, res) => {
  _liSweep();
  const t = String(req.query.token || '');
  const entry = t && _liDrafts.get(t);
  if (!entry || !entry.session) return res.status(404).json({ error: 'expired' });
  _liDrafts.delete(t);
  res.json(entry.session); // { token, email, username }
});

// ── Google Sign-In (OpenID Connect) ─────────────────────────────────────────
// Same shape as the LinkedIn login flow above: optional (gated by
// GOOGLE_CLIENT_ID/SECRET), CSRF-guarded round-trip, one-time session handoff.
// New Google emails get a free password-less account (set a password later via
// "forgot password"); an existing email is simply signed in. Reuses
// _linkedInUpsertSession (provider-agnostic account+session upsert).
const GOOGLE_CLIENT_ID = process.env.GOOGLE_CLIENT_ID || '';
const GOOGLE_CLIENT_SECRET = process.env.GOOGLE_CLIENT_SECRET || '';
const googleConfigured = () => !!(GOOGLE_CLIENT_ID && GOOGLE_CLIENT_SECRET);
function googleRedirectUri(req) {
  return process.env.GOOGLE_REDIRECT_URI || `${req.protocol}://${req.get('host')}/api/auth/google/callback`;
}
const _googleStates = new Map(); // state -> { exp }
function _googleSweep() { const now = Date.now(); for (const [k, v] of _googleStates) if (v.exp < now) _googleStates.delete(k); }

app.get('/api/auth/google/status', (req, res) => res.json({ enabled: googleConfigured() }));

app.get('/api/auth/google', (req, res) => {
  if (!googleConfigured()) return res.redirect('/dashboard?google_error=not_configured');
  _googleSweep();
  const state = crypto.randomBytes(16).toString('hex');
  _googleStates.set(state, { exp: Date.now() + 10 * 60 * 1000 });
  const params = new URLSearchParams({
    response_type: 'code',
    client_id: GOOGLE_CLIENT_ID,
    redirect_uri: googleRedirectUri(req),
    scope: 'openid email profile',
    state,
    access_type: 'online',
    prompt: 'select_account'
  });
  res.redirect(`https://accounts.google.com/o/oauth2/v2/auth?${params.toString()}`);
});

app.get('/api/auth/google/callback', async (req, res) => {
  const backTo = (msg) => res.redirect(`/dashboard?google_error=${encodeURIComponent(msg)}`);
  try {
    if (!googleConfigured()) return backTo('not_configured');
    const { code, state, error } = req.query;
    if (error) return backTo(String(error).slice(0, 120));
    _googleSweep();
    const stateEntry = state && _googleStates.get(String(state));
    if (!code || !stateEntry) return backTo('invalid_state');
    _googleStates.delete(String(state));

    const tokRes = await fetch('https://oauth2.googleapis.com/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        grant_type: 'authorization_code',
        code: String(code),
        client_id: GOOGLE_CLIENT_ID,
        client_secret: GOOGLE_CLIENT_SECRET,
        redirect_uri: googleRedirectUri(req)
      })
    });
    if (!tokRes.ok) return backTo('token_exchange_failed');
    const tok = await tokRes.json();
    if (!tok.access_token) return backTo('no_token');

    const uiRes = await fetch('https://www.googleapis.com/oauth2/v3/userinfo', {
      headers: { Authorization: `Bearer ${tok.access_token}` }
    });
    if (!uiRes.ok) return backTo('profile_fetch_failed');
    const ui = await uiRes.json();
    if (!ui.email) return backTo('no_email');
    if (ui.email_verified === false) return backTo('email_unverified');

    const fullName = ui.name || [ui.given_name, ui.family_name].filter(Boolean).join(' ') || '';
    const sess = _linkedInUpsertSession(ui.email, fullName);
    const handoff = crypto.randomBytes(16).toString('hex');
    _liDrafts.set(handoff, { session: sess, exp: Date.now() + 5 * 60 * 1000 });
    res.redirect(`/dashboard?google_login=${handoff}`);
  } catch (err) {
    console.error('[google] callback failed:', err && err.message ? err.message : err);
    backTo('unexpected_error');
  }
});

// The SPA exchanges the handoff token for a session, once. (Shares _liDrafts.)
app.get('/api/auth/google/session', (req, res) => {
  _liSweep();
  const t = String(req.query.token || '');
  const entry = t && _liDrafts.get(t);
  if (!entry || !entry.session) return res.status(404).json({ error: 'expired' });
  _liDrafts.delete(t);
  res.json(entry.session); // { token, email, username }
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
  // The site and its field values are the same for every row, so they are read
  // once. Asking per resume meant twenty identical site queries and twenty
  // JSON.parse of the same config to render one page.
  const owned = _siteOwnedFields(email);
  res.json({ resumes: rows.map((r) => Object.assign({}, r, { siteSync: _siteSyncStatus(owned, r) })) });
});

/**
 * What the user's website currently claims, for the fields it has taken
 * ownership of — plus which resume it was built from.
 *
 * Only detached fields are collected: a field still following the resume
 * cannot disagree with it by definition, so including those would mark every
 * resume permanently out of sync.
 */
function _siteOwnedFields(email) {
  try {
    const site = _currentSite(email);
    if (!site || !site.config) return null;
    const cfg = JSON.parse(site.config);
    const resumeId = cfg && cfg.assets && cfg.assets.resumeId;
    if (!resumeId) return null;
    const SF = require('./public/site-fields.js');
    const values = {};
    SF.detachedFields(cfg).forEach((f) => {
      const el = SF.findField(cfg, f);
      if (el && el.props && el.props.text) values[f] = el.props.text;
    });
    return { resumeId, values };
  } catch (_) { return null; }
}

/**
 * Does this resume still say what the website says?
 *
 * Returns null when the question does not apply — no site, or a resume the site
 * was never built from — so the client shows nothing rather than a reassuring
 * badge it has not earned.
 */
function _siteSyncStatus(owned, resume) {
  if (!owned || Number(owned.resumeId) !== Number(resume.id)) return null;
  if (!Object.keys(owned.values).length) return 'synced';
  try {
    return require('./resume-writeback.js').diffFields(resume.content, owned.values).length
      ? 'out_of_sync' : 'synced';
  } catch (_) { return null; }
}

/**
 * Push one website edit back into the saved resume.
 *
 * The site is generated from the resume and then owned by the user: editing a
 * field on the site detaches it, and the resume stops driving it. This is the
 * offer to keep them together — "you changed your headline here, change it
 * there too?" — and it is the ONLY path in the product that writes to the
 * document people apply to jobs with.
 *
 * It refuses rather than guesses. If the field cannot be located in the resume
 * with certainty, nothing is written and the client says so plainly. A resume
 * that quietly gains a stray line is far worse than a sync that occasionally
 * cannot run: see resume-writeback.js for what "certainty" means here.
 */
app.post('/api/resume-sync', (req, res) => {
  const email = emailFromToken(req);
  if (!email) return res.status(401).json({ error: 'Please sign in.' });
  const WB = require('./resume-writeback.js');

  const field = String((req.body && req.body.field) || '');
  const previous = String((req.body && req.body.previous) || '');
  const next = String((req.body && req.body.next) || '');

  // The site's subtitle carries two resume facts — "Director of Product ·
  // Portland" is a job title and a city living in one line. Split it back into
  // the two places they came from, and only for the halves that actually
  // changed: rewriting the role because the city moved would put a title the
  // user never touched into their employment history.
  let edits;
  if (field === 'subtitle') {
    const SEP = /\s*·\s*/;
    const was = previous.split(SEP), now = next.split(SEP);
    // A different number of parts means we cannot tell which half is which.
    if (was.length !== now.length || was.length > 2) {
      return res.json({ ok: false, reason: 'ambiguous' });
    }
    const slots = ['role', 'location'];
    edits = was.map((p, i) => ({ field: slots[i], previous: p, next: now[i] }))
      .filter((e) => e.previous.trim() !== e.next.trim());
  } else if (field === 'name' || field === 'summary') {
    edits = [{ field, previous, next }];
  } else {
    return res.json({ ok: false, reason: 'unknown_field' });
  }
  if (!edits.length) return res.json({ ok: true, written: [] });

  const resume = db.prepare('SELECT id, content FROM saved_resumes WHERE email = ? ORDER BY created_at DESC LIMIT 1').get(email);
  if (!resume) return res.json({ ok: false, reason: 'no_resume' });

  const r = WB.writeFields(resume.content, edits);
  if (!r.ok) return res.json({ ok: false, reason: r.reason, field: r.field });
  db.prepare('UPDATE saved_resumes SET content = ? WHERE id = ?').run(r.text, resume.id);

  // The cover letter is a different document that may or may not mention the
  // same fact. Not finding it there is not a failure — the name simply may not
  // be in it — but it is still written only on an exact anchor, never appended.
  let cover = false;
  const cl = db.prepare('SELECT id, content FROM saved_cover_letters WHERE email = ? ORDER BY created_at DESC LIMIT 1').get(email);
  if (cl) {
    const c = WB.writeFields(cl.content, edits);
    if (c.ok && c.written.length) {
      db.prepare('UPDATE saved_cover_letters SET content = ? WHERE id = ?').run(c.text, cl.id);
      cover = true;
    }
  }
  res.json({ ok: true, written: r.written, resumeId: resume.id, coverLetter: cover });
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

// ── Saved cover letters (mirror of saved_resumes) ────────────────────────────
// Persist generated cover letters so the Website Creator + Back Office can list
// them and let the user pick which one a site displays. The client POSTs here
// after a cover_letter / both run.
app.get('/api/cover-letters', (req, res) => {
  const email = emailFromToken(req);
  if (!email) return res.status(401).json({ error: 'Please sign in.' });
  const rows = db.prepare('SELECT id, title, content, created_at FROM saved_cover_letters WHERE email = ? ORDER BY created_at DESC').all(email);
  res.json({ coverLetters: rows });
});

app.post('/api/cover-letters', (req, res) => {
  const email = emailFromToken(req);
  if (!email) return res.status(401).json({ error: 'Please sign in.' });
  const content = (req.body && typeof req.body.content === 'string') ? req.body.content.trim() : '';
  if (content.length < 40) return res.status(400).json({ error: 'Cover letter content is required.' });
  const rawTitle = (req.body && typeof req.body.title === 'string' && req.body.title.trim())
    ? req.body.title.trim()
    : (content.split('\n').find((l) => l.trim()) || 'Cover Letter').trim();
  const title = rawTitle.slice(0, 80);
  db.prepare('DELETE FROM saved_cover_letters WHERE email = ? AND content = ?').run(email, content);
  const info = db.prepare('INSERT INTO saved_cover_letters (email, title, content, created_at) VALUES (?, ?, ?, ?)')
    .run(email, title, content.slice(0, 60000), Date.now());
  db.prepare('DELETE FROM saved_cover_letters WHERE email = ? AND id NOT IN (SELECT id FROM saved_cover_letters WHERE email = ? ORDER BY created_at DESC LIMIT 20)').run(email, email);
  res.json({ success: true, id: info.lastInsertRowid, title });
});

app.delete('/api/cover-letters/:id', (req, res) => {
  const email = emailFromToken(req);
  if (!email) return res.status(401).json({ error: 'Please sign in.' });
  db.prepare('DELETE FROM saved_cover_letters WHERE id = ? AND email = ?').run(req.params.id, email);
  res.json({ success: true });
});

// Duplicate a saved resume / cover letter (Back Office bulk action).
function _duplicateAsset(table, req, res) {
  const email = emailFromToken(req);
  if (!email) return res.status(401).json({ error: 'Please sign in.' });
  const row = db.prepare(`SELECT title, content FROM ${table} WHERE id = ? AND email = ?`).get(req.params.id, email);
  if (!row) return res.status(404).json({ error: 'Not found.' });
  const title = (row.title || 'Untitled').slice(0, 74) + ' (copy)';
  const info = db.prepare(`INSERT INTO ${table} (email, title, content, created_at) VALUES (?, ?, ?, ?)`)
    .run(email, title, row.content, Date.now());
  // Honor the same keep-latest-20 cap as the create routes.
  db.prepare(`DELETE FROM ${table} WHERE email = ? AND id NOT IN (SELECT id FROM ${table} WHERE email = ? ORDER BY created_at DESC LIMIT 20)`).run(email, email);
  res.json({ success: true, id: info.lastInsertRowid, title });
}
app.post('/api/resumes/:id/duplicate', (req, res) => _duplicateAsset('saved_resumes', req, res));
app.post('/api/cover-letters/:id/duplicate', (req, res) => _duplicateAsset('saved_cover_letters', req, res));

// ── Saved resume videos ──────────────────────────────────────────────────────
// Metadata rows for persisted MP4s (generated or user-uploaded). The file bytes
// are written under DATA_DIR by the media/persist paths in later phases; here we
// expose list + delete so the Website Creator and Back Office can manage them.
app.get('/api/videos', (req, res) => {
  const email = emailFromToken(req);
  if (!email) return res.status(401).json({ error: 'Please sign in.' });
  const rows = db.prepare('SELECT id, title, source, bytes, created_at FROM saved_videos WHERE email = ? ORDER BY created_at DESC').all(email);
  res.json({ videos: rows });
});

app.delete('/api/videos/:id', (req, res) => {
  const email = emailFromToken(req);
  if (!email) return res.status(401).json({ error: 'Please sign in.' });
  const row = db.prepare('SELECT path FROM saved_videos WHERE id = ? AND email = ?').get(req.params.id, email);
  db.prepare('DELETE FROM saved_videos WHERE id = ? AND email = ?').run(req.params.id, email);
  if (row && row.path) { try { fs.unlink(row.path, () => {}); } catch (_) {} }
  res.json({ success: true });
});

// Asset counts for the Website Creator pop-up gate: the "tailor first" modal only
// shows when the user has zero saved resumes AND zero saved cover letters.
app.get('/api/assets/summary', (req, res) => {
  const email = emailFromToken(req);
  if (!email) return res.status(401).json({ error: 'Please sign in.' });
  const count = (t) => db.prepare(`SELECT COUNT(*) AS n FROM ${t} WHERE email = ?`).get(email).n;
  res.json({
    resumes: count('saved_resumes'),
    coverLetters: count('saved_cover_letters'),
    videos: count('saved_videos'),
  });
});

// ── Site media uploads (Pro) ─────────────────────────────────────────────────
// Images/audio share one quota pool; video has its own pool + a hard file count
// cap (Option B). Files live under ${DATA_DIR}/site-media/<email-hash>/ so they
// persist across deploys when a Railway volume is mounted at /data.
/* VIDEO POLICY, LOCKED IN: 5 clips per SITE, 2 minutes each, 1 GB total.
   This reverses the immediately preceding round's "no count cap" decision — on
   purpose, at the owner's explicit instruction, not by drift.

   PER SITE, not per account — `site_media.site_sub` ties every row to the one
   site it was uploaded on. It used to be one pool shared across every site an
   account had ever built, so a video uploaded while trying a template months
   ago stayed in the pool and silently spent a slot on the site being worked on
   today — reported directly as "I hit my limit and I haven't uploaded
   anything." Deleting a site deletes its media with it now; renaming carries
   it across. See the `site_sub` migration comment near the top of this file.

   The count is flat: every row of kind `video` counts, including the ones the
   text-video generator writes on the user's behalf — the same objection that
   removed the cap last round (it counted videos the user never chose to
   upload) still applies to those, and no exemption was asked for, so none is
   built. What IS different from last round: the Uploads panel has had a real
   delete button since the previous change, so hitting 5 is recoverable rather
   than a dead end, and the rejection message says so.

   `videoMaxDurationSec` is new: a clip's own container metadata is read before
   it is accepted (`_probeVideoDurationSeconds`), not inferred from file size —
   a two-hour screen recording can be under 100 MB and a two-minute 4K clip can
   be well over it, so size was never a proxy for length. */
const MEDIA_LIMITS = {
  imageAudioPool: 300 * 1024 * 1024,  // 300 MB shared by images + audio
  videoPool: 1024 * 1024 * 1024,      // 1 GB per user
  videoMaxCount: 5,
  // Overridable so a test can prove REJECTION with a real short clip in real
  // seconds rather than by recording a genuine two-minute-plus video. Not
  // meant to be tuned in production via env — the number that matters is the
  // 120 default.
  videoMaxDurationSec: Number(process.env.MEDIA_MAX_VIDEO_SEC) > 0 ? Number(process.env.MEDIA_MAX_VIDEO_SEC) : 120,
  perFile: { image: 8 * 1024 * 1024, audio: 25 * 1024 * 1024, video: 100 * 1024 * 1024 },
};
const MEDIA_MAX_FILE = Math.max(...Object.values(MEDIA_LIMITS.perFile));
const MEDIA_MIME = {
  // webm audio/video accepted for browser-recorded voiceovers and the in-browser
  // text-video generator (MediaRecorder outputs webm on most browsers).
  image: ['image/jpeg', 'image/png', 'image/webp'],
  audio: ['audio/mpeg', 'audio/mp4', 'audio/aac', 'audio/webm', 'audio/ogg'],
  /* QuickTime is accepted because it is what an iPhone hands over, and
     rejecting it outright meant a user's own recording was refused with
     "Unsupported file type" for reasons that had nothing to do with them.
     It is NOT re-encoded — there is no transcoder here and pretending
     otherwise would be worse — so the upload comes back flagged and the user
     is told plainly that MP4 is the one that plays everywhere. */
  video: ['video/mp4', 'video/webm', 'video/quicktime'],
};
// Formats every browser plays. Anything else uploads, and says so.
const MEDIA_SAFE = ['video/mp4', 'video/webm', 'audio/mpeg', 'audio/mp4', 'audio/webm', 'audio/ogg', 'image/jpeg', 'image/png', 'image/webp'];
function _mediaKind(mime) {
  const base = String(mime || '').split(';')[0].trim(); // strip ";codecs=..."
  for (const k of Object.keys(MEDIA_MIME)) if (MEDIA_MIME[k].includes(base)) return k;
  return null;
}
function _mediaExt(mime) {
  const base = String(mime || '').split(';')[0].trim();
  return ({ 'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp', 'audio/mpeg': 'mp3', 'audio/mp4': 'm4a', 'audio/aac': 'aac', 'audio/webm': 'weba', 'audio/ogg': 'ogg', 'video/mp4': 'mp4', 'video/webm': 'webm', 'video/quicktime': 'mov' })[base] || 'bin';
}
// Fallback kind + mime by file extension, for uploads whose part Content-Type is
// unreliable (e.g. busboy downgrades a webm blob whose type carries an unquoted
// "codecs=vp8,opus" to text/plain). Keeps browser-recorded media working.
const _EXT_MIME = { jpg: 'image/jpeg', jpeg: 'image/jpeg', png: 'image/png', webp: 'image/webp', mp3: 'audio/mpeg', m4a: 'audio/mp4', aac: 'audio/aac', weba: 'audio/webm', ogg: 'audio/ogg', oga: 'audio/ogg', mp4: 'video/mp4', webm: 'video/webm', mov: 'video/quicktime', qt: 'video/quicktime' };
function _mediaFromName(name) {
  const ext = String(name || '').toLowerCase().split('.').pop();
  const mime = _EXT_MIME[ext];
  return mime ? { kind: _mediaKind(mime), mime } : null;
}
function _emailHash(email) { return crypto.createHash('sha256').update(String(email).toLowerCase()).digest('hex').slice(0, 16); }
/* STREAMED TO DISK, NOT HELD IN MEMORY. memoryStorage buffers the entire file
   in RAM before the route ever sees it, so a 100 MB video is 100 MB of heap per
   concurrent upload and a handful of them is how a small container dies. Disk
   storage writes as the bytes arrive and hands the route a path.

   The temp directory lives INSIDE the media directory on purpose: the final
   step is a rename, and rename across filesystems is EXDEV rather than a move.
   Same volume, so it is atomic and costs nothing regardless of file size. */
const mediaTmpDir = path.join(dataDir, 'site-media', '.tmp');
try { fs.mkdirSync(mediaTmpDir, { recursive: true }); } catch (_) {}
const mediaUpload = multer({
  storage: multer.diskStorage({
    destination: (req, file, cb) => { try { fs.mkdirSync(mediaTmpDir, { recursive: true }); } catch (_) {} cb(null, mediaTmpDir); },
    filename: (req, file, cb) => cb(null, `up_${Date.now()}_${crypto.randomBytes(6).toString('hex')}`),
  }),
  limits: { fileSize: MEDIA_MAX_FILE, files: 1 },
});
/* A file on disk that no row points at is a leak, and every rejection below —
   wrong type, too large for its kind, quota full, or a write that throws — has
   to sweep up after itself. One helper, called on every path out. */
function _mediaDiscard(file) {
  if (file && file.path) { try { fs.unlink(file.path, () => {}); } catch (_) {} }
}
/* Delete every media file that belongs to ONE site, on disk and in the row.
   Called wherever a site itself goes away — media that outlives its site is
   exactly the bug this was built to stop: a file nothing points at any more,
   still silently spending someone's quota on whatever site they build next. */
function _deleteSiteMedia(sub) {
  const rows = db.prepare('SELECT id, path FROM site_media WHERE site_sub = ?').all(sub);
  for (const r of rows) {
    if (r.path) { try { fs.unlinkSync(r.path); } catch (_) {} }
    try { _sdMimeCache.delete(r.id); } catch (_) {}
  }
  db.prepare('DELETE FROM site_media WHERE site_sub = ?').run(sub);
}
/* Same, but for every site an account has — the legacy "delete my one site"
   route predates multi-site and still means "delete everything". */
function _deleteAllMediaForEmail(email) {
  const rows = db.prepare('SELECT id, path FROM site_media WHERE email = ?').all(email.toLowerCase());
  for (const r of rows) {
    if (r.path) { try { fs.unlinkSync(r.path); } catch (_) {} }
    try { _sdMimeCache.delete(r.id); } catch (_) {}
  }
  db.prepare('DELETE FROM site_media WHERE email = ?').run(email.toLowerCase());
}
function mediaUploadSingle(req, res, next) {
  mediaUpload.single('file')(req, res, (err) => {
    if (err) {
      _mediaDiscard(req.file);
      const msg = err.code === 'LIMIT_FILE_SIZE'
        ? `File is too large (max ${Math.round(MEDIA_MAX_FILE / 1024 / 1024)} MB).`
        : (err.message || 'Upload failed.');
      return res.status(400).json({ error: msg });
    }
    next();
  });
}

function _mediaUsage(email, sub) {
  // Scoped to ONE site, not the whole account — see the comment on the
  // `site_sub` migration above. A row with no site_sub (uploaded before this
  // column existed) matches no site and is excluded here on purpose.
  const rows = db.prepare('SELECT kind, mime, bytes FROM site_media WHERE email = ? AND site_sub = ?').all(email, sub);
  let imageAudioBytes = 0, videoBytes = 0, videoCount = 0, imageAudioCount = 0;
  for (const r of rows) {
    /* The stored kind, and the file's OWN mime if that column is ever empty.
       Only a real video is counted as one — anything unrecognised falls to the
       image/audio side rather than to video, so a row that cannot be
       identified can never inflate the number the user is judged by. */
    const kind = r.kind === 'video' || r.kind === 'image' || r.kind === 'audio' ? r.kind : _mediaKind(r.mime);
    if (kind === 'video') { videoBytes += (r.bytes || 0); videoCount++; }
    else { imageAudioBytes += (r.bytes || 0); imageAudioCount++; }
  }
  return { imageAudioBytes, videoBytes, videoCount, imageAudioCount, limits: MEDIA_LIMITS };
}
const _mb1 = (n) => (n / 1024 / 1024).toFixed(n > 100 * 1024 * 1024 ? 0 : 1);

/* Read a video's OWN declared duration from its container — the fast path
   parses only the header boxes (moov/Segment-Info), typically single-digit
   milliseconds even on a 100 MB file, because it never decodes a frame. If the
   header has no duration (rare, but some streamed/live-muxed files omit it),
   a slower full-file scan is the fallback.

   FAILS OPEN. A file this cannot parse — wrong container, truncated upload,
   a future format this parser does not know — returns `null` rather than
   throwing into the route, and the caller treats "unknown" as "not rejected
   for length". The alternative is worse: refusing every video whose duration
   this particular parser cannot determine would reject real uploads for a
   reason that has nothing to do with the two-minute policy, on nothing but
   this parser's own gaps. Duration enforcement is real when it can be proven
   and silent when it cannot — matching the standing house rule for MOV
   ("accepted, not re-encoded, and told so") of never punishing a user for an
   ambiguity that isn't theirs. */
async function _probeVideoDurationSeconds(filePath) {
  if (!_parseMedia || !_mediaParserNodeReader) return null;
  /* EXPLICITLY ABORTED WHEN DONE. `parseMedia` resolving the fields promise
     does not mean its internal reader has finished with the file — leaving it
     running was an unhandled rejection on every single upload: the route
     renames the temp file the instant it has its answer, and the parser's own
     background read then hit the old path and threw ENOENT into a promise
     nothing was awaiting. A controller, aborted in `finally`, is what tells it
     to stop before the route moves the file out from under it. */
  const withController = async (fields) => {
    const controller = _mediaParserController();
    try {
      return await _parseMedia({ src: filePath, reader: _mediaParserNodeReader, controller, fields, acknowledgeRemotionLicense: true });
    } finally {
      controller.abort();
    }
  };
  try {
    const fast = await withController({ durationInSeconds: true });
    if (typeof fast.durationInSeconds === 'number' && fast.durationInSeconds >= 0) return fast.durationInSeconds;
    const slow = await withController({ slowDurationInSeconds: true });
    return typeof slow.slowDurationInSeconds === 'number' ? slow.slowDurationInSeconds : null;
  } catch (_) {
    return null;
  }
}

/* Fire-and-forget owner alert, at most once per subscriber per day. "If anyone
   hits the 5-video limit, send me an email alert" did not ask for one email
   per attempt, and a stuck client (or a frustrated user pressing upload
   several times) would otherwise fill the owner's inbox with the same fact
   repeated. Reuses `usage_store` — already the table for this kind of daily
   per-key counter (see `translate`) — rather than adding a new one. */
function _alertVideoLimitOnce(email, sub, usage) {
  const key = `videolimit_${String(email).toLowerCase()}_${new Date().toISOString().slice(0, 10)}`;
  const already = db.prepare('SELECT count FROM usage_store WHERE key = ?').get(key);
  db.prepare('INSERT INTO usage_store (key, count) VALUES (?, 1) ON CONFLICT(key) DO UPDATE SET count = count + 1').run(key);
  if (already) return;
  notifyOwner(
    `[ResumeTailored] ${email} hit the 5-video limit`,
    `<p><strong>${_escHtml(email)}</strong> just tried to upload another video on `
    + `<strong>${_escHtml(sub)}</strong> after reaching the `
    + `${MEDIA_LIMITS.videoMaxCount}-video limit on that site.</p>`
    + `<p>Currently storing ${usage.videoCount} video${usage.videoCount === 1 ? '' : 's'}, `
    + `${_mb1(usage.videoBytes)} MB of the ${_mb1(MEDIA_LIMITS.videoPool)} MB pool.</p>`,
  );
}

app.get('/api/site-media', (req, res) => {
  const email = getSessionEmail(req);
  if (!email) return res.status(401).json({ error: 'Please sign in.' });
  const sub = _validSubdomain(req.query.subdomain);
  if (!sub) return res.status(400).json({ error: 'invalid_subdomain', message: 'Which site is this for?' });
  const items = db.prepare('SELECT id, kind, mime, bytes, created_at FROM site_media WHERE email = ? AND site_sub = ? ORDER BY created_at DESC').all(email, sub);
  res.json({ items: items.map(i => ({ ...i, url: `/media/${i.id}` })), usage: _mediaUsage(email, sub) });
});

app.post('/api/site-media', mediaUploadSingle, async (req, res) => {
  const email = getSessionEmail(req);
  /* THE FILE IS ALREADY ON DISK BY NOW. multer streams it before any of this
     runs, so every `return` below has to take the temp file with it — a
     rejected upload that leaves 100 MB behind fills the volume with files no
     row will ever point at. `bail` is the only way out. */
  const bail = (code, body) => { _mediaDiscard(req.file); return res.status(code).json(body); };
  if (!email) return bail(401, { error: 'Please sign in.' });
  if (!isSubscriber(email)) return bail(402, { error: 'pro_required', message: 'Media uploads are a Pro feature.' });
  // Every upload belongs to a specific site now — see the site_sub migration
  // comment above. multer puts non-file multipart fields on req.body.
  const sub = _validSubdomain(req.body && req.body.subdomain);
  if (!sub) return bail(400, { error: 'invalid_subdomain', message: 'Which site is this for?' });
  const site = db.prepare('SELECT email FROM personal_sites WHERE subdomain = ?').get(sub);
  if (!site || site.email.toLowerCase() !== email.toLowerCase()) return bail(403, { error: 'not_yours' });
  if (!req.file) return res.status(400).json({ error: 'No file uploaded.' });
  // Prefer the part's Content-Type, but fall back to the filename extension when
  // it's unreliable (browser blobs with unquoted codecs downgrade to text/plain).
  let kind = _mediaKind(req.file.mimetype);
  let storeMime = req.file.mimetype;
  if (!kind) {
    const byName = _mediaFromName(req.file.originalname);
    if (byName && byName.kind) { kind = byName.kind; storeMime = byName.mime; }
  }
  if (!kind) return bail(400, { error: 'Unsupported file type. Use JPG/PNG/WebP, MP3/M4A/WebM, or MP4/WebM.' });
  const bytes = req.file.size;
  /* Per KIND, after the fact. multer's own limit is the largest of the three,
     because it cannot know which kind a part is until the headers are read —
     so a 90 MB "image" gets written before it can be refused, and refusing it
     here is what keeps the 8 MB image cap real. */
  if (bytes > MEDIA_LIMITS.perFile[kind]) {
    return bail(400, { error: `That ${kind} is too large (max ${Math.round(MEDIA_LIMITS.perFile[kind] / 1024 / 1024)} MB).` });
  }
  /* DURATION, BEFORE THE COUNT AND POOL CHECKS — cheap (milliseconds, reads
     only the container header) and it is a hard rejection independent of
     quota, so there is no reason to spend a count-cap slot deciding a video
     was too long anyway. `null` means "could not be determined" and is not a
     rejection; see _probeVideoDurationSeconds. */
  if (kind === 'video') {
    const durationSec = await _probeVideoDurationSeconds(req.file.path);
    if (durationSec !== null && durationSec > MEDIA_LIMITS.videoMaxDurationSec) {
      // Seconds under a minute, minutes above it — "0.0 min" for a 40-second
      // clip would read as broken, and MEDIA_MAX_VIDEO_SEC (tests) is seconds.
      const fmt = (s) => (s < 60 ? `${Math.round(s)}s` : `${(s / 60).toFixed(s % 60 === 0 ? 0 : 1)} min`);
      return bail(400, { error: `That video is ${fmt(durationSec)} long — the limit is ${fmt(MEDIA_LIMITS.videoMaxDurationSec)} per clip. Trim it and try again.` });
    }
  }
  const usage = _mediaUsage(email, sub);
  /* THE COUNT CAP. Reinstated at the owner's explicit instruction — see the
     comment on MEDIA_LIMITS above for why this is not a regression of the
     previous round's fix. Checked before the pool check because it is the
     one usually hit first: 5 clips well under 100 MB each rarely fills 1 GB.
     Per SITE, per the site_sub migration — a video on a different site of
     yours does not spend this one's slot. */
  if (kind === 'video' && usage.videoCount >= MEDIA_LIMITS.videoMaxCount) {
    _alertVideoLimitOnce(email, sub, usage);
    return bail(400, { error: `You've reached the ${MEDIA_LIMITS.videoMaxCount}-video limit for your site. Delete one in Uploads to add another.` });
  }
  /* Only storage, and the message says what is actually stored and where to
     clear it — "storage full" with no numbers and no route out is the shape
     the video cap had, and it is what made a limit feel like a fault. */
  if (kind === 'video') {
    if (usage.videoBytes + bytes > MEDIA_LIMITS.videoPool) {
      return bail(400, { error: `Video storage is full — ${_mb1(usage.videoBytes)} MB of ${_mb1(MEDIA_LIMITS.videoPool)} MB used across ${usage.videoCount} video${usage.videoCount === 1 ? '' : 's'}. Remove one in Uploads to make room.` });
    }
  } else if (usage.imageAudioBytes + bytes > MEDIA_LIMITS.imageAudioPool) {
    return bail(400, { error: `Image and audio storage is full — ${_mb1(usage.imageAudioBytes)} MB of ${_mb1(MEDIA_LIMITS.imageAudioPool)} MB used. Remove a file in Uploads to make room.` });
  }
  try {
    const dir = path.join(dataDir, 'site-media', _emailHash(email));
    fs.mkdirSync(dir, { recursive: true });
    const fname = `${crypto.randomBytes(8).toString('hex')}.${_mediaExt(storeMime)}`;
    const full = path.join(dir, fname);
    /* A RENAME, not a copy: the bytes are already on the volume and moving them
       within it is a directory entry, whatever the file's size. The fallback is
       for the case the temp dir has somehow ended up on another filesystem,
       where rename is EXDEV — copy then unlink, correct but slower. */
    try {
      fs.renameSync(req.file.path, full);
    } catch (e) {
      if (e && e.code === 'EXDEV') { fs.copyFileSync(req.file.path, full); _mediaDiscard(req.file); }
      else throw e;
    }
    const info = db.prepare('INSERT INTO site_media (email, kind, path, mime, bytes, created_at, site_sub) VALUES (?, ?, ?, ?, ?, ?, ?)')
      .run(email.toLowerCase(), kind, full, (storeMime || '').split(';')[0].trim() || storeMime, bytes, Date.now(), sub);
    const mime = (storeMime || '').split(';')[0].trim();
    const safe = MEDIA_SAFE.includes(mime);
    res.json({
      id: info.lastInsertRowid, url: `/media/${info.lastInsertRowid}`, kind, bytes, mime,
      // The client stores this on the element so `<source type>` is exact
      // rather than guessed from a URL that carries no extension.
      safe,
      warning: safe ? null : 'This file is a .mov. It will upload and it plays in Safari and most browsers, but MP4 is the format that plays everywhere — export as MP4 if you can.',
      usage: _mediaUsage(email, sub),
    });
  } catch (e) {
    _mediaDiscard(req.file);
    res.status(500).json({ error: 'Could not save the file.' });
  }
});

app.delete('/api/site-media/:id', (req, res) => {
  const email = getSessionEmail(req);
  if (!email) return res.status(401).json({ error: 'Please sign in.' });
  const row = db.prepare('SELECT path, site_sub FROM site_media WHERE id = ? AND email = ?').get(req.params.id, email);
  db.prepare('DELETE FROM site_media WHERE id = ? AND email = ?').run(req.params.id, email);
  try { _sdMimeCache.delete(Number(req.params.id)); } catch (_) {}
  if (row && row.path) { try { fs.unlink(row.path, () => {}); } catch (_) {} }
  // The deleted row's own site, not "the caller's current site" — the client
  // does not send one on a delete, and the row already carries the answer.
  res.json({ success: true, usage: row ? _mediaUsage(email, row.site_sub) : null });
});

// Public media serving — personal sites are public, so no auth on GET. Streams
// the stored file by id with its content-type. Long cache (content is immutable).
/* `/media/12` and `/media/12.mp4` are the same file. The extension is optional
   and ignored — it exists so a URL can describe itself to anything that reads
   URLs rather than headers, without breaking every link already saved. */
app.get('/media/:id', (req, res) => {
  const id = Number(String(req.params.id).split('.')[0]);
  const row = Number.isFinite(id) ? db.prepare('SELECT path, mime FROM site_media WHERE id = ?').get(id) : null;
  if (!row || !row.path || !fs.existsSync(row.path)) {
    res.status(404);
    return res.sendFile(path.join(__dirname, 'public', '404.html'));
  }
  res.setHeader('Content-Type', row.mime);
  res.setHeader('Cache-Control', 'public, max-age=31536000, immutable');
  res.sendFile(row.path);
});

// ── Case studies: auto-generate editable candidates from a resume (Pro) ───────
app.post('/api/case-studies', (req, res) => {
  const email = getSessionEmail(req);
  if (!email) return res.status(401).json({ error: 'Please sign in.' });
  if (!isSubscriber(email)) return res.status(402).json({ error: 'pro_required' });
  const text = (req.body && typeof req.body.text === 'string') ? req.body.text : '';
  if (text.trim().length < 20) return res.status(400).json({ error: 'No resume text to analyze.' });
  res.json({ items: _extractCaseStudies(text) });
});

// ── Lead capture (public, persist-first) ─────────────────────────────────────
const leadLimiter = rateLimit({ windowMs: 60 * 1000, max: 6, message: { error: 'rate_limited', message: 'Too many submissions — please wait a minute.' } });
app.post('/api/site-lead', leadLimiter, async (req, res) => {
  const { sub, name, email: visitorEmail, message, mode, website } = req.body || {};
  // Honeypot: bots fill the hidden "website" field; humans never see it.
  if (website) return res.json({ success: true });
  const s = _validSubdomain(sub);
  if (!s) return res.status(400).json({ error: 'Unknown site.' });
  const site = db.prepare('SELECT email FROM personal_sites WHERE subdomain = ?').get(s);
  if (!site) return res.status(404).json({ error: 'Unknown site.' });
  const ve = String(visitorEmail || '').trim().slice(0, 200);
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(ve)) return res.status(400).json({ error: 'A valid email is required.' });
  // Persist FIRST — a missing RESEND_API_KEY must never lose a lead.
  // Custom fields, capped and stringified. A form is a public endpoint, so this
  // takes only what it recognises: plain string values, 12 of them, 500 chars.
  let extraJson = '';
  try {
    const src = (req.body && req.body.extra && typeof req.body.extra === 'object') ? req.body.extra : null;
    if (src) {
      const clean = {};
      for (const k of Object.keys(src).slice(0, 12)) {
        const key = String(k).replace(/[^a-zA-Z0-9_]/g, '').slice(0, 30);
        const val = src[k];
        if (key && (typeof val === 'string' || typeof val === 'number')) clean[key] = String(val).slice(0, 500);
      }
      if (Object.keys(clean).length) extraJson = JSON.stringify(clean);
    }
  } catch (_) { extraJson = ''; }
  db.prepare('INSERT INTO site_leads (sub, email, name, visitor_email, message, created_at, extra) VALUES (?, ?, ?, ?, ?, ?, ?)')
    .run(s, site.email.toLowerCase(), String(name || '').slice(0, 120), ve, String(message || '').slice(0, 2000), Date.now(), extraJson);
  // Best-effort notify the owner.
  try {
    const what = mode === 'pdf' ? 'requested your resume' : 'sent you a message';
    await sendEmail({
      to: site.email,
      subject: `New lead from your site (${s}) — someone ${what}`,
      html: `<p><strong>${_escHtml(String(name || 'A visitor'))}</strong> (${_escHtml(ve)}) ${what} via your personal site <b>${_escHtml(s)}</b>.</p>`
        + `${message ? `<p>${_escHtml(String(message).slice(0, 2000))}</p>` : ''}`
        + `${extraJson ? `<ul>${Object.entries(JSON.parse(extraJson)).map(([k, v]) => `<li><b>${_escHtml(k)}</b>: ${_escHtml(String(v))}</li>`).join('')}</ul>` : ''}`,
      replyTo: ve,
    });
  } catch (_) { /* email is best-effort; the lead is already stored */ }
  res.json({ success: true });
});

// Owner: list leads captured across their site.
app.get('/api/site-leads', (req, res) => {
  const email = getSessionEmail(req);
  if (!email) return res.status(401).json({ error: 'Please sign in.' });
  const rows = db.prepare('SELECT id, sub, name, visitor_email, message, created_at, extra FROM site_leads WHERE email = ? ORDER BY created_at DESC LIMIT 200').all(email.toLowerCase());
  res.json({ leads: rows, emailEnabled: !!(process.env.RESEND_API_KEY || (process.env.SMTP_USER && process.env.SMTP_PASS)) });
});

// ── Themed QR code (Pro) — SVG tinted to the site's colors ───────────────────
app.get('/api/site-qr', async (req, res) => {
  const email = getSessionEmail(req);
  if (!email) return res.status(401).json({ error: 'Please sign in.' });
  if (!isSubscriber(email)) return res.status(402).json({ error: 'pro_required' });
  const site = db.prepare('SELECT subdomain FROM personal_sites WHERE email = ?').get(email.toLowerCase());
  if (!site) return res.status(404).json({ error: 'Publish your site first.' });
  const origin = `${req.protocol}://${req.get('host')}`;
  const dark = '#' + String(req.query.color || '111827').replace(/[^0-9a-fA-F]/g, '').slice(0, 6);
  try {
    const QRCode = require('qrcode');
    const svg = await QRCode.toString(`${origin}/site/${site.subdomain}`, { type: 'svg', margin: 1, color: { dark: dark || '#111827', light: '#0000' } });
    res.setHeader('Content-Type', 'image/svg+xml');
    res.setHeader('Cache-Control', 'no-cache');
    res.send(svg);
  } catch (e) {
    res.status(500).json({ error: 'Could not generate the QR code.' });
  }
});

// ── Simple analytics (owner) — views + top referrer ──────────────────────────
function _recordVisit(sub, req) {
  try {
    let host = '';
    const ref = req.get('referer') || req.get('referrer') || '';
    if (ref) { try { host = new URL(ref).hostname.replace(/^www\./, ''); } catch (_) {} }
    db.prepare('INSERT INTO site_visits (sub, ts, referrer_host) VALUES (?, ?, ?)').run(sub, Date.now(), host);
  } catch (_) {}
}
app.get('/api/site-analytics', (req, res) => {
  const email = getSessionEmail(req);
  if (!email) return res.status(401).json({ error: 'Please sign in.' });
  const site = db.prepare('SELECT subdomain, views FROM personal_sites WHERE email = ?').get(email.toLowerCase());
  if (!site) return res.json({ views: 0, topReferrers: [] });
  const top = db.prepare(`SELECT CASE WHEN referrer_host = '' THEN 'direct' ELSE referrer_host END AS host, COUNT(*) AS n
                          FROM site_visits WHERE sub = ? GROUP BY host ORDER BY n DESC LIMIT 5`).all(site.subdomain);
  res.json({ views: site.views || 0, topReferrers: top });
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

// Crop an uploaded headshot (data: URL) into a circular PNG buffer so the
// Sidebar template's avatar circle shows the real photo in the .docx — matching
// the on-screen/PDF preview. Best-effort: any failure returns null and the
// renderer falls back to the styled initial. jimp is pure-JS (no native deps).
async function _dxCirclePhoto(dataUrl, size) {
  try {
    const m = /^data:image\/(png|jpe?g|webp);base64,(.+)$/i.exec(String(dataUrl || ''));
    if (!m) return null;
    const { Jimp, JimpMime } = require('jimp');
    const img = await Jimp.read(Buffer.from(m[2], 'base64'));
    const D = size || 240;
    img.cover({ w: D, h: D });
    const r = D / 2;
    img.scan(0, 0, D, D, function (x, y, idx) {
      const dx = x - r + 0.5, dy = y - r + 0.5;
      if (dx * dx + dy * dy > r * r) this.bitmap.data[idx + 3] = 0; // outside circle → transparent
    });
    return await img.getBuffer(JimpMime.png);
  } catch (err) {
    console.error('[docx] photo crop failed:', err && err.message ? err.message : err);
    return null;
  }
}

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
  // Keep the AI-written salutation (it may address the hiring manager by
  // name); the layout only falls back to "Dear Hiring Manager," without one.
  const SALUT_RE = /^dear\b.{0,60}$/i;
  let salutation = '';
  const body = paragraphs.filter(p => {
    if (CLOSE_RE.test(p)) return false;
    if (SALUT_RE.test(p)) { if (!salutation) salutation = p; return false; }
    return true;
  });
  const today = new Date().toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' });
  return {
    name: name || meta.name || 'Applicant',
    contact: contactStr || [meta.email, meta.phone, meta.location].filter(Boolean).join(' | '),
    company: meta.company || '', role: meta.role || '', date: today, body, salutation,
  };
}

// Company/date line, e.g. "DataLoom Inc | 2021 – Present" or "Acme — 2019"
function _dxIsCompanyLine(clean) {
  return !!clean && (clean.includes('—') || clean.includes('–') || (clean.includes('|') && /\d{4}/.test(clean))) && clean.length < 150;
}

// A single resume/cover content line → Word paragraph(s). `nextRaw` (the line
// that follows, if any) lets us recognise a job title: the gallery cards render
// the title as the bold prominent element and the company line as smaller
// accent text below it — the docx must match that hierarchy.
function _dxLinePara(raw, o, nextRaw) {
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
  const nextClean = nextRaw === undefined ? '' : _dxClean(String(nextRaw).trim());
  const isTitle = (wasBold && clean.length < 70) ||
    (!_dxIsCompanyLine(clean) && _dxIsCompanyLine(nextClean) && clean.length < 80);
  if (isTitle) {
    // Job title — bold, dark, with breathing room above so consecutive
    // positions read as separate blocks (matches the gallery cards).
    return [new Paragraph({ children: [new TextRun({ text: clean, font: o.font, size: sz + 2, bold: true, color: titleColor })], spacing: { before: 200, after: 20 }, keepNext: true })];
  }
  if (_dxIsCompanyLine(clean)) {
    return [new Paragraph({ children: [new TextRun({ text: clean, font: o.font, size: sz - 1, bold: true, color: o.accentHex })], spacing: { after: 60 }, keepNext: true })];
  }
  return [new Paragraph({ children: [new TextRun({ text: clean, font: o.font, size: sz, color: bodyColor })], spacing: { after: 50 } })];
}

// Render a section's lines with one-line lookahead (for job-title detection)
function _dxLines(lines, o) {
  const out = [];
  for (let i = 0; i < lines.length; i++) {
    for (const p of _dxLinePara(lines[i], o, lines[i + 1])) out.push(p);
  }
  return out;
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

// Signature: line (top border) + name in a script font. OOXML can't express a
// font-fallback chain, but Word substitutes a missing font itself — Segoe
// Script ships with Windows/Office, and machines without it (older Macs) fall
// back via Word's font substitution; italics keeps the substituted face
// signature-like either way.
function _dxSig(sigName, primaryHex, font) {
  if (!sigName || !String(sigName).trim()) return [];
  const sig = String(sigName).trim();
  return [
    new Paragraph({ children: [new TextRun({ text: '', font, size: 22 })], spacing: { before: 420 }, border: { top: { style: BorderStyle.SINGLE, size: 6, color: 'CBD5E1', space: 6 } }, keepNext: true, keepLines: true }),
    new Paragraph({ children: [new TextRun({ text: sig, font: 'Segoe Script', size: 40, italics: true, color: primaryHex })], spacing: { before: 80, after: 0 }, keepLines: true }),
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
  // Sidebar card renders its side headings in the accent colour on the dark
  // column; the plain two-column card uses the primary colour.
  const headColor = isSidebar ? o.accentHex : o.primaryHex;
  const onDark = isSidebar;

  const left = [];
  if (isSidebar) {
    // Circular headshot when the user uploaded one (matches the on-screen/PDF
    // preview); otherwise the styled initial.
    if (o.photoBuf) {
      left.push(new Paragraph({ alignment: AlignmentType.CENTER, spacing: { after: 90 }, children: [new ImageRun({ type: 'png', data: o.photoBuf, transformation: { width: 104, height: 104 } })] }));
    } else {
      left.push(new Paragraph({ alignment: AlignmentType.CENTER, spacing: { after: 60 }, children: [new TextRun({ text: (name.trim()[0] || '?').toUpperCase(), font: o.font, size: 56, bold: true, color: o.accentHex })] }));
    }
    left.push(new Paragraph({ alignment: AlignmentType.CENTER, spacing: { after: 120 }, children: [new TextRun({ text: name, font: o.font, size: 24, bold: true, color: 'FFFFFF' })] }));
  } else {
    left.push(new Paragraph({ children: [new TextRun({ text: name, font: o.font, size: 30, bold: true, color: o.primaryHex })], spacing: { after: 80 } }));
  }
  left.push(_dxSideHeading('Contact', { font: o.font, headColor, accentHex: o.accentHex }));
  for (const cp of contactParts) left.push(new Paragraph({ children: [new TextRun({ text: cp, font: o.font, size: 18, color: onDark ? 'E6E6E6' : '555555' })], spacing: { after: 40 } }));
  for (const sec of sideSecs) {
    left.push(_dxSideHeading(sec.title, { font: o.font, headColor, accentHex: o.accentHex }));
    for (const p of _dxLines(sec.lines, { font: o.font, accentHex: o.accentHex, onDark, small: true })) left.push(p);
  }

  const right = [];
  const mainStyle = isSidebar ? 'underline' : 'icon-bar';
  mainSecs.forEach(sec => {
    right.push(_dxHeading(sec.title, { style: mainStyle, primaryHex: o.primaryHex, accentHex: o.accentHex, font: o.font }));
    for (const p of _dxLines(sec.lines, { font: o.font, accentHex: o.accentHex, onDark: false })) right.push(p);
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
      for (const p of _dxLines(sec.lines, { font, accentHex: o.accentHex, onDark: false })) body.push(p);
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
    // Card shows the name bold with tight tracking, not letterspaced-light.
    out.push(new Paragraph({ children: [new TextRun({ text: name, font, size: 40, bold: true, color: '111827' })], spacing: { after: 60 } }));
    if (contactParts.length) out.push(new Paragraph({ children: [new TextRun({ text: contactParts.join('   |   '), font, size: 18, color: '666666' })], spacing: { after: 160 }, border: { bottom: { style: BorderStyle.SINGLE, size: 6, color: o.primaryHex, space: 6 } } }));
  } else if (o.layout === 'rExecutive') {
    // Coloured left bar on the name + contact, matching the gallery card.
    const lb = { left: { style: BorderStyle.SINGLE, size: 24, color: o.primaryHex, space: 8 } };
    out.push(new Paragraph({ children: [new TextRun({ text: name, font, size: 44, bold: true, color: o.primaryHex })], border: lb, indent: { left: 60 }, spacing: { after: 40 } }));
    if (contactParts.length) out.push(new Paragraph({ children: [new TextRun({ text: contactParts.join('   |   '), font, size: 19, color: '555555' })], border: lb, indent: { left: 60 }, spacing: { after: 120 } }));
  } else {
    // rClassic — centred name + contact with a full-width rule underneath.
    // The gallery card sets the name in caps with letter-spacing.
    out.push(new Paragraph({ alignment: AlignmentType.CENTER, children: [new TextRun({ text: name, font, size: 44, bold: true, color: o.primaryHex, allCaps: true, characterSpacing: 40 })], spacing: { after: 40 } }));
    if (contactParts.length) {
      out.push(new Paragraph({ alignment: AlignmentType.CENTER, children: [new TextRun({ text: contactParts.join('   |   '), font, size: 19, color: '555555' })], spacing: { after: 120 }, border: { bottom: { style: BorderStyle.SINGLE, size: 12, color: o.primaryHex, space: 6 } } }));
    } else {
      out.push(new Paragraph({ children: [new TextRun({ text: '', font, size: 2 })], border: { bottom: { style: BorderStyle.SINGLE, size: 12, color: o.primaryHex, space: 6 } }, spacing: { after: 120 } }));
    }
  }
  const headStyle = { rClassic: 'underline', rExecutive: 'left-bar', rMinimal: 'minimal', rModern: 'icon-bar', rBanner: 'banner-pill' }[o.layout] || 'underline';
  sections.forEach(sec => {
    out.push(_dxHeading(sec.title, { style: headStyle, primaryHex: o.primaryHex, accentHex: o.accentHex, font }));
    for (const p of _dxLines(sec.lines, { font, accentHex: o.accentHex, onDark: false })) out.push(p);
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
    // cFormal — classic business letter. The card shows a recipient block
    // ("[Role] Hiring Team" + company) between the date and the salutation.
    out.push(new Paragraph({ children: [new TextRun({ text: p.name, font, size: 30, bold: true, color: o.primaryHex })], spacing: { after: 40 }, border: { bottom: { style: BorderStyle.SINGLE, size: 12, color: o.primaryHex, space: 6 } } }));
    if (p.contact) out.push(new Paragraph({ children: [new TextRun({ text: p.contact, font, size: 18, color: '888888' })], spacing: { before: 80, after: 200 } }));
    out.push(new Paragraph({ children: [new TextRun({ text: p.date, font, size: 19, color: '777777' })], spacing: { after: 160 } }));
    if (p.role) out.push(new Paragraph({ children: [new TextRun({ text: p.role + ' Hiring Team', font, size: 20, bold: true, color: '333333' })], spacing: { after: 20 } }));
    if (p.company) out.push(new Paragraph({ children: [new TextRun({ text: p.company, font, size: 19, color: '666666' })], spacing: { after: 160 } }));
  }

  // Salutation as plain body text; preserve the AI's "Dear [Name]," when present.
  const salutation = p.salutation || 'Dear Hiring Manager,';
  out.push(new Paragraph({ children: [new TextRun({ text: salutation, font, size: 22, color: '333333' })], spacing: { before: 120, after: 180 } }));
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

async function buildTemplatedDocxBuffer({ text, coverText, sigName, pageSize, mode, primary, cover, meta, docFont, photoUrl, watermark }) {
  const isA4 = pageSize === 'a4';
  const PAGE_WIDTH = isA4 ? 11906 : 12240;
  const PAGE_HEIGHT = isA4 ? 16838 : 15840;

  // Free-tier watermark: a single small, muted, centered line pinned to the page
  // footer. Fresh instance per section (docx footers are not shared across
  // sections). Pro exports pass watermark=false and get no footer.
  const wmFooter = () => new Footer({
    children: [new Paragraph({
      alignment: AlignmentType.CENTER,
      spacing: { before: 120 },
      children: [new TextRun({ text: 'Made with ResumeTailored AI  ·  resumetailored.com', size: 15, color: '9aa3af', font: 'Arial' })],
    })],
  });

  // Pre-process the headshot once (async) into a circular PNG the sync renderers
  // can drop straight into the Sidebar avatar.
  const photoBuf = photoUrl ? await _dxCirclePhoto(photoUrl) : null;

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
        photoBuf,
      },
      margin: m,
    };
  };

  const isCover = mode === 'cover_letter';
  const isBoth = mode === 'both';

  const prim = buildOpts(primary, !isBoth); // in 'both' mode the signature lives on the cover
  const primChildren = isCover ? _dxRenderCover(text, prim.opts, meta) : _dxRenderResume(text, prim.opts);
  const sections = [{
    properties: { page: { size: { width: PAGE_WIDTH, height: PAGE_HEIGHT }, margin: prim.margin } },
    children: primChildren,
    ...(watermark ? { footers: { default: wmFooter() } } : {}),
  }];

  if (isBoth && coverText) {
    const cv = buildOpts(cover, true);
    sections.push({
      properties: { page: { size: { width: PAGE_WIDTH, height: PAGE_HEIGHT }, margin: cv.margin } },
      children: _dxRenderCover(coverText, cv.opts, meta),
      ...(watermark ? { footers: { default: wmFooter() } } : {}),
    });
  }

  return Packer.toBuffer(new Document({ sections }));
}

async function handleTemplatedDocx(req, res) {
  const { text, coverText, filename, sigName, pageSize, mode, primary, cover, meta, docFont, email } = req.body;
  const subscribed = isSubscriber(email);

  // Server-side template gating: non-subscribers may only render free templates.
  // In 'both' mode the resume uses `primary` and the cover uses `cover`; in the
  // single modes only `primary` is used. Reject a Pro template rather than
  // silently downgrading, so the client shows a clear upgrade prompt.
  if (!subscribed) {
    const primaryOk = isFreeTemplateMeta(primary);
    const coverOk = mode === 'both' ? isFreeTemplateMeta(cover) : true;
    if (!primaryOk || !coverOk) {
      res.status(402).json({ error: 'pro_template', message: 'This template is Pro-only. Upgrade to unlock all templates, or pick a free template.' });
      return;
    }
  }

  // Validate the optional headshot the same way the video route does.
  let photoUrl = req.body.photoUrl;
  if (!(typeof photoUrl === 'string' && /^data:image\/(png|jpe?g|webp);base64,/i.test(photoUrl) && photoUrl.length < 2000000)) {
    photoUrl = null;
  }
  // Free-tier exports carry a subtle bottom watermark; Pro exports are clean.
  const buffer = await buildTemplatedDocxBuffer({ text, coverText, sigName, pageSize, mode, primary, cover, meta, docFont, photoUrl, watermark: !subscribed });

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

// ─── Share resume as a public link ────────────────────────────────────────────
// Snapshot a tailored resume to an unguessable public URL (/r/<slug>) that opens
// in the browser — no download — for sharing on LinkedIn/email. The stored data
// is the raw resume text + template accent + optional photo; the public page is
// rendered server-side from that structured data (every user value escaped), so
// there is no stored-HTML/XSS surface. Pages are noindex so personal info never
// lands in Google.
function _escHtml(s) {
  return String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}
function _shareSlug() {
  // ~10 chars of url-safe base62 from crypto bytes.
  const b = crypto.randomBytes(8).toString('base64').replace(/[^a-zA-Z0-9]/g, '');
  return (b + crypto.randomBytes(4).toString('hex')).slice(0, 10);
}

// Render one resume section's lines to safe HTML (bullets, job titles, company/
// date lines, plain paragraphs) — mirrors the docx line classification.
function _shareLinesHtml(lines, accent) {
  const out = [];
  let openUl = false;
  const closeUl = () => { if (openUl) { out.push('</ul>'); openUl = false; } };
  for (let i = 0; i < lines.length; i++) {
    const raw = String(lines[i]).trim();
    const clean = _dxClean(raw);
    if (!clean) continue;
    if (/^[•·\-\*]\s/.test(raw)) {
      if (!openUl) { out.push('<ul class="r-bul">'); openUl = true; }
      out.push('<li>' + _escHtml(clean.replace(/^[•·\-\*]\s*/, '')) + '</li>');
      continue;
    }
    closeUl();
    const nextClean = _dxClean(String(lines[i + 1] || '').trim());
    const wasBold = /^\*\*[^*]+\*\*$/.test(raw);
    const isTitle = (wasBold && clean.length < 70) || (!_dxIsCompanyLine(clean) && _dxIsCompanyLine(nextClean) && clean.length < 80);
    if (isTitle) { out.push('<div class="r-title">' + _escHtml(clean) + '</div>'); continue; }
    if (_dxIsCompanyLine(clean)) { out.push('<div class="r-co" style="color:' + accent + '">' + _escHtml(clean) + '</div>'); continue; }
    out.push('<p class="r-p">' + _escHtml(clean) + '</p>');
  }
  closeUl();
  return out.join('');
}

// Template families the shared page knows how to render. Anything else → linear.
const _SHARE_LAYOUTS = new Set(['rClassic', 'rExecutive', 'rMinimal', 'rModern', 'rSidebar', 'rTwoCol', 'rBanner']);

// Skills/education-type lines → chips (splitting a single comma list into items).
function _shareChips(lines, cls) {
  let items = (lines || []).map(l => _dxClean(String(l).trim()).replace(/^[•·\-\*]\s*/, '')).filter(Boolean);
  if (items.length === 1 && items[0].includes(',')) items = items[0].split(/\s*,\s*/).filter(Boolean);
  return items.map(i => `<span class="${cls}">${_escHtml(i)}</span>`).join('');
}

// Renders a stored resume to a standalone HTML page. Used by two features:
//  • Share links (/r/:slug) — noindex, carries a "Made with ResumeTailored"
//    footer, canonical URL /r/<slug>.
//  • Personal websites (/site/:name) — a Pro feature: indexable, watermark-free
//    (no footer), canonical URL from opts.canonicalUrl.
// opts: { indexable?:bool, footer?:string (html or ''), canonicalUrl?:string }
function _shareResumeHtml(row, origin, opts = {}) {
  const { name, contactParts, sections } = _dxParseResume(row.text || '');
  const primary = '#' + String(row.primary_hex || '4a1042').replace('#', '');
  const accent = '#' + String(row.accent || '8b5cf6').replace('#', '');
  const serif = row.serif ? "Georgia,'Times New Roman',serif" : "'Inter',-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif";
  const layout = _SHARE_LAYOUTS.has(row.layout) ? row.layout : 'rClassic';
  const displayName = name || 'Resume';
  const initial = (displayName.trim()[0] || '?').toUpperCase();
  const summarySec = sections.find(s => /SUMMARY|PROFILE/i.test(s.title));
  const ogDesc = _escHtml(((summarySec && summarySec.lines.join(' ')) || 'Professional resume').replace(/\s+/g, ' ').replace(/[*#]/g, '').trim().slice(0, 160));
  const indexable = !!opts.indexable;
  const shareUrl = opts.canonicalUrl || `${origin}/r/${row.slug}`;
  const footerHtml = opts.footer !== undefined
    ? opts.footer
    : `<div class="r-foot">Made with <a href="${origin}/?utm_source=shared_resume" target="_blank" rel="noopener">ResumeTailored AI</a> — tailor your resume to any job in 60 seconds</div>`;

  // A resume's contact line is usually one "a | b | c" string — split it so the
  // pieces render as clean rows (in a rail) or ·-separated spans (inline).
  const contactItems = contactParts.flatMap(p => String(p).split(/\s*\|\s*/)).map(s => s.trim()).filter(Boolean);
  const contactSpans = contactItems.map(c => `<span>${_escHtml(c)}</span>`).join('<span class="r-dot">·</span>');
  const contactHtml = row.hide_contact ? '' : contactSpans;
  const avatar = (ring) => row.photo
    ? `<div class="r-av" style="background-image:url('${_escHtml(row.photo)}')"></div>`
    : `<div class="r-av r-av-mono" style="background:linear-gradient(135deg,${accent},${primary})${ring ? `;box-shadow:0 0 0 3px ${ring}` : ''}">${_escHtml(initial)}</div>`;

  // Two-column families split skills/education/etc. into a side rail.
  const sideSecs = [], mainSecs = [];
  for (const sec of sections) (_DX_SIDE_KEYS.some(k => sec.title.toUpperCase().includes(k)) ? sideSecs : mainSecs).push(sec);

  // A main content section; `kind` picks the header treatment per family.
  const mainSec = (sec, kind) => {
    let h;
    if (kind === 'modern') h = `<h2 class="r-h r-h-modern"><span class="r-bar"></span>${_escHtml(sec.title)}</h2>`;
    else if (kind === 'banner') h = `<span class="r-h-badge">${_escHtml(sec.title)}</span>`;
    else h = `<h2 class="r-h">${_escHtml(sec.title)}</h2>`;
    return `<section class="r-sec">${h}${_shareLinesHtml(sec.lines, accent)}</section>`;
  };

  let bodyClass, bodyHtml;
  if (layout === 'rSidebar') {
    bodyClass = 'lay-sidebar';
    const sideHtml = sideSecs.map(s => `<div class="r-side-sec"><h3>${_escHtml(s.title)}</h3><div class="r-chips">${_shareChips(s.lines, 'r-chip')}</div></div>`).join('');
    bodyHtml = `<div class="sheet">
      <aside class="r-aside">${avatar('rgba(255,255,255,.4)')}<div class="r-aside-name">${_escHtml(displayName)}</div>
        ${contactHtml ? `<div class="r-side-sec"><h3>Contact</h3><div class="r-side-contact">${contactItems.map(c => `<div>${_escHtml(c)}</div>`).join('')}</div></div>` : ''}
        ${sideHtml}</aside>
      <main class="r-main">${mainSecs.map(s => mainSec(s, 'plain')).join('')}</main>
    </div>`;
  } else if (layout === 'rTwoCol') {
    bodyClass = 'lay-twocol';
    const sideHtml = sideSecs.map(s => `<section class="r-sec r-sec-sm"><h2 class="r-h">${_escHtml(s.title)}</h2>${_shareLinesHtml(s.lines, accent)}</section>`).join('');
    bodyHtml = `<div class="sheet">
      <aside class="r-left"><div class="r-left-name">${_escHtml(displayName)}</div>
        ${contactHtml ? `<div class="r-left-contact">${contactItems.map(c => `<div>${_escHtml(c)}</div>`).join('')}</div>` : ''}
        ${sideHtml}</aside>
      <main class="r-main">${mainSecs.map(s => mainSec(s, 'plain')).join('')}</main>
    </div>`;
  } else if (layout === 'rModern') {
    bodyClass = 'lay-modern';
    bodyHtml = `<div class="sheet">
      <header class="r-banner"><div class="r-banner-name">${_escHtml(displayName)}</div>${contactHtml ? `<div class="r-banner-contact">${contactHtml}</div>` : ''}</header>
      <div class="r-body">${sections.map(s => mainSec(s, 'modern')).join('')}</div>
    </div>`;
  } else if (layout === 'rBanner') {
    bodyClass = 'lay-banner';
    bodyHtml = `<div class="sheet">
      <header class="r-bhead"><div class="r-bhead-name">${_escHtml(displayName)}</div>${contactHtml ? `<div class="r-bhead-contact">${contactHtml}</div>` : ''}<div class="r-bhead-rule"></div></header>
      <div class="r-body">${sections.map(s => mainSec(s, 'banner')).join('')}</div>
    </div>`;
  } else {
    // Linear: rClassic (centered/underline), rExecutive (left bar), rMinimal (thin).
    bodyClass = layout === 'rExecutive' ? 'lay-exec' : layout === 'rMinimal' ? 'lay-minimal' : 'lay-classic';
    const head = `<div class="r-head"><div class="r-name">${_escHtml(displayName)}</div>${contactHtml ? `<div class="r-contact">${contactHtml}</div>` : ''}</div>`;
    bodyHtml = `<div class="sheet"><div class="r-body">${head}${sections.map(s => mainSec(s, 'plain')).join('')}</div></div>`;
  }

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8"/>
  <meta name="viewport" content="width=device-width,initial-scale=1.0"/>
  <meta name="robots" content="${indexable ? 'index,follow' : 'noindex,nofollow'}"/>
  <title>${_escHtml(displayName)} — Resume</title>
  <meta property="og:type" content="profile"/>
  <meta property="og:title" content="${_escHtml(displayName)} — Resume"/>
  <meta property="og:description" content="${ogDesc}"/>
  <meta property="og:url" content="${_escHtml(shareUrl)}"/>
  <meta property="og:image" content="${origin}/og-image.png"/>
  <meta name="twitter:card" content="summary_large_image"/>
  <link rel="icon" href="/favicon.svg" type="image/svg+xml"/>
  <link rel="preconnect" href="https://fonts.googleapis.com"/>
  <link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700;800;900&display=swap" rel="stylesheet"/>
  <style>
    :root{--p:${primary};--a:${accent};}
    *{box-sizing:border-box;margin:0;padding:0;}
    body{font-family:${serif};background:#eef0f4;color:#1f2430;line-height:1.6;padding:24px 14px 60px;-webkit-print-color-adjust:exact;print-color-adjust:exact;}
    .sheet{max-width:820px;margin:0 auto;background:#fff;border-radius:16px;box-shadow:0 6px 24px rgba(0,0,0,.08);overflow:hidden;}
    .r-body{padding:44px 46px 38px;}
    /* shared content styling */
    .r-sec{margin-bottom:22px;}
    .r-h{font-size:12px;font-weight:800;text-transform:uppercase;letter-spacing:2px;color:var(--p);border-bottom:2px solid var(--a);padding-bottom:5px;margin-bottom:12px;}
    .r-title{font-size:15.5px;font-weight:800;color:#1a1f2b;margin-top:12px;}
    .r-co{font-size:13px;font-weight:700;margin:1px 0 6px;}
    .r-p{font-size:14px;color:#39414f;margin-bottom:8px;}
    .r-bul{list-style:none;margin:2px 0 8px;}
    .r-bul li{font-size:14px;color:#39414f;padding-left:18px;position:relative;margin-bottom:6px;}
    .r-bul li::before{content:'';position:absolute;left:2px;top:9px;width:5px;height:5px;border-radius:50%;background:var(--a);}
    .r-dot{color:#c3c9d4;}
    .r-av{width:96px;height:96px;border-radius:50%;flex-shrink:0;background-size:cover;background-position:center;}
    .r-av-mono{display:flex;align-items:center;justify-content:center;color:#fff;font-size:38px;font-weight:800;}
    .r-foot{max-width:820px;margin:20px auto 0;text-align:center;font-size:13px;color:#8a93a3;}
    .r-foot a{color:var(--p);font-weight:700;text-decoration:none;}
    /* Linear header variants */
    .r-head{margin-bottom:24px;}
    .r-name{font-size:32px;font-weight:800;letter-spacing:-.5px;color:var(--p);line-height:1.15;}
    .r-contact{font-size:13.5px;color:#5b6472;margin-top:7px;display:flex;flex-wrap:wrap;gap:6px;align-items:center;}
    .lay-classic .r-head{text-align:center;border-bottom:2px solid var(--p);padding-bottom:18px;}
    .lay-classic .r-contact{justify-content:center;}
    .lay-exec .r-head{border-left:5px solid var(--p);padding-left:16px;}
    .lay-minimal .r-name{font-weight:300;text-transform:uppercase;letter-spacing:5px;font-size:26px;color:#111;}
    .lay-minimal .r-head{border-bottom:1px solid var(--p);padding-bottom:14px;}
    .lay-minimal .r-h{border-bottom:none;letter-spacing:3px;}
    /* Modern banner */
    .r-banner{background:var(--p);color:#fff;padding:30px 46px;}
    .r-banner-name{font-size:30px;font-weight:900;letter-spacing:-.5px;}
    .r-banner-contact{margin-top:8px;font-size:13px;color:rgba(255,255,255,.82);display:flex;flex-wrap:wrap;gap:6px;align-items:center;}
    .lay-modern .r-h-modern{display:flex;align-items:center;gap:9px;border-bottom:none;}
    .lay-modern .r-bar{width:4px;height:16px;background:var(--a);border-radius:2px;display:inline-block;}
    /* Banner (badge pills) */
    .r-bhead{padding:30px 46px 0;border-left:5px solid var(--p);margin:22px 0 4px;}
    .r-bhead-name{font-size:30px;font-weight:900;color:var(--p);letter-spacing:-.5px;}
    .r-bhead-contact{font-size:13px;color:#5b6472;margin-top:7px;display:flex;flex-wrap:wrap;gap:6px;align-items:center;}
    .r-bhead-rule{height:2px;background:linear-gradient(to right,var(--p),var(--a),transparent);margin-top:14px;border-radius:1px;}
    .r-h-badge{display:inline-block;background:var(--p);color:#fff;font-size:10px;font-weight:800;text-transform:uppercase;letter-spacing:2px;padding:4px 12px;border-radius:4px;margin-bottom:11px;}
    /* Sidebar (dark rail) */
    .lay-sidebar .sheet,.lay-twocol .sheet{display:flex;align-items:stretch;}
    .r-aside{width:270px;flex-shrink:0;background:var(--p);color:#fff;padding:38px 26px;}
    .r-aside .r-av{margin:0 auto 16px;box-shadow:0 0 0 3px rgba(255,255,255,.35);}
    .r-aside-name{text-align:center;font-size:20px;font-weight:800;line-height:1.25;margin-bottom:22px;}
    .r-side-sec{margin-bottom:20px;}
    .r-side-sec h3{font-size:10px;font-weight:800;text-transform:uppercase;letter-spacing:2px;color:var(--a);border-bottom:1px solid rgba(255,255,255,.22);padding-bottom:5px;margin-bottom:10px;}
    .r-side-contact{font-size:12.5px;color:rgba(255,255,255,.85);line-height:1.85;word-break:break-word;}
    .r-chips{display:flex;flex-wrap:wrap;gap:6px;}
    .r-chip{background:rgba(255,255,255,.14);color:#fff;font-size:11.5px;padding:4px 10px;border-radius:5px;}
    .lay-sidebar .r-main{flex:1;min-width:0;padding:40px 40px 34px;}
    /* Two-column (light rail) */
    .r-left{width:250px;flex-shrink:0;padding:38px 22px 34px 30px;border-right:2px solid var(--a);}
    .r-left-name{font-size:22px;font-weight:900;color:var(--p);line-height:1.2;margin-bottom:12px;}
    .r-left-contact{font-size:12px;color:#5b6472;line-height:1.9;margin-bottom:20px;word-break:break-word;}
    .r-sec-sm .r-h{font-size:11px;}
    .r-sec-sm .r-p,.r-sec-sm .r-bul li{font-size:12.5px;}
    .lay-twocol .r-main{flex:1;min-width:0;padding:38px 34px 34px;}
    @media(max-width:640px){
      body{padding:14px 10px 44px;}
      .r-body,.r-banner,.r-bhead{padding-left:24px;padding-right:24px;}
      .lay-sidebar .sheet,.lay-twocol .sheet{flex-direction:column;}
      .r-aside{width:auto;}
      .r-left{width:auto;border-right:none;border-bottom:2px solid var(--a);padding:30px 24px;}
      .lay-sidebar .r-main,.lay-twocol .r-main{padding:30px 24px;}
      .r-name,.r-banner-name,.r-bhead-name{font-size:25px;}
    }
  </style>
</head>
<body class="${bodyClass}">
  ${bodyHtml}
  ${footerHtml}
</body>
</html>`;
}

// ── Personal website renderer (Pro) ─────────────────────────────────────────
// SEPARATE from _shareResumeHtml on purpose: "Create a Link" (/r/:slug) stays a
// plain resume snapshot, while the Pro website is free to grow into a full
// multi-section, media-rich, config-driven page. Keeping the two renderers apart
// is what lets us change one without disturbing the other (the /r/:slug output is
// covered by a byte-identical snapshot in test/render-snapshot.js).
//
// Phase 1: no site has a `config` yet, and legacy sites have `config IS NULL`, so
// this delegates to the shared resume-document renderer — byte-identical to the
// previous /site output. Later phases parse `config` and build the site here.
// Personal sites are rendered by exactly one renderer: the Website Builder v2
// site-document renderer. The editor canvas and the preview endpoint run through
// this same function, so preview is the published page by construction.
// (`_shareResumeHtml` is now used only by Create-a-Link at /r/:slug.)
function _renderPersonalSite(row, origin, opts = {}) {
  let config = null;
  if (row && row.config) { try { config = JSON.parse(row.config); } catch (_) { config = null; } }
  if (config && Array.isArray(config.pages) && config.pages.length) {
    return _renderSiteDoc(row, origin, opts, config);
  }
  return _renderSiteUnbuilt(row, origin, opts);
}

// A site row with no v2 document (e.g. an old test site) renders a small
// placeholder rather than 500ing. There is no legacy rendering path.
function _renderSiteUnbuilt(row, origin, opts = {}) {
  return `<!DOCTYPE html>
<html lang="en">
<head><meta charset="UTF-8"/><meta name="viewport" content="width=device-width,initial-scale=1.0"/>
<meta name="robots" content="noindex,nofollow"/><title>Site not published yet</title>
<link rel="preconnect" href="https://fonts.googleapis.com"/>
<link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;700;900&display=swap" rel="stylesheet"/>
<style>body{font-family:'Inter',sans-serif;background:#030712;color:#e2e8f0;display:flex;min-height:100vh;align-items:center;justify-content:center;text-align:center;padding:24px;}
.b{max-width:420px}h1{font-size:24px;font-weight:900;margin-bottom:10px}p{color:#94a3b8;font-size:15px}
a{display:inline-block;margin-top:18px;background:linear-gradient(135deg,#6366F1,#8B5CF6);color:#fff;text-decoration:none;font-weight:700;padding:11px 22px;border-radius:999px}</style></head>
<body><div class="b"><h1>This site hasn't been built yet</h1>
<p>Pick a template in the Website Builder to publish it.</p>
<a href="${origin}/dashboard">Open the Website Builder</a></div></body></html>`;
}


// Public-site chrome strings (user content is shown as authored). Shared by the
// grid renderer and the contact block so a zh site renders in Chinese server-side.
const _SITE_I18N = {
  en: { lang_toggle: '中文', c_name: 'Your name', c_email: 'Your email', c_msg: 'Message', c_send: 'Send', c_send_pdf: 'Send me the resume', c_thanks: 'Thanks — your message was sent.', c_thanks_pdf: "Thanks! I'll be in touch with my resume shortly.", c_err: 'Something went wrong — please try again.', contact_h: 'Get in touch', request_h: 'Request my resume', add_video: 'Add a video', add_audio: 'Add audio', add_address: 'Add an address', add_links: 'Add your links', find_me: 'Find me on {x}', cover_dl: 'Read my cover letter', voice_intro: '▶ Play my introduction' },
  zh: { lang_toggle: 'EN', c_name: '你的姓名', c_email: '你的邮箱', c_msg: '留言', c_send: '发送', c_send_pdf: '把简历发给我', c_thanks: '谢谢——你的留言已发送。', c_thanks_pdf: '谢谢！我会尽快把简历发给你。', c_err: '出了点问题——请重试。', contact_h: '联系我', request_h: '索取我的简历', add_video: '添加视频', add_audio: '添加音频', add_address: '添加地址', add_links: '添加你的链接', find_me: '在 {x} 上找到我', cover_dl: '下载我的求职信', voice_intro: '▶ 播放我的自我介绍' },
};

// A resume rendered as a self-contained fragment (used by a `resume` block).
// Built from the standalone _dxParseResume/_shareLinesHtml helpers so it never
// touches _shareResumeHtml (which the Link relies on staying byte-identical).
function _renderResumeFragment(row, accent) {
  const { name, contactParts, sections } = _dxParseResume(row.text || '');
  const displayName = name || 'Resume';
  const contactItems = contactParts.flatMap(p => String(p).split(/\s*\|\s*/)).map(s => s.trim()).filter(Boolean);
  const contactHtml = row.hide_contact ? '' :
    contactItems.map(c => `<span>${_escHtml(c)}</span>`).join('<span class="sg-dot">·</span>');
  const secHtml = sections.map(s => `<section class="sg-sec"><h2 class="sg-h">${_escHtml(s.title)}</h2>${_shareLinesHtml(s.lines, accent)}</section>`).join('');
  return `<div class="sg-resume"><div class="sg-rhead"><div class="sg-rname">${_escHtml(displayName)}</div>${contactHtml ? `<div class="sg-rcontact">${contactHtml}</div>` : ''}</div>${secHtml}</div>`;
}

// Auto-generate case-study candidates from resume bullets. Tiered: Tier-1 bullets
// (strong metric: %, $, ×, time-delta) always qualify; Tier-2 (generic "N noun"
// counts) only fill up to a 3-card minimum, so metric-rich resumes stay clean and
// sparse ones still get a respectable set. Output is editable by the user.
const _CS_BULLET_RE = /^\s*[•\-*–·▪]\s+/;
const _CS_TIER1_RE = /(\$\s?\d[\d,.]*\s?(k|m|bn|billion|million|thousand)?|\d[\d,.]*\s?%|\b\d+(\.\d+)?\s?x\b|\bfrom\s+\d[\d,.]*\w*\s+to\s+\d[\d,.]*\w*|\d[\d,.]*\s?(ms|hours?|days?|weeks?|months?)\b)/i;
const _CS_TIER2_RE = /\b\d{1,3}[\d,.]*\+?\s?[A-Za-z][A-Za-z-]{2,}\b/;
function _csTitle(b) {
  let head = String(b).split(/,|—|–| by | that | which | to /i)[0];
  head = head.replace(/\s+/g, ' ').trim().replace(/[.;:]+$/, '');
  if (head.length > 60) head = head.slice(0, 57).replace(/\s\S*$/, '') + '…';
  return head || 'Project';
}
function _extractCaseStudies(text, max = 6) {
  const bullets = String(text || '').split('\n')
    .filter(l => _CS_BULLET_RE.test(l))
    .map(l => l.replace(_CS_BULLET_RE, '').replace(/\s+/g, ' ').trim())
    .filter(b => b.length > 12);
  const tier1 = [], tier2 = [];
  for (const b of bullets) {
    const m1 = b.match(_CS_TIER1_RE);
    if (m1) { tier1.push({ title: _csTitle(b), metric: m1[0].trim(), body: b }); continue; }
    const m2 = b.match(_CS_TIER2_RE);
    if (m2) tier2.push({ title: _csTitle(b), metric: m2[0].trim(), body: b });
  }
  const out = tier1.slice(0, max);
  for (const c of tier2) { if (out.length >= Math.max(3, tier1.length)) break; if (out.length >= max) break; out.push(c); }
  return out;
}

// Clamp helpers for untrusted numeric block placement.
const _clampInt = (v, lo, hi, dflt) => { const n = Math.round(Number(v)); return Number.isFinite(n) ? Math.min(hi, Math.max(lo, n)) : dflt; };
const _safeUrl = (u) => (typeof u === 'string' && /^(https?:\/\/|\/|data:image\/(png|jpe?g|webp);base64,)/i.test(u) && u.length < 2000000) ? u : '';

// For hrefs rather than asset sources. `_safeUrl` deliberately rejects
// `mailto:`/`tel:` because it also guards <img src>, but a social link or
// button pointing at an email address is legitimate — and silently dropping it
// meant every "Email" button in the templates rendered as nothing.
const _safeLinkUrl = (u) => {
  if (typeof u !== 'string') return '';
  if (/^mailto:[^\s"'<>]{3,320}$/i.test(u) || /^tel:\+?[0-9()\-.\s]{3,32}$/i.test(u)) return u;
  return _safeUrl(u);
};


// ─── Website Builder v2 — site-document renderer ─────────────────────────────
// A site document is: pages → sections → absolutely-positioned elements.
//
//   { v:2, theme:{...}, pages:[ { id,name,slug,isHome,seo,
//       sections:[ { id,h,bg,els:[ { id,type,x,y,w,h,z,mhide,props } ] } ] } ] }
//
// Elements are laid out on a 1200px-wide design canvas. x/w are emitted as
// percentages (so the canvas is fluid), y/h stay in px (vertical rhythm).
//
// MOBILE: elements are emitted in reading order (sorted by y, then x) and the
// mobile stylesheet drops them to static full-width flow — so a template stacks
// correctly on a phone with no per-element work. Per-element mobile overrides
// come later; `mhide` (hide on mobile) is honored now.
const SD_CANVAS = 1200;
const _sdPct = (v) => (Math.max(0, Math.min(SD_CANVAS, Number(v) || 0)) / SD_CANVAS * 100).toFixed(4) + '%';
const _sdPx = (v, dflt = 0) => { const n = Number(v); return Number.isFinite(n) ? Math.max(0, Math.round(n)) : dflt; };
const _sdColor = (c, dflt) => (typeof c === 'string' && /^#?[0-9a-fA-F]{3,8}$/.test(c.replace('#', '')) ? ('#' + c.replace('#', '')) : dflt);
const _sdText = (s, max = 4000) => _escHtml(String(s == null ? '' : s).slice(0, max));

/* ── Fonts ────────────────────────────────────────────────────────────────
   A CURATED list, not a free-text family name. Two reasons, and the second is
   the important one: a font name goes into a Google Fonts URL and into a CSS
   `font-family`, so accepting arbitrary text would let a site document decide
   what the page fetches; and a resume site with a novelty font on it is worse
   for its owner than one with a slightly wrong-but-professional font.

   Keys are what the document stores. Anything not in this table is ignored and
   the template's own default stands. */
const SD_FONTS = {
  inter: { name: 'Inter', stack: "'Inter',system-ui,-apple-system,sans-serif", w: '400;500;600;700;800;900' },
  dmsans: { name: 'DM Sans', stack: "'DM Sans',system-ui,sans-serif", w: '400;500;700' },
  manrope: { name: 'Manrope', stack: "'Manrope',system-ui,sans-serif", w: '400;500;600;700;800' },
  worksans: { name: 'Work Sans', stack: "'Work Sans',system-ui,sans-serif", w: '400;500;600;700' },
  plexsans: { name: 'IBM Plex Sans', stack: "'IBM Plex Sans',system-ui,sans-serif", w: '400;500;600;700' },
  sourcesans: { name: 'Source Sans 3', stack: "'Source Sans 3',system-ui,sans-serif", w: '400;600;700' },
  nunitosans: { name: 'Nunito Sans', stack: "'Nunito Sans',system-ui,sans-serif", w: '400;600;700;800' },
  karla: { name: 'Karla', stack: "'Karla',system-ui,sans-serif", w: '400;500;700' },
  spacegrotesk: { name: 'Space Grotesk', stack: "'Space Grotesk',system-ui,sans-serif", w: '400;500;700' },
  figtree: { name: 'Figtree', stack: "'Figtree',system-ui,sans-serif", w: '400;500;600;700;800' },
  merriweather: { name: 'Merriweather', stack: "'Merriweather',Georgia,serif", w: '400;700;900' },
  lora: { name: 'Lora', stack: "'Lora',Georgia,serif", w: '400;500;600;700' },
  sourceserif: { name: 'Source Serif 4', stack: "'Source Serif 4',Georgia,serif", w: '400;600;700' },
  playfair: { name: 'Playfair Display', stack: "'Playfair Display',Georgia,serif", w: '400;600;700;800;900' },
  baskerville: { name: 'Libre Baskerville', stack: "'Libre Baskerville',Georgia,serif", w: '400;700' },
};
const _sdFont = (key) => (typeof key === 'string' && Object.prototype.hasOwnProperty.call(SD_FONTS, key) ? SD_FONTS[key] : null);

/* One stylesheet request for whatever the page actually uses. Inter is always
   included because it is the fallback every template was designed against —
   dropping it when a custom heading font is chosen would restyle the body too. */
function _sdFontLink(headingKey, bodyKey) {
  const wanted = new Map([['inter', SD_FONTS.inter]]);
  for (const k of [headingKey, bodyKey]) {
    const f = _sdFont(k);
    if (f) wanted.set(k, f);
  }
  const fams = [...wanted.values()]
    .map((f) => `family=${encodeURIComponent(f.name).replace(/%20/g, '+')}:wght@${f.w}`)
    .join('&');
  return `https://fonts.googleapis.com/css2?${fams}&display=swap`;
}

/* ── Scroll animations ────────────────────────────────────────────────────
   Per section, off by default, and deliberately a short whitelist. This is a
   resume site: an entrance that draws attention to itself works against the
   person whose name is on it. Anything not listed here means no animation. */
/* Types whose height is the box the user drew, not whatever their content
   asks for. Text is deliberately absent: clipping somebody's summary because
   the box was drawn too short would be worse than the box growing. */
const _SD_FIT_TYPES = { image: 1, imagebox: 1, video: 1, map: 1, box: 1 };
/* The width a published page is LAID OUT at on a phone before being scaled down
   to the screen. Not 1200 (the design canvas) and not the phone's own width:
   at 1200 the type comes out a third of its size, and at the phone's width the
   boxes are phone-sized while the type is not, so it spills out of them. This
   is the same number the editor's phone-frame preview lays out at, so what is
   published is what was previewed. */
const SD_MOBILE_W = 1000;

/* What to put in `<source type>`. Whitelisted, because it is an attribute on a
   public page — and only ever a hint, so an unknown value is dropped rather
   than guessed at. The document stores it at upload time; a URL extension is
   the fallback for anything saved before it did. */
const _SD_MEDIA_TYPES = ['video/mp4', 'video/webm', 'video/quicktime', 'audio/mpeg', 'audio/mp4', 'audio/aac', 'audio/webm', 'audio/ogg'];
const _SD_EXT_TYPE = { mp4: 'video/mp4', webm: 'video/webm', mov: 'video/quicktime', mp3: 'audio/mpeg', m4a: 'audio/mp4', aac: 'audio/aac', weba: 'audio/webm', ogg: 'audio/ogg' };
/* A `/media/12` URL carries no extension, so for anything uploaded before the
   document started storing the type there is nothing to read it from — except
   the row that owns the file. One indexed lookup, memoised, so an existing
   site's videos get a correct `type` too rather than only new ones. */
const _sdMimeCache = new Map();
function _sdMimeForMediaUrl(url) {
  const m = /^\/media\/(\d+)(?:\.[a-z0-9]+)?$/i.exec(String(url || ''));
  if (!m) return '';
  const id = Number(m[1]);
  if (_sdMimeCache.has(id)) return _sdMimeCache.get(id);
  let mime = '';
  try {
    const row = db.prepare('SELECT mime FROM site_media WHERE id = ?').get(id);
    mime = row && row.mime ? String(row.mime).split(';')[0].trim().toLowerCase() : '';
  } catch (_) { mime = ''; }
  _sdMimeCache.set(id, mime);
  return mime;
}

function _sdMediaType(stored, url) {
  const t = String(stored || '').split(';')[0].trim().toLowerCase();
  if (_SD_MEDIA_TYPES.includes(t)) return t;
  const ext = String(url || '').toLowerCase().split('?')[0].split('.').pop();
  if (_SD_EXT_TYPE[ext]) return _SD_EXT_TYPE[ext];
  const looked = _sdMimeForMediaUrl(url);
  return _SD_MEDIA_TYPES.includes(looked) ? looked : '';
}

/* ── A background on ANY element ──────────────────────────────────────────
   Not just the `box` type. "Every part of every template should be editable"
   means the card behind a testimonial, the strip behind a heading and the
   frame around a photo all take a colour, a gradient or an image — and each
   one is a whitelist, because this string lands in a `style` attribute on a
   public page. `radius` and `pad` come along because a background with square
   corners jammed against its text is not a background anyone wants. */
function _sdElBg(el) {
  const p = (el && el.props) || {};
  let out = '';
  const col = _sdColor(p.elbg, '');
  if (col) out += `background-color:${col};`;
  if (typeof p.elbgGrad === 'string' && /^linear-gradient\([#0-9a-zA-Z,.%\s-]{6,160}\)$/.test(p.elbgGrad)) {
    out += `background-image:${p.elbgGrad};`;
  } else {
    const img = _safeUrl(p.elbgImage);
    if (img) out += `background-image:url('${_escHtml(img)}');background-size:cover;background-position:center;`;
  }
  if (out) {
    const r = _sdPx(p.elbgRadius, 0);
    if (r) out += `border-radius:${Math.min(400, r)}px;`;
    const pad = _sdPx(p.elbgPad, 0);
    if (pad) out += `padding:${Math.min(120, pad)}px;`;
    out += 'background-repeat:no-repeat;';
  }
  return out;
}

const SD_ANIMS = { fade: 1, up: 1, scale: 1 };
const _sdAnim = (a) => (typeof a === 'string' && SD_ANIMS[a] ? a : '');

/* ── Social networks ──────────────────────────────────────────────────────
   Inline SVG rather than an icon font or a sprite sheet: a published site is
   one self-contained document, and a webfont for eight glyphs is a request
   that can fail and leave empty squares where someone's LinkedIn should be.

   `base` lets the user type a handle instead of a URL — "marvin" is what people
   know their LinkedIn as, and asking for the full https:// form is a small tax
   paid by everyone to save writing this table once. */
const _svg = (d) => `<svg viewBox="0 0 24 24" width="18" height="18" fill="currentColor" aria-hidden="true"><path d="${d}"/></svg>`;
const SD_SOCIALS = {
  linkedin: { name: 'LinkedIn', base: 'https://www.linkedin.com/in/', svg: _svg('M4.98 3.5C4.98 4.88 3.87 6 2.5 6S0 4.88 0 3.5 1.12 1 2.5 1s2.48 1.12 2.48 2.5zM.24 8h4.52v14H.24V8zM8.34 8h4.33v1.92h.06c.6-1.14 2.07-2.34 4.26-2.34 4.56 0 5.4 3 5.4 6.9V22h-4.5v-6.62c0-1.58-.03-3.61-2.2-3.61-2.2 0-2.54 1.72-2.54 3.5V22h-4.5V8z') },
  github: { name: 'GitHub', base: 'https://github.com/', svg: _svg('M12 .5C5.73.5.9 5.34.9 11.6c0 4.9 3.18 9.06 7.6 10.53.56.1.76-.24.76-.53v-2.1c-3.09.67-3.74-1.32-3.74-1.32-.5-1.29-1.24-1.63-1.24-1.63-1.01-.7.08-.68.08-.68 1.12.08 1.7 1.15 1.7 1.15 1 1.71 2.62 1.22 3.26.93.1-.72.39-1.22.7-1.5-2.47-.28-5.06-1.24-5.06-5.5 0-1.22.43-2.21 1.14-2.99-.11-.28-.5-1.41.11-2.94 0 0 .94-.3 3.07 1.14a10.6 10.6 0 0 1 5.6 0c2.12-1.44 3.06-1.14 3.06-1.14.61 1.53.23 2.66.11 2.94.71.78 1.14 1.77 1.14 2.99 0 4.27-2.6 5.21-5.08 5.49.4.35.76 1.03.76 2.08v3.08c0 .3.2.64.77.53a11.11 11.11 0 0 0 7.59-10.53C23.1 5.34 18.27.5 12 .5z') },
  x: { name: 'X', base: 'https://x.com/', svg: _svg('M18.24 2h3.31l-7.23 8.26L22.8 22h-6.66l-5.21-6.82L4.97 22H1.66l7.73-8.84L1.2 2h6.83l4.71 6.23L18.24 2zm-1.16 18h1.83L7.01 3.88H5.05L17.08 20z') },
  instagram: { name: 'Instagram', base: 'https://instagram.com/', svg: _svg('M12 2.16c3.2 0 3.58.01 4.85.07 1.17.05 1.8.25 2.23.41.56.22.96.48 1.38.9.42.42.68.82.9 1.38.16.42.36 1.06.41 2.23.06 1.27.07 1.65.07 4.85s-.01 3.58-.07 4.85c-.05 1.17-.25 1.8-.41 2.23-.22.56-.48.96-.9 1.38-.42.42-.82.68-1.38.9-.42.16-1.06.36-2.23.41-1.27.06-1.65.07-4.85.07s-3.58-.01-4.85-.07c-1.17-.05-1.8-.25-2.23-.41-.56-.22-.96-.48-1.38-.9-.42-.42-.68-.82-.9-1.38-.16-.42-.36-1.06-.41-2.23C2.17 15.58 2.16 15.2 2.16 12s.01-3.58.07-4.85c.05-1.17.25-1.8.41-2.23.22-.56.48-.96.9-1.38.42-.42.82-.68 1.38-.9.42-.16 1.06-.36 2.23-.41C8.42 2.17 8.8 2.16 12 2.16zM12 0C8.74 0 8.33.01 7.05.07 5.78.13 4.9.33 4.14.63c-.79.3-1.46.72-2.12 1.39C1.35 2.68.93 3.35.63 4.14.33 4.9.13 5.78.07 7.05.01 8.33 0 8.74 0 12s.01 3.67.07 4.95c.06 1.27.26 2.15.56 2.91.3.79.72 1.46 1.39 2.12.66.67 1.33 1.09 2.12 1.39.76.3 1.64.5 2.91.56C8.33 23.99 8.74 24 12 24s3.67-.01 4.95-.07c1.27-.06 2.15-.26 2.91-.56.79-.3 1.46-.72 2.12-1.39.67-.66 1.09-1.33 1.39-2.12.3-.76.5-1.64.56-2.91.06-1.28.07-1.69.07-4.95s-.01-3.67-.07-4.95c-.06-1.27-.26-2.15-.56-2.91-.3-.79-.72-1.46-1.39-2.12-.66-.67-1.33-1.09-2.12-1.39-.76-.3-1.64-.5-2.91-.56C15.67.01 15.26 0 12 0zm0 5.84a6.16 6.16 0 1 0 0 12.32 6.16 6.16 0 0 0 0-12.32zm0 10.16a4 4 0 1 1 0-8 4 4 0 0 1 0 8zm7.85-10.4a1.44 1.44 0 1 1-2.88 0 1.44 1.44 0 0 1 2.88 0z') },
  facebook: { name: 'Facebook', base: 'https://facebook.com/', svg: _svg('M24 12.07C24 5.4 18.63 0 12 0S0 5.4 0 12.07C0 18.1 4.39 23.1 10.13 24v-8.44H7.08v-3.49h3.05V9.41c0-3.02 1.79-4.69 4.53-4.69 1.31 0 2.68.24 2.68.24v2.96H15.83c-1.49 0-1.96.93-1.96 1.89v2.26h3.33l-.53 3.49h-2.8V24C19.61 23.1 24 18.1 24 12.07z') },
  youtube: { name: 'YouTube', base: 'https://youtube.com/@', svg: _svg('M23.5 6.19a3.02 3.02 0 0 0-2.12-2.14C19.5 3.55 12 3.55 12 3.55s-7.5 0-9.38.5A3.02 3.02 0 0 0 .5 6.19C0 8.08 0 12 0 12s0 3.92.5 5.81a3.02 3.02 0 0 0 2.12 2.14c1.88.5 9.38.5 9.38.5s7.5 0 9.38-.5a3.02 3.02 0 0 0 2.12-2.14C24 15.92 24 12 24 12s0-3.92-.5-5.81zM9.55 15.57V8.43L15.82 12l-6.27 3.57z') },
  dribbble: { name: 'Dribbble', base: 'https://dribbble.com/', svg: _svg('M12 0C5.37 0 0 5.37 0 12s5.37 12 12 12 12-5.37 12-12S18.63 0 12 0zm7.93 5.53a10.15 10.15 0 0 1 2.3 6.36c-.34-.07-3.72-.76-7.13-.33-.08-.18-.15-.36-.23-.55-.21-.5-.45-1-.69-1.48 3.77-1.54 5.49-3.75 5.75-4zM12 1.79c2.6 0 4.98.98 6.79 2.58-.22.31-1.77 2.38-5.4 3.75A52.6 52.6 0 0 0 9.6 2.19 10.2 10.2 0 0 1 12 1.79zM7.63 2.89a62.3 62.3 0 0 1 3.76 5.87c-4.75 1.27-8.95 1.24-9.4 1.24a10.26 10.26 0 0 1 5.64-7.11zM1.77 12.02v-.31c.44.01 5.37.07 10.45-1.45.29.57.57 1.15.82 1.73l-.4.12c-5.25 1.7-8.04 6.33-8.27 6.72a10.17 10.17 0 0 1-2.6-6.81zM12 22.23c-2.35 0-4.51-.8-6.23-2.15.18-.37 2.23-4.32 7.97-6.32l.07-.02a42.6 42.6 0 0 1 2.19 7.78A10.15 10.15 0 0 1 12 22.23zm5.73-1.66a44.6 44.6 0 0 0-2-7.63c3.21-.51 6.02.33 6.37.44a10.2 10.2 0 0 1-4.37 7.19z') },
  behance: { name: 'Behance', base: 'https://behance.net/', svg: _svg('M7.44 4.5c.74 0 1.42.07 2.03.2.61.13 1.13.34 1.56.63.43.29.77.68 1.01 1.16.24.48.36 1.08.36 1.79 0 .77-.18 1.41-.53 1.92-.35.51-.87.93-1.55 1.26.94.27 1.64.74 2.1 1.42.46.68.69 1.5.69 2.46 0 .78-.15 1.45-.45 2.02-.3.57-.71 1.03-1.22 1.39-.51.36-1.1.63-1.76.8-.66.17-1.34.25-2.04.25H0V4.5h7.44zM7 10.63c.61 0 1.11-.15 1.5-.44.39-.29.58-.76.58-1.42 0-.36-.06-.66-.2-.9a1.35 1.35 0 0 0-.53-.53 2.2 2.2 0 0 0-.76-.26A5.4 5.4 0 0 0 6.7 7H3.3v3.63H7zm.2 6.44c.34 0 .66-.03.97-.1.31-.07.58-.18.81-.34.23-.16.42-.37.55-.65.14-.28.2-.63.2-1.05 0-.83-.23-1.42-.7-1.77-.47-.35-1.09-.53-1.86-.53H3.3v4.44h3.9zM17.1 17.1c.45.44 1.1.66 1.94.66.6 0 1.12-.15 1.55-.46.43-.3.7-.63.8-.97h2.36c-.38 1.17-.96 2.01-1.74 2.51-.78.5-1.72.76-2.83.76-.77 0-1.47-.13-2.09-.38a4.4 4.4 0 0 1-1.58-1.07 4.8 4.8 0 0 1-1-1.66 6.2 6.2 0 0 1-.35-2.12c0-.75.12-1.45.36-2.09a4.9 4.9 0 0 1 1.03-1.67 4.8 4.8 0 0 1 1.59-1.11c.62-.27 1.3-.4 2.05-.4.83 0 1.56.16 2.18.48.62.32 1.13.75 1.53 1.29.4.54.68 1.16.86 1.85.17.7.23 1.42.18 2.18h-7.11c0 .86.28 1.57.73 2.02zm3.4-5.5c-.36-.39-.94-.6-1.68-.6-.49 0-.89.08-1.21.25a2.4 2.4 0 0 0-.77.6c-.19.24-.32.5-.4.76-.07.27-.11.5-.13.71h4.4c-.13-.7-.36-1.24-.72-1.63zM15.2 5.9h5.5v1.34h-5.5V5.9z') },
  medium: { name: 'Medium', base: 'https://medium.com/@', svg: _svg('M13.54 12a6.8 6.8 0 0 1-6.77 6.82A6.8 6.8 0 0 1 0 12a6.8 6.8 0 0 1 6.77-6.82A6.8 6.8 0 0 1 13.54 12zm7.42 0c0 3.54-1.51 6.42-3.38 6.42-1.87 0-3.39-2.88-3.39-6.42s1.52-6.42 3.39-6.42 3.38 2.88 3.38 6.42zM24 12c0 3.17-.53 5.75-1.19 5.75-.66 0-1.19-2.58-1.19-5.75s.53-5.75 1.19-5.75C23.47 6.25 24 8.83 24 12z') },
  website: { name: 'Website', base: 'https://', svg: _svg('M12 0C5.37 0 0 5.37 0 12s5.37 12 12 12 12-5.37 12-12S18.63 0 12 0zm7.94 7h-3.2a15.6 15.6 0 0 0-1.4-3.63A10.03 10.03 0 0 1 19.94 7zM12 2.06c.83 1.2 1.48 2.53 1.91 3.94h-3.82A13.6 13.6 0 0 1 12 2.06zM2.26 14a9.9 9.9 0 0 1 0-4h3.66a20.6 20.6 0 0 0 0 4H2.26zm.82 2h3.2c.35 1.28.82 2.5 1.4 3.63A10.03 10.03 0 0 1 3.08 16zm3.2-9h-3.2a10.03 10.03 0 0 1 4.6-3.63A15.6 15.6 0 0 0 6.28 7zM12 21.94c-.83-1.2-1.48-2.53-1.91-3.94h3.82A13.6 13.6 0 0 1 12 21.94zM14.34 16H9.66a18.4 18.4 0 0 1 0-4h4.68a18.4 18.4 0 0 1 0 4zm.26 5.63c.58-1.13 1.05-2.35 1.4-3.63h3.2a10.03 10.03 0 0 1-4.6 3.63zM18.08 14a20.6 20.6 0 0 0 0-4h3.66a9.9 9.9 0 0 1 0 4h-3.66z') },
  email: { name: 'Email', base: 'mailto:', svg: _svg('M20 4H4a2 2 0 0 0-2 2v12a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2V6a2 2 0 0 0-2-2zm0 4.24-8 4.99-8-4.99V6l8 5 8-5v2.24z') },
};
const _sdSocial = (k) => (typeof k === 'string' && Object.prototype.hasOwnProperty.call(SD_SOCIALS, k) ? SD_SOCIALS[k] : null);

/* A handle OR a full URL. Someone who types "marvinperson" into the LinkedIn
   row means their LinkedIn; someone who pastes the whole address means that.
   Both are the same intention and neither should be rejected. */
function _sdSocialUrl(it) {
  if (!it) return '';
  const raw = String(it.url == null ? '' : it.url).trim();
  if (!raw) return '';
  /* ANYTHING that already carries a scheme is passed straight through to
     _safeLinkUrl, which is the security boundary and rejects javascript: and
     friends. Only a BARE HANDLE gets a base prepended — an earlier version
     tested for http/mailto specifically and quietly turned a working tel: link
     into "https://tel:+1555…", which is the kind of breakage that looks like
     the user typed it wrong. */
  if (/^[a-z][a-z0-9+.-]*:/i.test(raw)) return raw;
  const net = _sdSocial(it.network);
  if (!net) return 'https://' + raw.replace(/^\/+/, '');
  if (net.base === 'mailto:') return raw.includes('@') ? 'mailto:' + raw : '';
  return net.base + raw.replace(/^[@/]+/, '');
}

/* ── Form fields ──────────────────────────────────────────────────────────
   Configurable, but ALWAYS carrying exactly one email field. The server needs a
   valid visitor address to store a lead and to let the owner reply, so a form
   without one is a form that collects nothing — and a user removing the email
   row would be quietly breaking their own contact page. Anything else they can
   add or take away. */
const SD_FIELD_TYPES = { text: 1, email: 1, textarea: 1, tel: 1 };
function _sdFormFields(p, isPdf, SI) {
  const raw = Array.isArray(p && p.fields) ? p.fields : null;
  let out = [];
  if (raw) {
    out = raw.slice(0, 8).map((f, i) => {
      const type = f && SD_FIELD_TYPES[f.type] ? f.type : 'text';
      const key = String((f && f.key) || ('field' + (i + 1))).replace(/[^a-zA-Z0-9_]/g, '').slice(0, 30) || ('field' + (i + 1));
      return { key, type, label: String((f && f.label) || key).slice(0, 60), required: !!(f && f.required) };
    }).filter((f, i, a) => a.findIndex((x) => x.key === f.key) === i);
  }
  if (!out.length) {
    out = [{ key: 'name', type: 'text', label: SI.c_name, required: false },
      { key: 'email', type: 'email', label: SI.c_email, required: true }];
    if (!isPdf) out.push({ key: 'message', type: 'textarea', label: SI.c_msg, required: false });
    return out;
  }
  const em = out.find((f) => f.type === 'email');
  if (em) em.required = true;
  else out.splice(Math.min(1, out.length), 0, { key: 'email', type: 'email', label: SI.c_email, required: true });
  return out;
}

// A section background: solid colour, gradient, or an image from the media library.
function _sdSectionBg(bg) {
  if (!bg || typeof bg !== 'object') return '';
  if (bg.type === 'image') {
    const u = _safeUrl(bg.value);
    if (!u) return '';
    // A full-bleed photo with text on it is unreadable without a scrim, and
    // "make sure the text is still legible" is not something to leave to
    // whoever picks the photo. The overlay is part of the background.
    const ov = Number(bg.overlay);
    const a = Number.isFinite(ov) ? Math.max(0, Math.min(0.9, ov)) : 0;
    const scrim = a > 0
      ? `linear-gradient(rgba(8,12,22,${a.toFixed(2)}),rgba(8,12,22,${a.toFixed(2)})),`
      : '';
    return `background-image:${scrim}url('${_escHtml(u)}');background-size:cover;background-position:center;`;
  }
  if (bg.type === 'gradient' && typeof bg.value === 'string') {
    // A conservative whitelist rather than a shape match, so a stack of
    // comma-separated gradients (used by the lighten/darken wash) is allowed
    // while arbitrary CSS still is not.
    const g = bg.value.slice(0, 400);
    const safe = /^(linear|radial)-gradient\(/.test(g)
      && /^[a-zA-Z0-9\s,.%#()-]+$/.test(g)
      && !/url\(|expression|javascript:|@import/i.test(g);
    return safe ? `background-image:${g};` : '';
  }
  if (bg.type === 'color') { const c = _sdColor(bg.value, ''); return c ? `background-color:${c};` : ''; }
  return '';
}

// Photo heroes get a text shadow on top of the scrim: the scrim handles the
// average case, the shadow handles a bright patch landing behind a word.
function _sdSectionClass(bg) {
  return (bg && bg.type === 'image' && _safeUrl(bg.value)) ? ' sd-sec--photo' : '';
}

// ── Per-element mobile overrides (V6) ───────────────────────────────────────
// `el.mobile = { order, w, align, hidden }` lets an author adjust how a single
// element behaves on phones without disturbing the desktop layout. Everything is
// optional; absent values keep the automatic behaviour (reading-order stacking,
// full width). `el.mhide` remains supported as the original hide flag.
function _sdMobileOrder(el) {
  const m = el && el.mobile;
  const n = m && Number(m.order);
  return Number.isFinite(n) ? n : 0;   // 0 = keep automatic reading order
}
function _sdMobileHidden(el) {
  return !!(el && (el.mhide || (el.mobile && el.mobile.hidden)));
}
// Returns a class suffix (possibly '') and pushes any generated rules.
function _sdMobileClass(el, rules) {
  const m = el && el.mobile;
  if (!m || typeof m !== 'object') return '';
  const decls = [];
  const w = Number(m.w);
  if (Number.isFinite(w) && w > 0 && w <= 100) decls.push(`width:${Math.round(w)}%!important`);
  if (['left', 'center', 'right'].includes(m.align)) {
    decls.push(`margin-left:${m.align === 'left' ? '0' : m.align === 'right' ? 'auto' : 'auto'}!important`);
    decls.push(`margin-right:${m.align === 'right' ? '0' : 'auto'}!important`);
    decls.push(`text-align:${m.align}!important`);
  }
  if (!decls.length) return '';
  // Derived from the element id, NOT a counter: the same document must render
  // byte-identical every time, or preview would drift from the published page.
  const cls = 'sd-m-' + String(el.id || '').replace(/[^A-Za-z0-9_-]/g, '').slice(0, 24)
    || 'sd-m-' + Math.abs(JSON.stringify(m).split('').reduce((a, c) => ((a << 5) - a + c.charCodeAt(0)) | 0, 0)).toString(36);
  rules.push(`.${cls}{${decls.join(';')};}`);
  return ' ' + cls;
}

// Templates ship without binary assets: an image slot with no `src` renders a
// self-contained gradient placeholder (optionally captioned) that the user
// replaces with a real upload from the media library. `ph` is a two-colour spec
// like { from:'6366F1', to:'8B5CF6', label:'Your photo' } — colours are validated.
// `minH` is the element's drawn height. Elements are positioned with min-height
// (so text can grow) and no fixed height, which means the stylesheet's
// `height:100%` on the placeholder resolves against an auto-height parent and
// collapses to the 120px floor — every image slot rendered as a short band no
// matter how large you drew it. Passing the height through fixes that.
/**
 * The stand-in for a photo that has not been added yet.
 *
 * A visitor never sees one. An empty photo slot used to render as a large
 * gradient blob reading "YOUR HEADSHOT" — on a phone the hero's 310px circle
 * stretched to the full width and became an ellipse covering most of the first
 * screen, which is the first thing anyone opening the site would see. A page
 * that announces its own missing pieces is worse than a page without them.
 *
 * Nobody sees one, the owner included. It was briefly kept while editing so the
 * slot stayed clickable — then the read-only view was deleted and editing
 * became permanent, which turned that exception into "always", putting the
 * ellipse back on every visit and undoing the thing it was meant to fix.
 * Adding a photo lives in 💬 Not sure? → "I want to change my photo", which
 * searches the document rather than the rendered page and needs nothing drawn.
 */
/* A gradient stands in for a picture. Two different situations use one shape:

   - An EMPTY PHOTO SLOT the owner has not filled. Invisible to everyone,
     including the owner — that was tried the other way and reverted.
   - A DELIBERATELY COLOURED BOX, which is what a template's showcase row is
     made of. `phShow` marks those. Splitting a gallery into editable boxes
     turns three coloured cells into three elements, and without this they
     would all vanish the moment they became editable. */
function _sdPlaceholder(p, radius, minH, editable) {
  const ph = p && p.ph;
  if (!ph) return '';
  return '';
  const from = _sdColor(ph.from, '#6366F1');
  const to = _sdColor(ph.to, '#8B5CF6');
  const round = ph.shape === 'circle' ? '50%' : `${_sdPx(radius, 12)}px`;
  // Capped: a slot drawn at its full designed height became a full-width
  // ellipse on a phone. It only has to be big enough to tap.
  const h = Math.min(_sdPx(minH, 0), 200);
  // Styled inline rather than through a class: a rule in the shared stylesheet
  // would ship to every published page for something a visitor can never see.
  return `<div class="sd-ph sd-ph--slot" style="opacity:.55;background:linear-gradient(135deg,${from},${to});border-radius:${round};${h > 0 ? `min-height:${h}px;max-height:${h}px;` : ''}">${ph.label ? `<span>${_sdText(ph.label, 60)}</span>` : ''}</div>`;
}

// One element → HTML. `ctx` carries row/theme/lang/pages for elements that need
// site-level data (resume, nav, forms).
function _sdElement(el, ctx) {
  const p = (el && el.props) || {};
  const T = ctx.theme;
  const align = ['left', 'center', 'right'].includes(p.align) ? p.align : 'left';
  const color = _sdColor(p.color, '');
  /* Typography is a WHITELIST with clamps, never an interpolated string. These
     values reach a `style` attribute on a public page, so "700" is a weight and
     anything else is nothing at all — there is no case where echoing whatever
     was stored would be the right behaviour. */
  const weight = ['300', '400', '500', '600', '700', '800', '900'].includes(String(p.weight)) ? String(p.weight) : '';
  const lh = Number(p.lh) >= 0.8 && Number(p.lh) <= 3 ? Number(p.lh).toFixed(2) : '';
  const ls = Number(p.ls) >= -5 && Number(p.ls) <= 20 ? Number(p.ls) : null;
  const styleText = `text-align:${align};${color ? `color:${color};` : ''}`
    + `${weight ? `font-weight:${weight};` : ''}${lh ? `line-height:${lh};` : ''}`
    + `${ls !== null && ls !== 0 ? `letter-spacing:${ls}px;` : ''}${p.italic ? 'font-style:italic;' : ''}`;
  // The height the element was drawn at. Media slots honour it; text elements
  // ignore it and grow with their content.
  const drawnH = _sdPx(el && el.h, 0);
  switch (el.type) {
    case 'heading':
      return `<h1 class="sd-h1" style="${styleText}${p.size ? `font-size:${_sdPx(p.size, 48)}px;` : ''}">${_sdText(p.text, 300)}</h1>`;
    case 'subheading':
      return `<h2 class="sd-h2" style="${styleText}${p.size ? `font-size:${_sdPx(p.size, 24)}px;` : ''}">${_sdText(p.text, 300)}</h2>`;
    case 'paragraph':
      // Body text honours an explicit size too. It always could have — the
      // property was simply never read here, so the control for it was pointless.
      return `<div class="sd-p" style="${styleText}${p.size ? `font-size:${_sdPx(p.size, 16)}px;` : ''}">${_sdText(p.text, 4000).replace(/\n/g, '<br/>')}</div>`;
    case 'image': {
      const u = _safeUrl(p.src);
      if (!u) return _sdPlaceholder(p, _sdPx(p.radius, 12), drawnH, ctx.editable);
      return `<img class="sd-img" src="${_escHtml(u)}" alt="${_sdText(p.alt, 200)}" loading="lazy" style="border-radius:${_sdPx(p.radius, 12)}px;object-fit:${p.fit === 'contain' ? 'contain' : 'cover'};${drawnH ? `min-height:${drawnH}px;` : ''}"/>`;
    }
    case 'imagebox': {
      const u = _safeUrl(p.src);
      const shown = !u && p.ph && p.phShow
        ? `<div class="sd-ph sd-ph--cell" style="background:linear-gradient(135deg,${_sdColor(p.ph.from, '#6366F1')},${_sdColor(p.ph.to, '#8B5CF6')});${drawnH ? `min-height:${drawnH}px;` : 'min-height:160px;'}">`
          + `${p.ph.label ? `<span>${_sdText(p.ph.label, 60)}</span>` : ''}</div>`
        : null;
      const inner = u
        ? `<img src="${_escHtml(u)}" alt="${_sdText(p.alt, 200)}" loading="lazy"/>`
        : (shown || _sdPlaceholder(p, 0, drawnH, ctx.editable));
      // No image and nothing to stand in for it — including a placeholder that
      // suppressed itself because this is not the editor — is an empty frame.
      if (!u && (!p.ph || !inner)) return '';
      return `<figure class="sd-ibox" style="border-radius:${_sdPx(p.radius, 14)}px;${drawnH ? `min-height:${drawnH}px;` : ''}">${inner}${p.caption ? `<figcaption>${_sdText(p.caption, 300)}</figcaption>` : ''}</figure>`;
    }
    case 'gallery': {
      const items = Array.isArray(p.items) ? p.items.slice(0, 40) : [];
      const cells = items.map((it) => {
        const u = _safeUrl(it && it.src);
        if (!u && !(it && it.ph)) return '';
        const cap = it.caption || it.title ? `<figcaption>${_sdText(it.title || '', 120)}${it.caption ? `<span>${_sdText(it.caption, 200)}</span>` : ''}</figcaption>` : '';
        const img = u
          ? `<img src="${_escHtml(u)}" alt="${_sdText(it.alt || it.title || '', 200)}" loading="lazy"/>`
          : `<div class="sd-ph sd-ph--cell" style="background:linear-gradient(135deg,${_sdColor(it.ph.from, '#6366F1')},${_sdColor(it.ph.to, '#8B5CF6')});height:${_sdPx(it.ph.h, 220)}px;"></div>`;
        const inner = `<figure class="sd-gcell">${img}${cap}</figure>`;
        const href = _safeLinkUrl(it && it.link);
        return href ? `<a href="${_escHtml(href)}" target="_blank" rel="noopener">${inner}</a>` : inner;
      }).join('');
      if (!cells) return '';
      const layout = ['grid', 'masonry', 'slider'].includes(p.layout) ? p.layout : 'grid';
      const cols = Math.max(1, Math.min(6, _sdPx(p.cols, 3)));
      const gap = Math.max(0, Math.min(48, _sdPx(p.gap, 14)));
      return `<div class="sd-gal sd-gal--${layout}" style="--gcols:${cols};--ggap:${gap}px;">${cells}</div>`;
    }
    case 'video': {
      const lbl = p.label ? `<div class="sd-elabel">${_sdText(p.label, 120)}</div>` : '';
      const u = _safeUrl(p.src);
      // No source yet (e.g. just dropped from the palette): show an empty-state
      // block so the element is visible and selectable instead of rendering
      // nothing. Replaced as soon as a video is chosen in the inspector.
      if (!u) return `${lbl}<div class="sd-ph sd-ph--empty">🎬<span>${_escHtml(ctx.SI.add_video)}</span></div>`;
      const poster = _safeUrl(p.poster);
      /* `playsinline` matters on iOS, where a video without it hijacks the
         screen into the native full-screen player instead of playing in the
         page. `type` saves the browser sniffing the container, and is the
         difference between "cannot play this" and a silent frozen frame on
         the formats it is unsure about. */
      const ty = _sdMediaType(p.srcType, u);
      return `${lbl}<video class="sd-video" controls playsinline preload="metadata"${poster ? ` poster="${_escHtml(poster)}"` : ''}>`
        + `<source src="${_escHtml(u)}"${ty ? ` type="${_escHtml(ty)}"` : ''}/></video>`;
    }
    case 'audio': {
      const lbl = p.label ? `<div class="sd-elabel">${_sdText(p.label, 120)}</div>` : '';
      const u = _safeUrl(p.src);
      if (!u) return `${lbl}<div class="sd-ph sd-ph--empty">🔊<span>${_escHtml(ctx.SI.add_audio)}</span></div>`;
      const aty = _sdMediaType(p.srcType, u);
      return `${lbl}<audio class="sd-audio" controls preload="none"><source src="${_escHtml(u)}"${aty ? ` type="${_escHtml(aty)}"` : ''}/></audio>`;
    }
    case 'button': {
      const href = _sdLink(p, ctx);
      const ghost = p.style === 'ghost';
      // An explicit colour overrides the theme's primary. Filled buttons take it
      // as a background; outline buttons as the border and the text, or an
      // outline button would be invisible against a page of the same colour.
      const bc = _sdColor(p.color, '');
      const st = bc ? (ghost ? `border-color:${bc};color:${bc};` : `background:${bc};border-color:${bc};`) : '';
      return `<a class="sd-btn${ghost ? ' sd-btn--ghost' : ''}" href="${_escHtml(href || '#')}"${st ? ` style="${st}"` : ''}${/^https?:/i.test(href) ? ' target="_blank" rel="noopener"' : ''}>${_sdText(p.text || 'Learn more', 80)}</a>`;
    }
    case 'social': {
      const items = Array.isArray(p.items) ? p.items.slice(0, 12) : [];
      // "A row of icon buttons" or "a single Find me on X link" — the same data
      // either way, so switching between them never loses what was entered.
      const asLink = p.display === 'link';
      const parts = items.map((it) => {
        const u = _safeLinkUrl(_sdSocialUrl(it)); if (!u) return '';
        const net = _sdSocial(it && it.network);
        const label = (it && it.label) || (net ? net.name : (it && it.network) || 'Link');
        if (asLink) {
          return `<a class="sd-soclink" href="${_escHtml(u)}" target="_blank" rel="noopener">`
            + `${net ? net.svg : ''}<span>${_sdText(String(ctx.SI.find_me || 'Find me on {x}').replace('{x}', label), 60)}</span></a>`;
        }
        return `<a class="sd-soc" href="${_escHtml(u)}" target="_blank" rel="noopener" title="${_sdText(label, 40)}" aria-label="${_sdText(label, 40)}">`
          + `${net ? net.svg : _sdText(String(label).slice(0, 2).toUpperCase(), 4)}</a>`;
      }).join('');
      if (parts) return `<div class="${asLink ? 'sd-soclinks' : 'sd-socs'}">${parts}</div>`;
      // Nothing filled in yet. A visitor sees nothing; the owner sees where to
      // put their handles, or dropping this element would look like it failed.
      return ctx.editable
        ? `<div class="sd-ph sd-ph--empty">◎<span>${_escHtml(ctx.SI.add_links || 'Add your links')}</span></div>`
        : '';
    }
    case 'map': {
      // Google's keyless embed. A map on a resume site is "here is roughly where
      // I am" — it does not need an API key, a billing account, or the exact
      // pin-drop accuracy that the keyed Embed API buys.
      const addr = String(p.address == null ? '' : p.address).slice(0, 200).trim();
      if (!addr) {
        return ctx.editable
          ? `<div class="sd-ph sd-ph--empty">🗺<span>${_escHtml(ctx.SI.add_address || 'Add an address')}</span></div>`
          : '';
      }
      const zoom = Math.max(1, Math.min(20, _sdPx(p.zoom, 13)));
      const src = `https://maps.google.com/maps?q=${encodeURIComponent(addr)}&z=${zoom}&output=embed`;
      const lbl = p.label ? `<div class="sd-elabel">${_sdText(p.label, 120)}</div>` : '';
      return `${lbl}<iframe class="sd-map" src="${_escHtml(src)}" loading="lazy" referrerpolicy="no-referrer-when-downgrade"`
        + ` title="${_sdText(p.label || addr, 120)}" allowfullscreen></iframe>`;
    }
    case 'form': {
      const isPdf = p.mode === 'pdf';
      const SI = ctx.SI;
      const fields = _sdFormFields(p, isPdf, SI);
      const inputs = fields.map((f) => {
        const common = `name="${_escHtml(f.key)}" placeholder="${_escHtml(f.label)}"${f.required ? ' required' : ''}`;
        if (f.type === 'textarea') return `<textarea ${common} maxlength="2000"></textarea>`;
        const t = f.type === 'email' ? 'email' : f.type === 'tel' ? 'tel' : 'text';
        return `<input type="${t}" ${common} maxlength="${f.type === 'email' ? 200 : 200}"/>`;
      }).join('\n          ');
      return `<div class="sd-form"><div class="sd-elabel">${_sdText(p.heading || (isPdf ? SI.request_h : SI.contact_h), 120)}</div>
        <form class="sg-lead-form" onsubmit="return _sgLead(event,this)" data-sub="${_escHtml(ctx.sub)}" data-mode="${isPdf ? 'pdf' : 'contact'}">
          ${inputs}
          <button type="submit">${isPdf ? _escHtml(SI.c_send_pdf) : _escHtml(SI.c_send)}</button>
          <div class="sg-lead-msg" style="display:none;"></div>
        </form></div>`;
    }
    case 'divider':
      return `<hr class="sd-divider" style="border-top-width:${_sdPx(p.thickness, 1)}px;${color ? `border-top-color:${color};` : ''}"/>`;
    case 'box':
      // Same collapse as the placeholder: `height:100%` against an auto-height
      // parent is 0, so a card background drawn 250px tall rendered as nothing.
      return `<div class="sd-box" style="${_sdColor(p.bg, '') ? `background:${_sdColor(p.bg, '')};` : ''}border-radius:${_sdPx(p.radius, 14)}px;${drawnH ? `min-height:${drawnH}px;` : ''}"></div>`;
    case 'spacer':
      return '<div class="sd-spacer"></div>';
    case 'nav': {
      const links = (ctx.pages || []).map((pg) => {
        const href = pg.isHome ? ctx.base : `${ctx.base}/${encodeURIComponent(pg.slug)}`;
        const on = pg.slug === ctx.currentSlug;
        return `<a class="sd-navlink${on ? ' is-on' : ''}" href="${_escHtml(href)}">${_sdText(pg.name, 60)}</a>`;
      }).join('');
      return links ? `<nav class="sd-nav">${links}</nav>` : '';
    }
    case 'resume':
      return `<div class="sd-resume">${_renderResumeFragment(ctx.row, T.accent)}</div>`;
    case 'casestudies': {
      const items = Array.isArray(p.items) ? p.items.slice(0, 12) : [];
      const cards = items.map((it) => {
        const title = _sdText((it && it.title) || '', 160); if (!title) return '';
        const chip = it && it.metric ? `<span class="sd-cs-chip">${_sdText(it.metric, 40)}</span>` : '';
        const body = it && (it.detail || it.body) ? `<p>${_sdText(it.detail || it.body, 2000)}</p>` : '';
        return `<details class="sd-cs"><summary><span>${title}</span>${chip}</summary>${body}</details>`;
      }).join('');
      return cards ? `<div class="sd-cswrap">${cards}</div>` : '';
    }
    case 'qr':
      return `<img class="sd-qr" src="${_escHtml(ctx.base)}/qr.svg" alt="QR code" loading="lazy"/>`;
    case 'coverletter': {
      // A cover letter is addressed to one company, so it is offered as a
      // download rather than rendered into the page — every other recruiter
      // reading it inline would be reading a letter written to someone else.
      if (!ctx.hasCoverLetter) return '';
      return `<a class="sd-btn sd-btn--ghost" href="${_escHtml(ctx.base)}/cover-letter" download>${_sdText(p.text || ctx.SI.cover_dl, 80)}</a>`;
    }
    default:
      return '';
  }
}

// Resolve a button/link target: an external URL, another page, or an anchor.
function _sdLink(p, ctx) {
  if (p.page) { const pg = (ctx.pages || []).find((x) => x.slug === p.page); if (pg) return pg.isHome ? ctx.base : `${ctx.base}/${encodeURIComponent(pg.slug)}`; }
  if (p.anchor) return '#' + String(p.anchor).replace(/[^a-zA-Z0-9_-]/g, '').slice(0, 60);
  return _safeLinkUrl(p.href) || '';
}

function _renderSiteDoc(row, origin, opts = {}, doc = {}) {
  const pages = (Array.isArray(doc.pages) ? doc.pages : []).filter((p) => p && typeof p === 'object');
  const wanted = String(opts.page || '').toLowerCase();
  const page = (wanted && pages.find((p) => String(p.slug || '').toLowerCase() === wanted))
    || pages.find((p) => p.isHome) || pages[0];
  if (!page) return _shareResumeHtml(row, origin, opts); // empty doc → never render a blank page

  const th = doc.theme || {};
  const theme = {
    primary: _sdColor(th.primary, '#6366F1'),
    accent: _sdColor(th.accent, '#8B5CF6'),
    ink: _sdColor(th.ink, '#0f172a'),
    paper: _sdColor(th.paper, '#ffffff'),
    muted: _sdColor(th.muted, '#64748b'),
    // Unknown keys fall back to Inter, which is what every template was drawn
    // against — a typo in the document must not leave the page unstyled.
    fontHeading: (_sdFont(th.fontHeading) || SD_FONTS.inter).stack,
    fontBody: (_sdFont(th.fontBody) || SD_FONTS.inter).stack,
  };
  const lang = doc.lang === 'zh' ? 'zh' : 'en';
  const SI = _SITE_I18N[lang];
  const sub = row.subdomain || '';
  const base = opts.baseUrl || `${origin}/site/${sub}`;
  let _assets = null;
  try { _assets = doc && doc.assets ? doc.assets : null; } catch (_) { _assets = null; }
  const hasCoverLetter = !!(_assets && typeof _assets.coverLetterText === 'string' && _assets.coverLetterText.trim().length > 20);
  // `editable` belongs on ctx because element renderers need it: an empty photo
  // slot is drawn for the owner and omitted for a visitor.
  const ctx = { row, theme, SI, sub, pages, currentSlug: page.slug, base, lang, hasCoverLetter, editable: !!opts.editable };

  // Per-element mobile overrides (V6) are emitted as a small stylesheet inside
  // the mobile media query, keyed on a per-element class. Collected while
  // building the sections.
  const mobileRules = [];

  // Editable mode adds hooks for the inline editor and nothing else. The
  // published page and the ordinary preview never carry them, so what visitors
  // are served is byte-identical either way.
  const editable = !!opts.editable;
  const sections = (Array.isArray(page.sections) ? page.sections : []).map((sec, secIdx) => {
    const h = _sdPx(sec && sec.h, 400);
    // DOM order == mobile stacking order. Default is reading order (y, then x);
    // an explicit `mobile.order` overrides it so the author can restack a
    // section for phones without touching the desktop layout.
    const els = (Array.isArray(sec && sec.els) ? sec.els : [])
      .filter((e) => e && typeof e === 'object' && e.type)
      .slice()
      .sort((a, b) => {
        const ao = _sdMobileOrder(a), bo = _sdMobileOrder(b);
        if (ao !== bo) return ao - bo;
        return (_sdPx(a.y) - _sdPx(b.y)) || (_sdPx(a.x) - _sdPx(b.x));
      });
    const inner = els.map((el) => {
      const html = _sdElement(el, ctx);
      if (!html) return '';
      const cls = _sdMobileClass(el, mobileRules);
      /* TEXT GROWS, MEDIA IS CONTAINED. Text elements take `min-height` so a
         long paragraph is never clipped; a photo, a video or a map takes a real
         `height`, because the box the user drew IS the size they want it and
         "it decides its own height from the file" is how a video ended up
         hanging outside its own element with no way to pull it back. */
      const fit = _SD_FIT_TYPES[el.type];
      const box = fit
        ? `height:${_sdPx(el.h, 0)}px;`
        : `min-height:${_sdPx(el.h, 0)}px;`;
      const st = `left:${_sdPct(el.x)};top:${_sdPx(el.y)}px;width:${_sdPct(el.w)};${box}${el.z ? `z-index:${_sdPx(el.z)};` : ''}${_sdElBg(el)}`;
      const hooks = editable
        ? ` data-el="${_escHtml(String(el.id || ''))}" data-type="${_escHtml(String(el.type || ''))}"${el.props && el.props.field ? ` data-field="${_escHtml(String(el.props.field))}"` : ''}${el.props && el.props.detached ? ' data-detached="1"' : ''}`
        : '';
      return `<div class="sd-el${fit ? ' sd-el--fit' : ''}${_sdMobileHidden(el) ? ' sd-el--mhide' : ''}${cls}"${hooks} style="${st}">${html}</div>`;
    }).join('');
    // The section id doubles as the anchor target: a button with
    // `props.anchor: 'contact'` links to `#contact`, which only scrolls if the
    // section actually carries that id. Without this every in-page CTA in every
    // template was a dead link.
    const anchorId = String((sec && sec.id) || '').replace(/[^a-zA-Z0-9_-]/g, '').slice(0, 60);
    const secHooks = editable ? ` data-sec="${_escHtml(String((sec && sec.id) || ''))}" data-idx="${secIdx}"` : '';
    // Scroll animation, off unless the section asks for it. Never in the
    // editor: an element that fades in every time the canvas re-renders would
    // make the thing being edited flicker under the user's hands.
    const anim = editable ? '' : _sdAnim(sec && sec.anim);
    return `<section class="sd-sec${_sdSectionClass(sec && sec.bg)}${anim ? ' sd-anim' : ''}"${anim ? ` data-anim="${anim}"` : ''}${anchorId ? ` id="${anchorId}"` : ''}${secHooks} style="${_sdSectionBg(sec && sec.bg)}"><div class="sd-inner" style="height:${h}px;">${inner}</div></section>`;
  }).join('');

  const title = _sdText((page.seo && page.seo.title) || row.name || page.name || 'Portfolio', 120);
  const desc = _sdText((page.seo && page.seo.description) || '', 300);
  const indexable = !!opts.indexable;
  const canonical = opts.canonicalUrl || base;
  const footerHtml = opts.footer !== undefined ? opts.footer : '';

  return `<!DOCTYPE html>
<html lang="${lang}">
<head>
  <meta charset="UTF-8"/>
  <meta name="viewport" content="width=device-width,initial-scale=1.0"/>
  <meta name="robots" content="${indexable ? 'index,follow' : 'noindex,nofollow'}"/>
  <title>${title}</title>
  ${desc ? `<meta name="description" content="${desc}"/>` : ''}
  <meta property="og:type" content="profile"/>
  <meta property="og:title" content="${title}"/>
  <meta property="og:url" content="${_escHtml(canonical)}"/>
  <meta property="og:image" content="${origin}/og-image.png"/>
  <link rel="canonical" href="${_escHtml(canonical)}"/>
  <link rel="icon" href="/favicon.svg" type="image/svg+xml"/>
  <link rel="preconnect" href="https://fonts.googleapis.com"/>
  <link href="${_escHtml(_sdFontLink(th.fontHeading, th.fontBody))}" rel="stylesheet"/>
  <style>
    :root{--p:${theme.primary};--a:${theme.accent};--ink:${theme.ink};--paper:${theme.paper};--muted:${theme.muted};
      --fh:${theme.fontHeading};--fb:${theme.fontBody};}
    *{box-sizing:border-box;margin:0;padding:0;}
    html{scroll-behavior:smooth;}
    body{font-family:var(--fb);background:var(--paper);color:var(--ink);line-height:1.6;}
    .sd-sec{position:relative;width:100%;background-repeat:no-repeat;scroll-margin-top:12px;}
    /* Entrance animations. Subtle on purpose: this is a resume site, and an
       entrance that draws attention to itself works against the person whose
       name is on it. The starting state is only applied once the script has
       run — otherwise a visitor with JavaScript off, or a crawler, would be
       served a page whose content is permanently invisible. */
    html.sd-anim-on .sd-anim{opacity:0;transition:opacity .55s ease,transform .55s cubic-bezier(.22,.61,.36,1);}
    html.sd-anim-on .sd-anim[data-anim="up"]{transform:translateY(22px);}
    html.sd-anim-on .sd-anim[data-anim="scale"]{transform:scale(.97);}
    html.sd-anim-on .sd-anim.is-in{opacity:1;transform:none;}
    @media (prefers-reduced-motion: reduce){
      html.sd-anim-on .sd-anim{opacity:1;transform:none;transition:none;}
    }
    .sd-sec--photo .sd-h1,.sd-sec--photo .sd-h2,.sd-sec--photo .sd-p{text-shadow:0 1px 14px rgba(0,0,0,.5);}
    .sd-inner{position:relative;max-width:${SD_CANVAS}px;margin:0 auto;}
    .sd-el{position:absolute;}
    .sd-h1{font-family:var(--fh);font-size:48px;font-weight:900;letter-spacing:-.02em;line-height:1.1;}
    .sd-h2{font-family:var(--fh);font-size:24px;font-weight:700;line-height:1.25;}
    .sd-p{font-size:16px;color:var(--muted);}
    .sd-img{width:100%;height:100%;display:block;}
    .sd-ibox{width:100%;height:100%;overflow:hidden;position:relative;margin:0;}
    .sd-ibox img{width:100%;height:100%;object-fit:cover;display:block;}
    .sd-ibox figcaption{position:absolute;left:0;right:0;bottom:0;padding:10px 12px;font-size:13px;color:#fff;background:linear-gradient(transparent,rgba(0,0,0,.65));}
    .sd-elabel{font-size:12px;font-weight:800;text-transform:uppercase;letter-spacing:2px;color:var(--a);margin-bottom:8px;}
    .sd-ph{width:100%;height:100%;min-height:120px;display:flex;align-items:center;justify-content:center;}
    .sd-ph span{font-size:12px;font-weight:700;letter-spacing:1px;text-transform:uppercase;color:rgba(255,255,255,.85);}
    .sd-ph--cell{min-height:0;}
    .sd-ph--empty{flex-direction:column;gap:6px;font-size:26px;background:rgba(127,127,127,.12);border:2px dashed rgba(127,127,127,.35);color:inherit;border-radius:12px;}
    .sd-ph--empty span{font-size:12px;font-weight:700;letter-spacing:.5px;text-transform:uppercase;opacity:.75;color:inherit;}
    .sd-gal{width:100%;}
    .sd-gal--grid{display:grid;grid-template-columns:repeat(var(--gcols),1fr);gap:var(--ggap);}
    .sd-gal--masonry{columns:var(--gcols);column-gap:var(--ggap);}
    .sd-gal--masonry .sd-gcell{break-inside:avoid;margin-bottom:var(--ggap);}
    .sd-gal--slider{display:flex;gap:var(--ggap);overflow-x:auto;scroll-snap-type:x mandatory;-webkit-overflow-scrolling:touch;}
    .sd-gal--slider .sd-gcell{flex:0 0 auto;width:min(72%,340px);scroll-snap-align:start;}
    .sd-gcell{position:relative;margin:0;overflow:hidden;border-radius:12px;}
    .sd-gcell img{width:100%;height:auto;display:block;transition:transform .35s ease;}
    .sd-gcell:hover img{transform:scale(1.05);}
    .sd-gcell figcaption{position:absolute;left:0;right:0;bottom:0;padding:10px 12px;font-size:13px;font-weight:700;color:#fff;background:linear-gradient(transparent,rgba(0,0,0,.7));}
    .sd-gcell figcaption span{display:block;font-weight:400;opacity:.85;font-size:12px;}
    /* MEDIA IS CONTAINED BY ITS BOX. A width of 100% alone lets a video take
       whatever height its aspect ratio wants -- a portrait clip in a 300x200
       box rendered 533px tall and hung out of the element entirely, with no
       way to pull it back. The wrapper gives media a real height rather than a
       minimum, and object-fit:cover fills that height without distorting the
       picture. Resize the box and the video resizes with it.
       (No backticks: this is inside a template literal.) */
    .sd-video,.sd-audio{width:100%;display:block;border-radius:12px;}
    .sd-video{background:#000;height:100%;object-fit:cover;}
    .sd-audio{height:auto;}
    /* TWO ROWS: the label takes what it needs, the media takes the rest -- a
       label plus a video both asking for 100% overflowed the box and clipped
       the control bar. A GRID, not a flex column: a 1fr track is resolved from
       the element's own definite height BEFORE the media is measured, so it
       never depends on growing a replaced element off an intrinsic height a
       video may not have yet. Row 2 is named so an unlabelled photo is sized
       too. (No backticks: this is inside a template literal.) */
    .sd-el--fit{overflow:hidden;display:grid;grid-template-rows:auto minmax(0,1fr);}
    .sd-el--fit>.sd-elabel{grid-row:1;min-width:0;}
    .sd-el--fit>.sd-video,.sd-el--fit>.sd-img,.sd-el--fit>.sd-ibox,.sd-el--fit>.sd-map,.sd-el--fit>.sd-ph,.sd-el--fit>.sd-box{grid-row:2;min-height:0;height:100%;}
    .sd-el--fit>.sd-ibox>img{height:100%;object-fit:cover;}
    .sd-btn{display:inline-flex;align-items:center;justify-content:center;padding:12px 26px;border-radius:999px;background:linear-gradient(135deg,var(--p),var(--a));color:#fff;font-weight:700;text-decoration:none;font-size:15px;}
    .sd-btn--ghost{background:none;border:2px solid currentColor;color:var(--p);}
    .sd-socs{display:flex;gap:10px;flex-wrap:wrap;}
    .sd-soc{width:38px;height:38px;border-radius:50%;display:flex;align-items:center;justify-content:center;background:var(--p);color:#fff;font-size:12px;font-weight:800;text-decoration:none;transition:transform .15s ease,filter .15s ease;}
    .sd-soc:hover{transform:translateY(-2px);filter:brightness(1.1);}
    .sd-soc svg{display:block;}
    /* The "Find me on X" form: the same links, read as sentences instead of a
       row of badges. Useful when there is one profile that matters. */
    .sd-soclinks{display:flex;flex-direction:column;gap:8px;align-items:flex-start;}
    .sd-soclink{display:inline-flex;align-items:center;gap:9px;padding:9px 16px;border-radius:999px;border:1.5px solid var(--p);color:var(--p);font-weight:700;font-size:14.5px;text-decoration:none;}
    .sd-soclink:hover{background:var(--p);color:#fff;}
    /* A map is a fixed-height frame, not content that grows — the element's own
       drawn height is what the user chose. */
    .sd-map{width:100%;height:100%;min-height:180px;border:0;border-radius:14px;display:block;background:rgba(127,127,127,.1);}
    .sd-divider{border:none;border-top:1px solid rgba(127,127,127,.35);width:100%;}
    /* Boxes are almost always card backgrounds sat behind text. Without a
       shadow a near-white card on a near-white section is invisible. */
    .sd-box{width:100%;height:100%;box-shadow:0 1px 3px rgba(15,23,42,.07),0 8px 24px -12px rgba(15,23,42,.18);}
    .sd-nav{display:flex;gap:22px;flex-wrap:wrap;align-items:center;}
    .sd-navlink{font-size:15px;font-weight:600;color:inherit;text-decoration:none;opacity:.8;}
    .sd-navlink.is-on,.sd-navlink:hover{opacity:1;color:var(--p);}
    .sd-form{background:rgba(255,255,255,.9);border:1px solid rgba(15,23,42,.08);border-radius:14px;padding:18px;}
    .sd-form .sg-lead-form{display:flex;flex-direction:column;gap:8px;}
    .sd-form input,.sd-form textarea{border:1.5px solid #e5e7eb;border-radius:9px;padding:9px 11px;font:inherit;font-size:14px;}
    .sd-form textarea{min-height:80px;}
    .sd-form button{background:var(--p);color:#fff;border:none;border-radius:9px;padding:10px;font-weight:700;cursor:pointer;}
    .sd-form .sg-lead-msg{font-size:13px;color:#059669;}
    .sd-resume{background:#fff;border-radius:16px;box-shadow:0 6px 24px rgba(0,0,0,.08);padding:32px 34px;color:#1f2430;}
    .sd-resume .r-title{font-size:15px;font-weight:800;margin-top:10px;}
    .sd-resume .r-co{font-size:13px;font-weight:700;margin:1px 0 6px;}
    .sd-resume .r-p{font-size:14px;color:#39414f;margin-bottom:8px;}
    .sd-resume .r-bul{list-style:none;margin:2px 0 8px;}
    .sd-resume .r-bul li{font-size:14px;color:#39414f;padding-left:18px;position:relative;margin-bottom:6px;}
    .sd-resume .r-bul li::before{content:'';position:absolute;left:2px;top:9px;width:5px;height:5px;border-radius:50%;background:var(--a);}
    .sd-cswrap{display:flex;flex-direction:column;gap:10px;}
    .sd-cs{background:rgba(255,255,255,.92);border:1px solid rgba(15,23,42,.08);border-radius:12px;padding:14px 16px;color:#1f2430;}
    .sd-cs summary{cursor:pointer;display:flex;align-items:center;gap:10px;list-style:none;font-weight:700;}
    .sd-cs summary::-webkit-details-marker{display:none;}
    .sd-cs summary span:first-child{flex:1;}
    .sd-cs-chip{background:var(--a);color:#fff;font-size:12px;font-weight:800;padding:2px 9px;border-radius:999px;}
    .sd-cs p{font-size:14px;color:#39414f;margin-top:10px;}
    .sd-qr{width:100%;max-width:150px;}
    .sd-foot{text-align:center;font-size:13px;color:var(--muted);padding:24px 16px;}
    /* MOBILE: THE LAYOUT IS KEPT AND SCALED, NOT DISMANTLED. This used to force
       every element to position:static and width:100%, which turned a three-up
       gallery into three slabs and a site into a coloured list. A phone is a
       smaller window, not a different document. Elements are placed in PERCENT
       across and pixels down, so scaling the whole page by one factor is what
       keeps the two axes and the type in proportion with each other. */
    .sd-vp{overflow:hidden;}
    @media(max-width:820px){
      html,body{overflow-x:hidden;}
      .sd-page{width:${SD_MOBILE_W}px;transform-origin:top left;transform:scale(var(--sdk,1));}
      .sd-el--mhide{display:none!important;}
      /* HAIRLINES DO NOT SURVIVE BEING SCALED. A 1px rule at 0.39 is 0.39px --
         it is drawn faintly or not at all depending on the device. Dividing the
         scale back out of the one property that is a hairline keeps it a
         hairline on the glass, which is what it was drawn to be. --sdk is a
         plain number, so a length divided by it is a length. */
      .sd-divider{border-top-width:calc(1px / var(--sdk,1));}
      /* NOTHING HERE OVERRIDES MEDIA HEIGHT. A height:auto!important on
         .sd-ibox/.sd-img used to live here, from before media elements had a
         height of their own -- the only rule in the sheet that made a phone
         take a photo's height from the FILE while a desktop took it from the
         BOX. The grid track governs at every width now. */
      ${mobileRules.join('')}
    }
  </style>
</head>
<body>
  <!-- .sd-vp clips and carries the SCALED height; .sd-page keeps the design's
       own width and is scaled into it. A transform paints smaller and leaves
       the layout box alone, so without the outer box the document would be
       1/k too long and scroll into empty space below the footer. -->
  <div class="sd-vp"><div class="sd-page">
  ${sections}
  ${footerHtml ? `<div class="sd-foot">${footerHtml}</div>` : ''}
  </div></div>
  <script>
    var SITE_I18N=${JSON.stringify(_SITE_I18N)};
    /* THE ONE NUMBER CSS CANNOT WORK OUT FOR ITSELF: scale() takes a unitless
       factor, and dividing 100vw by a number is still a length. Re-measured
       after fonts and media land, because a page measured before its webfont
       arrives is measured at fallback metrics and comes out short. */
    (function(){
      var W=${SD_MOBILE_W}, vp=document.querySelector('.sd-vp'), pg=document.querySelector('.sd-page'), last='';
      if(!vp||!pg) return;
      function fit(){
        if(window.innerWidth>820){
          document.documentElement.style.removeProperty('--sdk');
          if(last!==''){last='';vp.style.height='';}
          return;
        }
        var k=window.innerWidth/W;
        document.documentElement.style.setProperty('--sdk',k);
        var h=Math.ceil(pg.scrollHeight*k)+'px';
        /* Only when it CHANGES. The observer below watches the element whose
           height this sets a parent of, and writing an identical value every
           time is how that becomes a loop. */
        if(h!==last){last=h;vp.style.height=h;}
      }
      fit();
      addEventListener('resize',fit);
      addEventListener('orientationchange',function(){setTimeout(fit,120);});
      addEventListener('load',fit);
      if(document.fonts&&document.fonts.ready) document.fonts.ready.then(fit);
      // Media arriving late changes the page's length; an observer beats guessing.
      if(window.ResizeObserver) new ResizeObserver(fit).observe(pg);
    })();
    function _sgLead(e,f){
      e.preventDefault();
      var L=SITE_I18N[document.documentElement.lang==='zh'?'zh':'en']||SITE_I18N.en;
      var fd=new FormData(f), msg=f.querySelector('.sg-lead-msg');
      /* Whatever fields the owner configured. name/email/message keep their own
         columns because that is what the leads table and the notification email
         were built around; everything else travels together in "extra" so a
         custom field is never silently dropped on the way to the inbox.
         NOTE: no backticks in here -- this comment is inside a template
         literal, and one would end the string. */
      var body={sub:f.dataset.sub,mode:f.dataset.mode,name:fd.get('name')||'',email:fd.get('email')||'',message:fd.get('message')||'',extra:{}};
      fd.forEach(function(v,k){ if(k!=='name'&&k!=='email'&&k!=='message'&&k!=='website'&&String(v).trim()) body.extra[k]=String(v).slice(0,500); });
      fetch('/api/site-lead',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)})
        .then(function(r){return r.json().catch(function(){return {};});})
        .then(function(){
          f.querySelectorAll('input,textarea,button').forEach(function(el){el.style.display='none';});
          msg.style.display='block';
          msg.textContent=(f.dataset.mode==='pdf')?L.c_thanks_pdf:L.c_thanks;
        })
        .catch(function(){msg.style.display='block';msg.style.color='#dc2626';msg.textContent=L.c_err;});
      return false;
    }
    /* Scroll animations. The starting state lives behind the html.sd-anim-on
       class, set here -- so a visitor without JavaScript, or a crawler, gets the
       page fully visible rather than a document of invisible sections. No
       IntersectionObserver means the class is never added and everything shows.
       (No backticks: this comment is inside a template literal.) */
    (function(){
      var els=document.querySelectorAll('.sd-anim');
      if(!els.length||!('IntersectionObserver' in window))return;
      if(window.matchMedia&&window.matchMedia('(prefers-reduced-motion: reduce)').matches)return;
      document.documentElement.className+=' sd-anim-on';
      var io=new IntersectionObserver(function(entries){
        entries.forEach(function(en){ if(en.isIntersecting){ en.target.className+=' is-in'; io.unobserve(en.target); } });
      },{rootMargin:'0px 0px -8% 0px',threshold:0.06});
      els.forEach(function(el){ io.observe(el); });
      // Anything already on screen at load reveals immediately rather than
      // waiting for a scroll that may never come on a short page.
      setTimeout(function(){ els.forEach(function(el){ var r=el.getBoundingClientRect(); if(r.top<innerHeight&&r.bottom>0){ el.className+=' is-in'; io.unobserve(el); } }); },60);
    })();
  </script>${editable ? '\n' + _sdEditLayer() : ''}
</body>
</html>`;
}

/**
 * The inline editor, injected into the rendered page only when editing.
 *
 * It lives inside the iframe because that is where the real page is: reaching
 * in from the parent with an absolutely-positioned overlay means re-deriving
 * every element's box and keeping it in sync through scroll, resize and
 * re-render. Editing in place and posting the result out is both simpler and
 * always aligned with what the user is actually looking at.
 *
 * It never mutates the document itself. Every change is posted to the parent,
 * which applies it through the undo store — so inline edits are undoable
 * alongside everything else, and there is exactly one writer.
 */
function _sdEditLayer() {
  return `<style>
    .sd-el[data-type="heading"],.sd-el[data-type="subheading"],.sd-el[data-type="paragraph"],.sd-el[data-type="image"],.sd-el[data-type="imagebox"]{cursor:text;}
    .sd-el[data-type="image"],.sd-el[data-type="imagebox"]{cursor:pointer;}
    .sd-ed-hot{outline:2px dashed rgba(99,102,241,.55);outline-offset:4px;border-radius:6px;}
    .sd-ed-on{outline:2px solid #6366F1;outline-offset:4px;border-radius:6px;background:rgba(99,102,241,.05);}
    [contenteditable]{outline:none;}
    .sd-ed-sec{outline:2px dashed rgba(99,102,241,.4);outline-offset:-2px;}
    .sd-ed-bar{position:absolute;z-index:99999;display:flex;gap:6px;background:#111827;border-radius:999px;padding:6px;box-shadow:0 8px 24px rgba(0,0,0,.3);}
    .sd-ed-bar button{font:inherit;font-size:12px;font-weight:700;color:#fff;background:rgba(255,255,255,.14);border:none;border-radius:999px;padding:7px 12px;cursor:pointer;white-space:nowrap;}
    .sd-ed-bar button:hover{background:rgba(255,255,255,.26);}
    .sd-ed-bar button.danger:hover{background:#dc2626;}
    .sd-ed-reset{position:absolute;z-index:99998;font:inherit;font-size:11px;font-weight:600;color:#4338ca;background:rgba(238,242,255,.96);border:1px solid #c7d2fe;border-radius:999px;padding:4px 10px;cursor:pointer;white-space:nowrap;}
    .sd-ed-reset:hover{background:#e0e7ff;}
    .sd-ed-hint{position:fixed;left:50%;transform:translateX(-50%);bottom:14px;z-index:99999;background:rgba(17,24,39,.92);color:#fff;font-size:12px;font-weight:600;padding:8px 16px;border-radius:999px;pointer-events:none;}
    /* Undo/redo chips. The wrapper ignores pointer events so the page
       underneath stays clickable while they fade — only the pills catch clicks. */
    .sd-ed-chips{position:absolute;z-index:99999;display:flex;gap:8px;pointer-events:none;opacity:1;transition:opacity .45s ease;}
    .sd-ed-chips.is-gone{opacity:0;}
    .sd-ed-chips button{pointer-events:auto;font:inherit;font-size:12.5px;font-weight:700;color:#fff;background:rgba(17,24,39,.94);border:none;border-radius:999px;padding:9px 15px;cursor:pointer;box-shadow:0 6px 20px rgba(0,0,0,.28);white-space:nowrap;}
    .sd-ed-chips button:hover{background:#111827;}
    /* Bigger, brighter and glowing on a phone — at 12.5px on a dark page the
       chips were easy to miss entirely, which defeats the safety net. */
    @media(max-width:820px){.sd-ed-chips{gap:12px;}.sd-ed-chips button{font-size:15px;font-weight:800;padding:15px 24px;background:#4338ca;box-shadow:0 0 0 4px rgba(67,56,202,.22),0 10px 28px rgba(0,0,0,.4);}}
    .sd-ed-bar--pulse{animation:sd-pulse 1.4s ease-in-out 3;}
    .sd-ed-chips--hint button{animation:sd-pulse 1s ease-in-out 2;}
    @keyframes sd-pulse{0%,100%{transform:scale(1);box-shadow:0 8px 24px rgba(0,0,0,.3);}50%{transform:scale(1.06);box-shadow:0 8px 30px rgba(99,102,241,.75);}}
    /* The resume-sync offer. On the canvas next to what they just changed, not
       a browser confirm(): this appears after an ordinary edit in a flow whose
       premise is not being interrupted, so it must be ignorable. It answers
       itself with "no" after ten seconds and never blocks anything. */
    .sd-ed-sync{position:absolute;z-index:99998;max-width:min(330px,calc(100vw - 24px));background:#fff;color:#111827;
      border:1px solid #e5e7eb;border-radius:14px;box-shadow:0 12px 34px rgba(0,0,0,.22);padding:13px 15px;
      font:inherit;font-size:13px;line-height:1.45;opacity:1;transition:opacity .4s ease;}
    .sd-ed-sync.is-gone{opacity:0;}
    .sd-ed-sync p{margin:0 0 11px;}
    .sd-ed-sync .sd-ed-sync-btns{display:flex;gap:8px;}
    .sd-ed-sync button{font:inherit;font-size:12.5px;font-weight:700;border-radius:999px;padding:8px 16px;cursor:pointer;
      border:1.5px solid #e5e7eb;background:#fff;color:#374151;}
    .sd-ed-sync button.yes{background:#4338ca;border-color:#4338ca;color:#fff;}
    @media(max-width:820px){.sd-ed-sync{font-size:15px;}.sd-ed-sync button{font-size:14px;padding:12px 20px;}}
  </style>
  <script>
  (function(){
    var TEXT = { heading:1, subheading:1, paragraph:1 };
    var post = function(m){ try { parent.postMessage(Object.assign({ __rtEdit:1 }, m), '*'); } catch(e){} };
    var bar = null, resetBtn = null, editing = null;

    function clear(){
      if (bar) { bar.remove(); bar = null; }
      if (resetBtn) { resetBtn.remove(); resetBtn = null; }
      document.querySelectorAll('.sd-ed-sec').forEach(function(s){ s.classList.remove('sd-ed-sec'); });
    }

    // ── Text: click to change it ────────────────────────────────────────────
    function beginEdit(wrap){
      if (editing) return;
      var target = wrap.firstElementChild || wrap;
      var before = target.textContent;
      editing = { wrap: wrap, target: target, before: before };
      wrap.classList.add('sd-ed-on');
      target.setAttribute('contenteditable', 'plaintext-only');
      target.focus();
      try {
        var r = document.createRange(); r.selectNodeContents(target);
        var sel = getSelection(); sel.removeAllRanges(); sel.addRange(r);
      } catch(e){}
      var multiline = wrap.dataset.type === 'paragraph';
      hint(multiline ? 'Enter to save · Shift+Enter for a new line · Esc to cancel'
                     : 'Enter to save · Esc to cancel');

      target.onkeydown = function(ev){
        if (ev.key === 'Escape') { ev.preventDefault(); target.textContent = before; finish(false); }
        else if (ev.key === 'Enter' && !(multiline && ev.shiftKey)) { ev.preventDefault(); finish(true); }
      };
      target.onblur = function(){ finish(true); };
    }

    function finish(save){
      if (!editing) return;
      var e = editing; editing = null;
      e.target.onkeydown = null; e.target.onblur = null;
      e.target.removeAttribute('contenteditable');
      e.wrap.classList.remove('sd-ed-on');
      hint('');
      // Always announced, on every exit path — cancelled, unchanged or saved.
      // The builder hands its pointer events over for the duration of a typing
      // session, and it has to get them back even when nothing was typed.
      post({ kind: 'editEnd', ok: true, el: e.wrap.dataset.el });
      // Escaped twice on purpose: this string is a JS template literal that
      // EMITS JavaScript. A bare newline escape here becomes a REAL newline in
      // the output, and a regex literal cannot contain one — a syntax error in
      // the browser that takes the whole edit layer down with it.
      var now = e.target.innerText.replace(/\\u00a0/g, ' ').replace(/\\n{3,}/g, '\\n\\n').trim();
      if (!save || now === e.before.trim()) { e.target.textContent = e.before; return; }
      if (!now) { e.target.textContent = e.before; return; }   // never leave it blank
      post({ kind: 'edit', el: e.wrap.dataset.el, value: now });
    }

    /* The overlay also means a video's own controls can never be pressed while
       editing. The builder asks for playback by name, and reports back what
       happened — a clip the browser cannot decode should say so rather than
       sit there looking broken. */
    function playPauseById(id){
      var wrap = document.querySelector('.sd-el[data-el="' + String(id).replace(/[^A-Za-z0-9_-]/g, '') + '"]');
      var v = wrap && wrap.querySelector('video, audio');
      if (!v) { post({ kind: 'played', ok: false, reason: 'no-media' }); return; }
      if (!v.paused) { v.pause(); post({ kind: 'played', ok: true, playing: false }); return; }
      var done = false;
      var fail = function (why) { if (done) return; done = true; post({ kind: 'played', ok: false, reason: why }); };
      v.onerror = function () { fail('decode'); };
      try {
        var pr = v.play();
        if (pr && pr.then) {
          pr.then(function () { if (!done) { done = true; post({ kind: 'played', ok: true, playing: true }); } })
            .catch(function (e) { fail((e && e.name) || 'blocked'); });
        } else { done = true; post({ kind: 'played', ok: true, playing: true }); }
      } catch (e) { fail('threw'); }
    }

    /* A source the browser cannot decode fires an error event on the <source>,
       and the page is left showing a frozen frame with controls that do
       nothing. In the editor that is worth saying out loud; a visitor gets the
       browser's own fallback rather than a message about file formats.
       (No backticks: this comment is inside a template literal.) */
    addEventListener('error', function (ev) {
      var t = ev && ev.target;
      if (!t || (t.tagName !== 'SOURCE' && t.tagName !== 'VIDEO' && t.tagName !== 'AUDIO')) return;
      var wrap = t.closest && t.closest('.sd-el[data-el]');
      post({ kind: 'mediaError', el: wrap ? wrap.dataset.el : null, src: t.src || (t.currentSrc || '') });
    }, true);

    /* The builder's canvas covers this iframe with a selection overlay, so a
       click never reaches the page. It asks for editing by NAME instead —
       which is also more reliable than forwarding a synthetic click, since it
       does not depend on translating coordinates through the canvas scale. */
    function beginEditById(id){
      var wrap = document.querySelector('.sd-el[data-el="' + String(id).replace(/[^A-Za-z0-9_-]/g, '') + '"]');
      if (!wrap || !TEXT[wrap.dataset.type]) { post({ kind: 'editEnd', ok: false }); return; }
      clear(); showReset(wrap); beginEdit(wrap);
      wrap.scrollIntoView({ block: 'nearest' });
      // Confirms the caret is really here. The builder gives up its pointer
      // events to start a session, so it needs to know a session started —
      // otherwise a page that never initialised leaves a dead overlay.
      post({ kind: 'editBegan', el: wrap.dataset.el });
    }

    var hintEl = null;
    function hint(t){
      if (!t) { if (hintEl) { hintEl.remove(); hintEl = null; } return; }
      if (!hintEl) { hintEl = document.createElement('div'); hintEl.className = 'sd-ed-hint'; document.body.appendChild(hintEl); }
      hintEl.textContent = t;
    }

    // ── The escape hatch: put this field back under the resume's control ────
    function showReset(wrap){
      if (resetBtn) resetBtn.remove();
      if (wrap.dataset.detached !== '1') return;
      var r = wrap.getBoundingClientRect();
      resetBtn = document.createElement('button');
      resetBtn.className = 'sd-ed-reset';
      resetBtn.textContent = '↺ Reset to my resume';
      resetBtn.style.left = (r.left + scrollX) + 'px';
      resetBtn.style.top = (r.bottom + scrollY + 6) + 'px';
      resetBtn.onmousedown = function(ev){ ev.preventDefault(); };
      resetBtn.onclick = function(ev){
        ev.stopPropagation();
        post({ kind: 'reset', el: wrap.dataset.el });
      };
      document.body.appendChild(resetBtn);
    }

    // ── Sections: move and remove ───────────────────────────────────────────
    function showSectionBar(sec){
      clear();
      sec.classList.add('sd-ed-sec');
      var r = sec.getBoundingClientRect();
      bar = document.createElement('div');
      bar.className = 'sd-ed-bar';
      bar.style.left = (r.left + scrollX + 12) + 'px';
      bar.style.top = (r.top + scrollY + 12) + 'px';
      var mk = function(label, cls, fn){
        var b = document.createElement('button');
        b.textContent = label; if (cls) b.className = cls;
        b.onclick = function(ev){ ev.stopPropagation(); fn(); };
        bar.appendChild(b);
      };
      mk('↑ Move Up', '', function(){ post({ kind: 'moveSection', sec: sec.dataset.sec, delta: -1 }); });
      mk('↓ Move Down', '', function(){ post({ kind: 'moveSection', sec: sec.dataset.sec, delta: 1 }); });
      mk('Delete', 'danger', function(){ post({ kind: 'deleteSection', sec: sec.dataset.sec }); });
      document.body.appendChild(bar);
    }

    // ── Wiring ──────────────────────────────────────────────────────────────
    document.addEventListener('mouseover', function(ev){
      var w = ev.target.closest && ev.target.closest('.sd-el[data-el]');
      document.querySelectorAll('.sd-ed-hot').forEach(function(x){ x.classList.remove('sd-ed-hot'); });
      if (w && !editing) w.classList.add('sd-ed-hot');
    });

    document.addEventListener('click', function(ev){
      // A click on an iframe never reaches the parent document, and this iframe
      // is most of the screen — so anything out there listening for "clicked
      // away" (the help panel) has to be told.
      post({ kind: 'pageclick' });
      if (ev.target.closest('.sd-ed-bar') || ev.target.closest('.sd-ed-reset')) return;
      var wrap = ev.target.closest && ev.target.closest('.sd-el[data-el]');
      if (wrap) {
        var t = wrap.dataset.type;
        if (TEXT[t]) { ev.preventDefault(); clear(); showReset(wrap); beginEdit(wrap); return; }
        if (t === 'image' || t === 'imagebox') { ev.preventDefault(); clear(); post({ kind: 'photo', el: wrap.dataset.el }); return; }
      }
      // Anything else inside a section selects the section.
      var sec = ev.target.closest && ev.target.closest('section[data-sec]');
      if (sec) { ev.preventDefault(); showSectionBar(sec); return; }
      clear();
    });

    // Links must not navigate while editing — it would look like the site broke.
    document.addEventListener('click', function(ev){
      var a = ev.target.closest && ev.target.closest('a');
      if (a) ev.preventDefault();
    }, true);

    /* ── Undo / redo chips ──────────────────────────────────────────────────
       They appear where the action happened, not in a toolbar — a toast in the
       corner does not read as "undo THAT". The page re-renders after every
       change, which destroys them, so the parent re-requests them once the new
       render says it is ready. */
    var chips = null, chipTimer = null, chipEndsAt = 0, chipLeft = 0;
    var CHIP_MS = 5000;

    function hideChips(){
      if (chipTimer) { clearTimeout(chipTimer); chipTimer = null; }
      if (chips) { chips.remove(); chips = null; }
    }

    function startChipTimer(ms){
      if (chipTimer) clearTimeout(chipTimer);
      chipLeft = ms;
      chipEndsAt = Date.now() + ms;
      chipTimer = setTimeout(function(){
        if (!chips) return;
        chips.classList.add('is-gone');
        setTimeout(hideChips, 500);
      }, ms);
    }

    function anchorFor(d){
      var t = null;
      if (d.el) t = document.querySelector('.sd-el[data-el="' + String(d.el).replace(/[^A-Za-z0-9_-]/g, '') + '"]');
      if (!t && d.sec) t = document.querySelector('section[data-sec="' + String(d.sec).replace(/[^A-Za-z0-9_-]/g, '') + '"]');
      // A deleted section no longer exists, so fall back to whatever now sits
      // at that index — the chips appear in the space it left behind.
      if (!t && typeof d.idx === 'number') {
        var secs = document.querySelectorAll('section[data-sec]');
        if (secs.length) t = secs[Math.max(0, Math.min(d.idx, secs.length - 1))];
      }
      return t;
    }

    function showChips(d){
      hideChips();
      if (!d.canUndo && !d.canRedo) return;
      var t = anchorFor(d);
      if (!t) return;
      var r = t.getBoundingClientRect();
      chips = document.createElement('div');
      chips.className = 'sd-ed-chips';

      var mk = function(label, kind){
        var b = document.createElement('button');
        b.textContent = label;
        b.onclick = function(ev){ ev.stopPropagation(); ev.preventDefault(); post({ kind: kind }); };
        chips.appendChild(b);
      };
      if (d.canUndo) mk('↩️ Undo', 'undo');
      if (d.canRedo) mk('↪️ Redo', 'redo');
      // First keyboard undo of the session: make the chips wave, so the
      // shortcut and the button are visibly the same thing.
      if (d.hint) chips.classList.add('sd-ed-chips--hint');

      // Hovering pauses the countdown; leaving resumes it with the time left.
      chips.onmouseenter = function(){
        if (chipTimer) { clearTimeout(chipTimer); chipTimer = null; }
        chipLeft = Math.max(1200, chipEndsAt - Date.now());
        chips.classList.remove('is-gone');
      };
      chips.onmouseleave = function(){ if (chips) startChipTimer(chipLeft); };

      document.body.appendChild(chips);

      // Below the anchor by default, above it if that would run off the page.
      // Then clamped into the VISIBLE viewport: an undo chip you have to scroll
      // to find is no safety net at all, and after undoing a section delete the
      // restored section can easily be taller than the screen.
      var w = chips.getBoundingClientRect();
      var top = r.bottom + scrollY + 10;
      if (top + w.height > document.documentElement.scrollHeight - 4) top = r.top + scrollY - w.height - 10;
      var minTop = scrollY + 8;
      var maxTop = scrollY + innerHeight - w.height - 12;
      chips.style.top = Math.max(minTop, Math.min(top, maxTop)) + 'px';
      chips.style.left = Math.max(8, Math.min(r.left + scrollX + 12, innerWidth - w.width - 12)) + 'px';

      startChipTimer(CHIP_MS);
    }

    /* "Update your resume too?" — offered beside the field they just changed.
       Silence is not an answer: it times out into "no" for this edit, but the
       parent only counts an explicit No against the ask-twice-then-stop rule.
       Burning someone's two chances while they were reading would be a way of
       taking the offer away without them ever declining it. */
    var sync = null, syncTimer = null;
    function hideSync(){
      if (syncTimer) { clearTimeout(syncTimer); syncTimer = null; }
      if (sync) { sync.remove(); sync = null; }
    }
    function showSync(m){
      hideSync();
      var t = document.querySelector('[data-el="' + String(m.el).replace(/[^A-Za-z0-9_-]/g, '') + '"]');
      if (!t) return;
      sync = document.createElement('div');
      sync.className = 'sd-ed-sync';
      var p = document.createElement('p');
      p.textContent = m.question;
      sync.appendChild(p);
      var row = document.createElement('div');
      row.className = 'sd-ed-sync-btns';
      var answer = function(a){ return function(ev){
        ev.stopPropagation(); ev.preventDefault();
        hideSync();
        post({ kind: 'syncAnswer', el: m.el, field: m.field, answer: a });
      }; };
      var yes = document.createElement('button');
      yes.className = 'yes'; yes.textContent = m.yes; yes.onclick = answer('yes');
      var no = document.createElement('button');
      no.textContent = m.no; no.onclick = answer('no');
      row.appendChild(yes); row.appendChild(no);
      sync.appendChild(row);
      document.body.appendChild(sync);

      var r = t.getBoundingClientRect(), w = sync.getBoundingClientRect();
      // Below the field — but below the undo chips too when they are showing.
      // Both are anchored to the element that just changed, so without this the
      // chip sits on top of the question and hides the first words of it.
      var below = r.bottom;
      if (chips) {
        var cr = chips.getBoundingClientRect();
        if (cr.height) below = Math.max(below, cr.bottom);   // both viewport-relative
      }
      var top = below + scrollY + 10;
      if (top + w.height > document.documentElement.scrollHeight - 4) top = r.top + scrollY - w.height - 10;
      sync.style.top = Math.max(scrollY + 8, Math.min(top, scrollY + innerHeight - w.height - 12)) + 'px';
      sync.style.left = Math.max(8, Math.min(r.left + scrollX, innerWidth - w.width - 12)) + 'px';

      syncTimer = setTimeout(function(){
        if (!sync) return;
        sync.classList.add('is-gone');
        setTimeout(function(){ hideSync(); }, 420);
        post({ kind: 'syncAnswer', el: m.el, field: m.field, answer: 'timeout' });
      }, 10000);
    }

    addEventListener('message', function(ev){
      var m = ev && ev.data;
      if (!m) return;
      if (m.__rtChips === 1) {
        if (m.hide) { hideChips(); return; }
        showChips(m);
        return;
      }
      if (m.__rtSync === 1) { showSync(m); return; }
      if (m.__rtEdit === 1 && m.action === 'beginEdit') { beginEditById(m.el); return; }
      if (m.__rtEdit === 1 && m.action === 'playPause') { playPauseById(m.el); return; }
      // "I want to move something": put a bar on every section at once and
      // bring the first into view, so the controls end up under their eyes
      // rather than needing to be discovered by clicking around.
      if (m.__rtHelp === 1 && m.action === 'showMoves') {
        clear();
        var secs = document.querySelectorAll('section[data-sec]');
        secs.forEach(function(sec){
          sec.classList.add('sd-ed-sec');
          var r = sec.getBoundingClientRect();
          var b = document.createElement('div');
          b.className = 'sd-ed-bar sd-ed-bar--pulse sd-ed-bar--hint';
          b.style.left = (r.left + scrollX + 12) + 'px';
          b.style.top = (r.top + scrollY + 12) + 'px';
          [['↑ Move Up', -1], ['↓ Move Down', 1]].forEach(function(p){
            var btn = document.createElement('button');
            btn.textContent = p[0];
            btn.onclick = function(e){ e.stopPropagation(); post({ kind: 'moveSection', sec: sec.dataset.sec, delta: p[1] }); };
            b.appendChild(btn);
          });
          var del = document.createElement('button');
          del.textContent = 'Delete'; del.className = 'danger';
          del.onclick = function(e){ e.stopPropagation(); post({ kind: 'deleteSection', sec: sec.dataset.sec }); };
          b.appendChild(del);
          document.body.appendChild(b);
        });
        if (secs.length) secs[0].scrollIntoView({ behavior: 'smooth', block: 'start' });
        setTimeout(function(){
          document.querySelectorAll('.sd-ed-bar--hint').forEach(function(x){ x.remove(); });
          document.querySelectorAll('.sd-ed-sec').forEach(function(x){ x.classList.remove('sd-ed-sec'); });
        }, 7000);
      }
    });

    /* Keyboard. The page is an iframe, so keydown fires in whichever document
       holds focus — after a single click on the page, that is this one. The
       parent listens too; between them every case is covered.

       While someone is typing in a field, Ctrl+Z belongs to the browser: it
       should undo their typing, not their last site change. */
    document.addEventListener('keydown', function(ev){
      if (editing) return;                       // typing: leave it to the browser
      var t = ev.target;
      if (t && (t.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName || ''))) return;
      var mod = ev.ctrlKey || ev.metaKey;
      if (!mod) return;
      var k = (ev.key || '').toLowerCase();
      if (k === 'z' && !ev.shiftKey) { ev.preventDefault(); post({ kind: 'undo', viaKey: true }); }
      else if ((k === 'z' && ev.shiftKey) || k === 'y') { ev.preventDefault(); post({ kind: 'redo', viaKey: true }); }
    });

    post({ kind: 'ready' });
  })();
  </script>`;
}

const shareLimiter = rateLimit({ windowMs: 60 * 1000, max: 12, message: { error: 'rate_limited', message: 'Too many share links — please wait a minute.' } });
app.post('/api/share', shareLimiter, (req, res) => {
  try {
    const { text, name, colors, photoUrl, hideContact, serif, expiresDays, layout } = req.body || {};
    if (!text || typeof text !== 'string' || text.trim().length < 20) return res.status(400).json({ error: 'No resume to share.' });
    if (text.length > 40000) return res.status(400).json({ error: 'Resume is too long to share.' });
    let photo = null;
    if (typeof photoUrl === 'string' && /^data:image\/(png|jpe?g|webp);base64,/i.test(photoUrl) && photoUrl.length < 2000000) photo = photoUrl;
    // Optional expiry — the link auto-expires N days after creation. Absent, 0, or a
    // non-positive value means it never expires. Capped at 1 year so a bad value
    // can't create a permanent-but-huge timestamp.
    let expiresAt = null;
    const _days = Number(expiresDays);
    if (Number.isFinite(_days) && _days > 0) {
      expiresAt = Date.now() + Math.min(Math.floor(_days), 365) * 24 * 60 * 60 * 1000;
    }
    // Only persist a template family we know how to render; anything else falls
    // back to the linear layout at render time.
    const _layout = _SHARE_LAYOUTS.has(layout) ? layout : null;
    const slug = _shareSlug();
    db.prepare(`INSERT INTO shared_resumes (slug, name, text, accent, primary_hex, serif, photo, hide_contact, created_at, expires_at, views, layout)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0, ?)`).run(
      slug,
      (name || '').toString().slice(0, 80),
      text,
      (colors && colors.accent ? String(colors.accent).replace('#', '').slice(0, 6) : '8b5cf6'),
      (colors && colors.primary ? String(colors.primary).replace('#', '').slice(0, 6) : '4a1042'),
      serif ? 1 : 0,
      photo,
      hideContact ? 1 : 0,
      Date.now(),
      expiresAt,
      _layout
    );
    const origin = `${req.protocol}://${req.get('host')}`;
    res.json({ url: `${origin}/r/${slug}`, slug, expiresAt });
  } catch (err) {
    console.error('[share] create failed:', err && err.message ? err.message : err);
    res.status(500).json({ error: 'Could not create share link.' });
  }
});

app.get('/r/:slug', (req, res) => {
  const slug = String(req.params.slug || '').replace(/[^a-zA-Z0-9]/g, '');
  const row = slug ? db.prepare('SELECT * FROM shared_resumes WHERE slug = ?').get(slug) : null;
  if (!row || (row.expires_at && Date.now() > row.expires_at)) {
    res.status(404);
    return res.sendFile(path.join(__dirname, 'public', '404.html'));
  }
  try { db.prepare('UPDATE shared_resumes SET views = views + 1 WHERE slug = ?').run(slug); } catch (_) {}
  const origin = `${req.protocol}://${req.get('host')}`;
  res.setHeader('X-Robots-Tag', 'noindex, nofollow');
  res.setHeader('Content-Type', 'text/html; charset=utf-8');
  res.setHeader('Cache-Control', 'no-cache');
  res.send(_shareResumeHtml(row, origin));
});

// ─── Personal portfolio website (Pro feature) ─────────────────────────────────
// Publish a resume as a live, indexable, watermark-free personal site. Served
// at /site/:name for now (path-based). When wildcard DNS + TLS are available
// for *.resumetailored.com, a host-based middleware can map
// name.resumetailored.com → the same renderer (see PLAN.md §5 / RAILWAY_SETUP).
// Gated behind Pro because each site consumes our hosting per visitor.
const RESERVED_SUBDOMAINS = new Set([
  'www', 'app', 'api', 'mail', 'admin', 'blog', 'static', 'cdn', 'assets', 'r',
  'preview', 'dashboard', 'help', 'support', 'login', 'signup', 'account',
  'site', 'sites', 'about', 'pricing', 'terms', 'privacy', 'status', 'docs',
  'resumetailored', 'ftp', 'smtp', 'ns', 'test', 'dev', 'staging',
]);
function _validSubdomain(s) {
  const v = String(s || '').toLowerCase().trim();
  if (!/^[a-z0-9](?:[a-z0-9-]{1,28}[a-z0-9])$/.test(v)) return null; // 3–30 chars, no leading/trailing hyphen
  if (RESERVED_SUBDOMAINS.has(v)) return null;
  return v;
}

/**
 * The one place that decides what a published site's public URL looks like.
 *
 * Today that is `<origin>/site/<name>`. Host-based `<name>.resumetailored.com`
 * is already implemented (see PERSONAL_SITE_HOST_RE above) but stays inert
 * until a wildcard DNS record and a wildcard TLS certificate exist — without
 * both, a subdomain link either fails to resolve or throws a certificate
 * warning, which is worse than a long URL on a page you send to recruiters.
 *
 * Set SITE_PUBLIC_HOST=resumetailored.com once that infrastructure is live and
 * every link, QR code, share sheet and canonical tag switches over at once.
 * Leave it unset and nothing changes.
 */
// Defaults to the production domain, whose wildcard DNS and wildcard TLS
// certificate are live. An env var can still override or disable it.
const SITE_PUBLIC_HOST = String(
  process.env.SITE_PUBLIC_HOST === undefined ? 'resumetailored.com' : process.env.SITE_PUBLIC_HOST
).trim().toLowerCase().replace(/^https?:\/\//, '').replace(/[/].*$/, '');

/**
 * Whether subdomain URLs actually work for the host this request arrived on.
 *
 * Deriving it from the request rather than trusting a deploy-wide flag matters:
 * a Railway preview URL or localhost has no wildcard record and no certificate
 * for `<name>.resumetailored.com`, so handing those visitors a subdomain link
 * would break every one of them. Same code, correct URL on every host.
 */
function _siteHostReady(origin) {
  if (!SITE_PUBLIC_HOST) return false;
  const host = String(origin || '').replace(/^https?:\/\//, '').replace(/[/:].*$/, '').toLowerCase();
  return host === SITE_PUBLIC_HOST || host.endsWith('.' + SITE_PUBLIC_HOST);
}

function sitePublicUrl(sub, origin, pageSlug) {
  const s = String(sub || '');
  const page = pageSlug ? '/' + String(pageSlug).replace(/[^a-z0-9-]/gi, '') : '';
  if (s && _siteHostReady(origin)) return `https://${s}.${SITE_PUBLIC_HOST}${page}`;
  return `${origin}/site/${s}${page}`;
}

/**
 * The plain-object `siteData` that llms-txt.js's `generateLlmsTxt()` turns
 * into a page. Kept separate from the pure builder on purpose — this is the
 * only piece that touches the database, `row.config` parsing, and the
 * per-field fallbacks; generateLlmsTxt() never needs to know any of that.
 *
 * There is no static deploy directory for a personal site to write a file
 * into — every page is rendered fresh from the `personal_sites` row on each
 * request (see `_renderPersonalSite`/`_serveSite` below). llms.txt follows
 * the same pattern: generated on every request to `/site/:sub/llms.txt`
 * rather than written to disk at publish time, so it can never go stale
 * relative to a site that keeps autosaving.
 */
function _siteLlmsTxtData(row, origin) {
  const sub = row.subdomain || '';
  const name = String(row.name || sub || 'Personal Website').trim() || 'Personal Website';
  let cfg = null;
  try { cfg = row.config ? JSON.parse(row.config) : null; } catch (_) { cfg = null; }

  // The same field derivation the site itself (and the Website Creator's
  // autogen) uses, so a derived tagline reads like the person's own resume
  // rather than a second, independently-invented summary.
  const derived = require('./public/site-fields.js').deriveFields(row.text || '');
  const pages = [];
  const docPages = (cfg && Array.isArray(cfg.pages) ? cfg.pages : []).filter((p) => p && typeof p === 'object');
  // The home page's own SEO description, if the user wrote one, IS the
  // author's chosen one-line pitch for the site — preferred over a summary
  // this code derived on its own.
  const home = docPages.find((p) => p.isHome) || docPages[0] || null;
  const tagline = (home && home.seo && home.seo.description)
    || derived.summary
    || `The personal website of ${name}${derived.role ? `, ${derived.role}` : ''}${derived.location ? ` (${derived.location})` : ''}.`;

  if (docPages.length) {
    for (const p of docPages) {
      const isHome = !!p.isHome;
      const slug = String(p.slug || '').toLowerCase();
      pages.push({
        title: (p.seo && p.seo.title) || p.name || (isHome ? name : slug) || name,
        url: sitePublicUrl(sub, origin, isHome ? undefined : slug),
        description: (p.seo && p.seo.description) || (isHome ? tagline : `A page on ${name}'s site.`),
      });
    }
  } else {
    // Legacy/simple sites with no Website Creator config are a single page.
    pages.push({ title: name, url: sitePublicUrl(sub, origin), description: tagline });
  }

  const hasCoverLetter = !!(cfg && cfg.assets && typeof cfg.assets.coverLetterText === 'string' && cfg.assets.coverLetterText.trim().length > 20);
  if (hasCoverLetter) {
    // Always the /site/:sub form, even when the rest of this file's links use
    // the host-based subdomain: /cover-letter has no host-based route of its
    // own (see PERSONAL_SITE_HOST_RE above), so a subdomain URL here would 404.
    pages.push({
      title: `${name} — Cover Letter`,
      url: `${String(origin).replace(/\/+$/, '')}/site/${sub}/cover-letter`,
      description: `Download ${name}'s cover letter as a plain-text file.`,
    });
  }

  return { name, tagline, pages };
}

function _serveLlmsTxt(row, origin, res) {
  const { generateLlmsTxt } = require('./llms-txt.js');
  res.setHeader('Content-Type', 'text/plain; charset=utf-8');
  res.setHeader('Cache-Control', 'no-cache');
  res.send(generateLlmsTxt(_siteLlmsTxtData(row, origin)));
}

/**
 * The site a user is currently working on.
 *
 * A user may now keep several — one per template they have tried. "Current"
 * means the live one if there is one, otherwise the most recently touched,
 * because that is the one they were last looking at.
 */
const now0 = () => Date.now();

function _currentSite(email) {
  const e = String(email || '').toLowerCase();
  return db.prepare(
    `SELECT * FROM personal_sites WHERE email = ?
     ORDER BY published DESC, updated_at DESC LIMIT 1`).get(e) || null;
}

// Fetch the signed-in user's current personal site (if any).
app.get('/api/personal-site', (req, res) => {
  const email = getSessionEmail(req);
  if (!email) return res.status(401).json({ error: 'Please sign in.' });
  const row = _currentSite(email);
  const origin = `${req.protocol}://${req.get('host')}`;
  // The client must never build this URL itself — that is how it ended up
  // hard-coded in nine places and unable to follow the subdomain switch.
  res.json({ site: row || null, url: row ? sitePublicUrl(row.subdomain, origin) : null });
});

/**
 * Every site this user has, newest first. One of them may be published; the
 * rest are drafts they can come back to.
 */
app.get('/api/personal-sites', (req, res) => {
  const email = getSessionEmail(req);
  if (!email) return res.status(401).json({ error: 'Please sign in.' });
  const origin = `${req.protocol}://${req.get('host')}`;
  const rows = db.prepare(
    `SELECT subdomain, name, published, views, created_at, updated_at, config
     FROM personal_sites WHERE email = ? ORDER BY updated_at DESC`).all(email.toLowerCase());
  const { templateList } = require('./site-templates.js');
  const names = {};
  templateList().forEach((t) => { names[t.id] = t.name; });
  res.json({
    sites: rows.map((r) => {
      let cfg = null; try { cfg = r.config ? JSON.parse(r.config) : null; } catch (_) { cfg = null; }
      const tpl = (cfg && cfg.templateId) || null;
      return {
        subdomain: r.subdomain, name: r.name, published: !!r.published, views: r.views || 0,
        createdAt: r.created_at, updatedAt: r.updated_at,
        templateId: tpl, templateName: (tpl && names[tpl]) || null,
        url: sitePublicUrl(r.subdomain, origin),
      };
    }),
  });
});

// Remove one site. Deleting the live one takes it off the internet, so the
// caller has to name it rather than relying on "the current one".
app.delete('/api/personal-sites/:sub', (req, res) => {
  const email = getSessionEmail(req);
  if (!email) return res.status(401).json({ error: 'Please sign in.' });
  const sub = _validSubdomain(req.params.sub);
  if (!sub) return res.status(400).json({ error: 'invalid_subdomain' });
  const row = db.prepare('SELECT email FROM personal_sites WHERE subdomain = ?').get(sub);
  if (!row) return res.status(404).json({ error: 'not_found' });
  if (row.email.toLowerCase() !== email.toLowerCase()) return res.status(403).json({ error: 'not_yours' });
  db.prepare('DELETE FROM personal_sites WHERE subdomain = ?').run(sub);
  _deleteSiteMedia(sub);
  res.json({ success: true });
});

/**
 * Rendered HTML of ONE of the user's own sites — the Back Office thumbnail.
 *
 * The template gallery's preview would have been easier, but it shows the
 * template's invented sample person. A list of sites all showing "Alex Morgan"
 * cannot be told apart, which is the one thing a thumbnail exists to do. This
 * renders their real content, draft or live, through the same renderer the
 * public page uses.
 *
 * Owner-only and noindex — a draft rendered here is still private. It is
 * fetched with the Bearer token and shown via `srcdoc`, because an iframe
 * cannot send a header.
 */
app.get('/api/personal-sites/:sub/render', tplPreviewLimiter, (req, res) => {
  const email = getSessionEmail(req);
  if (!email) return res.status(401).json({ error: 'Please sign in.' });
  const sub = _validSubdomain(req.params.sub);
  if (!sub) return res.status(400).json({ error: 'invalid_subdomain' });
  const row = db.prepare('SELECT * FROM personal_sites WHERE subdomain = ?').get(sub);
  if (!row) return res.status(404).json({ error: 'not_found' });
  if (row.email.toLowerCase() !== email.toLowerCase()) return res.status(403).json({ error: 'not_yours' });
  const origin = `${req.protocol}://${req.get('host')}`;
  res.setHeader('Content-Type', 'text/html; charset=utf-8');
  res.send(_renderPersonalSite(row, origin, {
    indexable: false, footer: '', baseUrl: `${origin}/site/${sub}`,
  }));
});

// Publish / update the signed-in Pro user's personal site.
app.post('/api/personal-site', (req, res) => {
  const email = getSessionEmail(req);
  if (!email) return res.status(401).json({ error: 'Please sign in.' });
  if (!isSubscriber(email)) {
    return res.status(402).json({ error: 'pro_required', message: 'Publishing a personal website is a Pro feature. Upgrade to unlock it.' });
  }
  const { subdomain, text, name, colors, photoUrl, hideContact, serif, layout, config, publish } = req.body || {};
  // Drafts. A site is public the moment `published` is 1, so anything created
  // on the user's behalf — the auto-generated starter site — must be able to
  // save WITHOUT going live.
  //
  // Omitting `publish` PRESERVES whatever the site already is, so an auto-save
  // can never publish a private site by forgetting a flag, and can never take a
  // live site down either. Only an explicit `publish` changes that state, which
  // means going public is always something the user asked for.
  const sub = _validSubdomain(subdomain);
  if (!sub) return res.status(400).json({ error: 'invalid_subdomain', message: 'Choose 3–30 letters, numbers or hyphens (not a reserved word).' });
  if (!text || typeof text !== 'string' || text.trim().length < 20) return res.status(400).json({ error: 'No resume content to publish.' });
  if (text.length > 40000) return res.status(400).json({ error: 'Resume is too long to publish.' });

  // The subdomain must be free — unless it already belongs to this user (rename
  // / re-publish). One site per user: an existing row for this email is updated.
  const owner = db.prepare('SELECT email FROM personal_sites WHERE subdomain = ?').get(sub);
  if (owner && owner.email.toLowerCase() !== email.toLowerCase()) {
    return res.status(409).json({ error: 'taken', message: 'That address is already taken — try another.' });
  }
  let photo = null;
  if (typeof photoUrl === 'string' && /^data:image\/(png|jpe?g|webp);base64,/i.test(photoUrl) && photoUrl.length < 2000000) photo = photoUrl;
  const _layout = _SHARE_LAYOUTS.has(layout) ? layout : null;
  // Website Creator config blob (theme, section order/placement, selected asset
  // ids, feature toggles). Stored as a JSON string; accept an object or a string,
  // cap the size, and fall back to NULL (legacy default) on anything invalid.
  let _config = null;
  if (config != null) {
    try {
      const s = typeof config === 'string' ? config : JSON.stringify(config);
      if (s && s.length <= 200000) { JSON.parse(s); _config = s; }
    } catch (_) { _config = null; }
  }
  const now = Date.now();

  // A user may keep several sites — one per template they have tried. Saving
  // one no longer destroys the others; only an explicit rename moves a site,
  // and only an explicit delete removes one.
  const target = db.prepare('SELECT subdomain, published, views FROM personal_sites WHERE subdomain = ? AND email = ?').get(sub, email.toLowerCase());
  const renameFrom = (typeof req.body.renameFrom === 'string') ? _validSubdomain(req.body.renameFrom) : null;
  const moving = renameFrom && renameFrom !== sub
    ? db.prepare('SELECT subdomain, published, views FROM personal_sites WHERE subdomain = ? AND email = ?').get(renameFrom, email.toLowerCase())
    : null;

  // A rename carries the site across rather than copying it: the old address
  // goes dark and the visit count comes with it, because changing your address
  // is not the same as starting over.
  const carriedViews = (target && target.views) || (moving && moving.views) || 0;
  if (moving) {
    db.prepare('DELETE FROM personal_sites WHERE subdomain = ?').run(moving.subdomain);
    // The rename carries the site's media across too — a rename is not a
    // delete-and-recreate, so the photos and videos already on the page must
    // not vanish (or count as "new" against the new address's own quota).
    db.prepare('UPDATE site_media SET site_sub = ? WHERE site_sub = ?').run(sub, moving.subdomain);
    // Leave a forwarding address. Anyone holding the old link — an application
    // sent last week, a message on LinkedIn — lands on the site rather than a
    // dead page.
    db.prepare('INSERT OR REPLACE INTO site_aliases (old_sub, new_sub, email, created_at) VALUES (?,?,?,?)')
      .run(moving.subdomain, sub, email.toLowerCase(), now0());
    // Renaming twice must not leave a chain that has to be walked; point every
    // older address straight at the current one.
    db.prepare('UPDATE site_aliases SET new_sub = ? WHERE new_sub = ?').run(sub, moving.subdomain);
  }
  // A live site always beats a forwarding address: if this name used to
  // forward somewhere, it stops now that something really lives here.
  db.prepare('DELETE FROM site_aliases WHERE old_sub = ?').run(sub);
  const existing = target || moving;

  const publishedFlag = typeof publish === 'boolean'
    ? (publish ? 1 : 0)
    : (existing ? (existing.published ? 1 : 0) : 1); // new site with no flag: the legacy publish path

  db.prepare(`INSERT INTO personal_sites (subdomain, email, name, text, accent, primary_hex, serif, photo, hide_contact, layout, config, published, created_at, updated_at, views)
              VALUES (@subdomain, @email, @name, @text, @accent, @primary_hex, @serif, @photo, @hide_contact, @layout, @config, @published, @now, @now, @views)
              ON CONFLICT(subdomain) DO UPDATE SET
                name=@name, text=@text, accent=@accent, primary_hex=@primary_hex, serif=@serif,
                photo=@photo, hide_contact=@hide_contact, layout=@layout, config=@config, published=@published, updated_at=@now`).run({
    subdomain: sub, email: email.toLowerCase(),
    name: (name || '').toString().slice(0, 80), text,
    accent: (colors && colors.accent ? String(colors.accent).replace('#', '').slice(0, 6) : '8b5cf6'),
    primary_hex: (colors && colors.primary ? String(colors.primary).replace('#', '').slice(0, 6) : '4a1042'),
    serif: serif ? 1 : 0, photo, hide_contact: hideContact ? 1 : 0, layout: _layout, config: _config,
    published: publishedFlag, views: carriedViews, now,
  });
  // Only ever one live site. Publishing this one takes the others down rather
  // than leaving two versions of the same person on the internet.
  if (publishedFlag === 1) {
    db.prepare('UPDATE personal_sites SET published = 0 WHERE email = ? AND subdomain != ?')
      .run(email.toLowerCase(), sub);
  }
  const origin = `${req.protocol}://${req.get('host')}`;
  const siteUrl = sitePublicUrl(sub, origin);
  // Only a real, explicit publish — not the autosave path, which omits
  // `publish` entirely to preserve whatever the site already was (see the
  // comment above), and not an explicit UNpublish either. Firing on every
  // autosave would mean an email per keystroke-adjacent save; this fires on
  // exactly the actions that show the user a "published" success page.
  if (publish === true && publishedFlag === 1) _sendPublishSuccessEmail(email, siteUrl, origin);
  res.json({ url: siteUrl, subdomain: sub, published: publishedFlag === 1 });
});

// The ten Vibes. Public and unauthenticated for the same reason the template
// preview is: it is a static list of colours and filenames, no user data.
app.get('/api/site-vibes', (req, res) => {
  const { list } = require('./public/site-vibes.js');
  res.json({ vibes: list() });
});

/**
 * Replace a starter template's sample copy with the user's own.
 *
 * This matters more than it looks. The template ships with "Marketing Manager ·
 * Toronto" and a paragraph of invented biography; leaving those in place means
 * handing someone a page that makes false claims about them, on a URL they are
 * about to send to recruiters. Every visible line of sample prose is either
 * replaced with something true or removed.
 *
 * Derivation lives in public/site-fields.js so the generator and the inline
 * editor agree on what "the name" or "the summary" means — two copies would
 * drift, and the drift would only show up as a field resetting to the wrong
 * thing.
 */
function _autogenFill(doc, text) {
  // The implementation lives in public/site-fields.js so the editor's template
  // swap runs the identical fill. It used to live here, server-side only, and
  // the client path published the template's sample person as the user.
  return require('./public/site-fields.js').fillFromResume(doc, text);
}

/**
 * Auto-generate a starter site so the user never faces a blank screen.
 *
 * The Website Creator is for people who have never built a website: they should
 * land on a finished page and gently change it, not assemble one. This builds a
 * complete site from their most recent saved resume and returns it.
 *
 * It saves as a DRAFT (`publish: false`). The page carries their name, work
 * history and contact details, so it does not become publicly reachable until
 * they press Publish themselves.
 *
 * If they already have a site, this returns it untouched — it never overwrites.
 */
app.post('/api/personal-site/autogen', (req, res) => {
  const email = getSessionEmail(req);
  if (!email) return res.status(401).json({ error: 'Please sign in.' });
  if (!isSubscriber(email)) return res.status(402).json({ error: 'pro_required' });

  // `fresh` means "make me another one" — trying a different template rather
  // than reopening what they already have. Each template gets its own site so
  // switching never destroys the one they have been working on.
  let fresh = !!(req.body && req.body.fresh);
  // `subdomain` means "open THIS one" — the Back Office lists every site the
  // user has, and Edit there has to reopen the card they pressed rather than
  // whichever site happens to be current. Asking for a site that isn't theirs
  // is a 404, never a silent fall-through into creating a new one.
  const wantOpen = (req.body && typeof req.body.subdomain === 'string')
    ? _validSubdomain(req.body.subdomain) : null;
  if (!fresh && req.body && req.body.subdomain && !wantOpen) {
    return res.status(400).json({ error: 'invalid_subdomain' });
  }
  let existing = fresh
    ? null
    : (wantOpen
        ? db.prepare('SELECT * FROM personal_sites WHERE subdomain = ? AND email = ?').get(wantOpen, email.toLowerCase())
        : _currentSite(email));
  if (!fresh && wantOpen && !existing) return res.status(404).json({ error: 'not_found' });

  // An explicit template choice is never silently discarded.
  //
  // This returned the existing site whenever there was one, so picking a
  // template while you already had a site handed back the OLD one — built from
  // a different template — and the choice you had just made vanished. "This is
  // not even the template I chose" is exactly what that looks like.
  //
  // Naming a template that is not what this site was built from means "build me
  // this one", so it falls through to creation. The old site is kept rather
  // than overwritten, which is the same rule as trying a different design: a
  // template you are experimenting with must never destroy the one you have.
  if (existing && !wantOpen && req.body && req.body.templateId) {
    let curTpl = null;
    try { curTpl = existing.config ? (JSON.parse(existing.config).templateId || null) : null; } catch (_) { curTpl = null; }
    if (curTpl !== String(req.body.templateId)) { existing = null; fresh = true; }
  }
  if (existing) {
    const origin0 = `${req.protocol}://${req.get('host')}`;
    return res.json({
      created: false, subdomain: existing.subdomain, name: existing.name,
      text: existing.text, published: !!existing.published,
      config: existing.config ? JSON.parse(existing.config) : null,
      url: sitePublicUrl(existing.subdomain, origin0),
    });
  }

  const resume = db.prepare('SELECT title, content FROM saved_resumes WHERE email = ? ORDER BY created_at DESC LIMIT 1').get(email);
  const text = resume && typeof resume.content === 'string' ? resume.content.trim() : '';
  if (text.length < 20) {
    return res.status(409).json({ error: 'no_resume', message: 'Tailor a resume first — your website is built from it.' });
  }
  const cover = db.prepare('SELECT id FROM saved_cover_letters WHERE email = ? ORDER BY created_at DESC LIMIT 1').get(email);
  const resumeRow = db.prepare('SELECT id FROM saved_resumes WHERE email = ? ORDER BY created_at DESC LIMIT 1').get(email);

  // The name is the first non-empty line of the resume — the convention every
  // resume follows, and the same one the résumé renderer already relies on.
  const name = (text.split('\n').map((l) => l.trim()).find(Boolean) || '').slice(0, 80);

  // Which template to build from. The picker sends the one they chose; without
  // it we fall back to the calmest starter. Resolved here because the web
  // address is named after it.
  const { templateDoc: _tplDoc } = require('./site-templates.js');
  const wantedTpl = String((req.body && req.body.templateId) || '').slice(0, 40);
  const usedTemplate = (wantedTpl && _tplDoc(wantedTpl)) ? wantedTpl : 'minimal';

  // Address: their username, else their name, else the local part of their
  // email. Numbered if taken, so this can never fail on a collision.
  const user = db.prepare('SELECT username FROM users WHERE email = ?').get(email);
  const seed = String(user && user.username || name || email.split('@')[0] || 'me')
    .toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 24) || 'me';
  // A second site needs its own address. Name it after the template so the
  // list reads as "alice" and "alice-developer" rather than "alice-2".
  const base = fresh && usedTemplate
    ? `${seed.slice(0, 16)}-${String(usedTemplate).replace(/[^a-z0-9]/g, '').slice(0, 12)}`
    : seed;
  let sub = _validSubdomain(base.length >= 3 ? base : base + '-site');
  for (let i = 2; i <= 60 && (!sub || db.prepare('SELECT 1 FROM personal_sites WHERE subdomain = ?').get(sub)); i++) {
    sub = _validSubdomain(`${base.slice(0, 24)}-${i}`);
  }
  if (!sub) return res.status(409).json({ error: 'no_address', message: 'Could not pick a web address — choose one yourself.' });

  const { templateDoc } = require('./site-templates.js');
  const doc = templateDoc(usedTemplate);
  _autogenFill(doc, text);
  doc.templateId = usedTemplate;
  doc.assets = { resumeId: resumeRow ? resumeRow.id : null, coverLetterId: cover ? cover.id : null };

  const now = Date.now();
  db.prepare(`INSERT INTO personal_sites (subdomain, email, name, text, accent, primary_hex, serif, photo, hide_contact, layout, config, published, created_at, updated_at, views)
              VALUES (?,?,?,?,?,?,0,NULL,0,NULL,?,0,?,?,0)`)
    .run(sub, email.toLowerCase(), name, text, '8b5cf6', '4a1042', JSON.stringify(doc), now, now);

  const origin = `${req.protocol}://${req.get('host')}`;
  res.json({
    created: true, subdomain: sub, name, text, config: doc, published: false,
    url: sitePublicUrl(sub, origin),
  });
});

// WYSIWYG preview: render the personal site from posted fields WITHOUT saving,
// so the Website Creator's Edit/Preview toggle can show unpublished edits. Pro-gated.
app.post('/api/personal-site/preview', (req, res) => {
  const email = getSessionEmail(req);
  if (!email) return res.status(401).json({ error: 'Please sign in.' });
  if (!isSubscriber(email)) return res.status(402).json({ error: 'pro_required' });
  const { text, name, colors, photoUrl, hideContact, serif, layout, config, subdomain, page, editable } = req.body || {};
  if (!text || typeof text !== 'string' || text.trim().length < 10) {
    return res.status(400).json({ error: 'Nothing to preview yet.' });
  }
  let _config = null;
  if (config != null) {
    try { const s = typeof config === 'string' ? config : JSON.stringify(config); if (s && s.length <= 200000) { JSON.parse(s); _config = s; } } catch (_) { _config = null; }
  }
  let photo = null;
  if (typeof photoUrl === 'string' && /^data:image\/(png|jpe?g|webp);base64,/i.test(photoUrl) && photoUrl.length < 2000000) photo = photoUrl;
  // Preview renders as the user's real subdomain when they have one, so the
  // output is identical to the published page (see test/preview-parity.js).
  const sub = _validSubdomain(subdomain) || 'preview';
  const row = {
    subdomain: sub, name: (name || '').toString().slice(0, 80), text: text.slice(0, 40000),
    accent: (colors && colors.accent ? String(colors.accent).replace('#', '').slice(0, 6) : '8b5cf6'),
    primary_hex: (colors && colors.primary ? String(colors.primary).replace('#', '').slice(0, 6) : '4a1042'),
    serif: serif ? 1 : 0, photo, hide_contact: hideContact ? 1 : 0,
    layout: (_SHARE_LAYOUTS.has(layout) ? layout : null), config: _config,
  };
  const origin = `${req.protocol}://${req.get('host')}`;
  const pageSlug = String(page || '').toLowerCase().slice(0, 60);
  res.setHeader('Content-Type', 'text/html; charset=utf-8');
  res.send(_renderPersonalSite(row, origin, {
    indexable: false, footer: '',
    baseUrl: `${origin}/site/${sub}`,
    page: pageSlug,
    // Opt-in only. Without this the preview is byte-identical to the published
    // page, which test/preview-parity.js asserts.
    editable: editable === true,
  }));
});

// ── Website Builder v2: starter templates ────────────────────────────────────
const { templateList, templateDoc } = require('./site-templates');

// Catalogue for the template gallery.
app.get('/api/site-templates', (req, res) => {
  const email = getSessionEmail(req);
  if (!email) return res.status(401).json({ error: 'Please sign in.' });
  res.json({ templates: templateList() });
});

// The full document for one template (used when the user picks it).
app.get('/api/site-templates/:id', (req, res) => {
  const email = getSessionEmail(req);
  if (!email) return res.status(401).json({ error: 'Please sign in.' });
  const doc = templateDoc(String(req.params.id || '').slice(0, 40));
  if (!doc) return res.status(404).json({ error: 'Unknown template.' });
  res.json({ doc });
});

// Rendered preview of a template, for the gallery's desktop/mobile preview
// frames. Rendered by the SAME renderer the published site uses.
// NOT auth-gated, deliberately: this renders a STATIC template with placeholder
// sample content — no user data of any kind. It is loaded via <iframe src=...>
// for the gallery thumbnails and previews, and an iframe cannot send the Bearer
// token, so requiring a session here made every template preview 401.
app.get('/api/site-templates/:id/preview', tplPreviewLimiter, (req, res) => {
  const doc = templateDoc(String(req.params.id || '').slice(0, 40));
  if (!doc) return res.status(404).json({ error: 'Unknown template.' });
  const page = String(req.query.page || '').toLowerCase().slice(0, 60);
  const origin = `${req.protocol}://${req.get('host')}`;
  // Sample résumé text so a template's `resume` element has something to show.
  const row = {
    subdomain: 'preview', name: 'Alex Morgan', accent: '8b5cf6', primary_hex: '4a1042',
    serif: 0, photo: null, hide_contact: 0, layout: null, config: JSON.stringify(doc),
    text: 'Alex Morgan\nalex@example.com | New York, NY\n\nSUMMARY\nOperations leader with 15 years scaling teams through hypergrowth.\n\nEXPERIENCE\nVP Operations, Northwind (2020–Present)\n• Owned a $40M P&L across four countries\n• Doubled on-time delivery in two quarters\n\nSKILLS\nOperating cadence, GTM, Org design',
  };
  res.setHeader('Content-Type', 'text/html; charset=utf-8');
  res.send(_renderPersonalSite(row, origin, { indexable: false, footer: '', baseUrl: `${origin}/site/preview`, page }));
});

// Toggle publish/unpublish without deleting (Back Office). Unpublished sites 404
// publicly but the row (and its config) is kept so the owner can republish.
app.patch('/api/personal-site', (req, res) => {
  const email = getSessionEmail(req);
  if (!email) return res.status(401).json({ error: 'Please sign in.' });
  const published = req.body && req.body.published ? 1 : 0;

  // Which site. This used to update every row for the email, which was
  // harmless when a user could only have one site and is not now: pressing
  // Publish on one card would have put all of them on the internet at once.
  const wanted = (req.body && typeof req.body.subdomain === 'string')
    ? _validSubdomain(req.body.subdomain) : null;
  if (req.body && req.body.subdomain && !wanted) return res.status(400).json({ error: 'invalid_subdomain' });
  const row = wanted
    ? db.prepare('SELECT subdomain, email FROM personal_sites WHERE subdomain = ?').get(wanted)
    : _currentSite(email);
  if (!row) return res.status(404).json({ error: 'No site to update.' });
  if (row.email.toLowerCase() !== email.toLowerCase()) return res.status(403).json({ error: 'not_yours' });

  db.prepare('UPDATE personal_sites SET published = ?, updated_at = ? WHERE subdomain = ?')
    .run(published, Date.now(), row.subdomain);
  // Only ever one live site — the same rule the publish path enforces, for the
  // same reason: two versions of the same person on the internet is the failure.
  if (published === 1) {
    db.prepare('UPDATE personal_sites SET published = 0 WHERE email = ? AND subdomain != ?')
      .run(email.toLowerCase(), row.subdomain);
  }
  res.json({ success: true, published: !!published, subdomain: row.subdomain });
});

// Unpublish (delete) the signed-in user's personal site.
app.delete('/api/personal-site', (req, res) => {
  const email = getSessionEmail(req);
  if (!email) return res.status(401).json({ error: 'Please sign in.' });
  db.prepare('DELETE FROM personal_sites WHERE email = ?').run(email.toLowerCase());
  _deleteAllMediaForEmail(email);
  res.json({ success: true });
});

// Public render of a personal site — indexable, watermark-free.
// Public render of a personal site. `:page` (optional) selects a page in a v2
// site document; v1/legacy sites ignore it and always render their single page.
/**
 * Where an address that no longer hosts a site should send someone.
 *
 * A 301 rather than a page: the person holding the old link wants the site,
 * not an explanation. Search engines move their ranking across too, which
 * matters for a page whose whole job is being found.
 *
 * Only forwards to a site that is actually live — forwarding to a draft would
 * bounce them from one 404 to another.
 */
function _movedTarget(sub, origin, pageSlug) {
  const alias = db.prepare('SELECT new_sub FROM site_aliases WHERE old_sub = ?').get(sub);
  if (!alias) return null;
  const live = db.prepare('SELECT subdomain FROM personal_sites WHERE subdomain = ? AND published = 1').get(alias.new_sub);
  if (!live) return null;
  return sitePublicUrl(live.subdomain, origin, pageSlug);
}

function _serveSite(req, res, pageSlug) {
  const sub = _validSubdomain(req.params.sub);
  const row = sub ? db.prepare('SELECT * FROM personal_sites WHERE subdomain = ? AND published = 1').get(sub) : null;
  if (!row) {
    const origin = `${req.protocol}://${req.get('host')}`;
    const moved = sub ? _movedTarget(sub, origin, pageSlug) : null;
    if (moved) return res.redirect(301, moved);
    res.status(404);
    return res.sendFile(path.join(__dirname, 'public', '404.html'));
  }
  // A page slug that doesn't exist in the document is a 404, not a silent home page.
  if (pageSlug) {
    let cfg = null; try { cfg = row.config ? JSON.parse(row.config) : null; } catch (_) {}
    const pages = cfg && Array.isArray(cfg.pages) ? cfg.pages : null;
    if (!pages || !pages.some((p) => String(p && p.slug || '').toLowerCase() === pageSlug)) {
      res.status(404);
      return res.sendFile(path.join(__dirname, 'public', '404.html'));
    }
  }
  try { db.prepare('UPDATE personal_sites SET views = views + 1 WHERE subdomain = ?').run(sub); } catch (_) {}
  _recordVisit(sub, req);
  const origin = `${req.protocol}://${req.get('host')}`;
  res.setHeader('Content-Type', 'text/html; charset=utf-8');
  res.setHeader('Cache-Control', 'no-cache');
  res.send(_renderPersonalSite(row, origin, {
    indexable: true,
    footer: '', // Pro personal sites are watermark-free
    canonicalUrl: `${origin}/site/${sub}${pageSlug ? '/' + pageSlug : ''}`,
    baseUrl: `${origin}/site/${sub}`,
    page: pageSlug || '',
  }));
}
// The cover letter behind the download button. Published sites only — an
// unpublished draft must not leak it any more than it leaks the page itself.
app.get('/site/:sub/cover-letter', (req, res) => {
  const sub = _validSubdomain(req.params.sub);
  const row = sub ? db.prepare('SELECT * FROM personal_sites WHERE subdomain = ? AND published = 1').get(sub) : null;
  if (!row) {
    const moved = sub ? _movedTarget(sub, `${req.protocol}://${req.get('host')}`, 'cover-letter') : null;
    if (moved) return res.redirect(301, moved);
    res.status(404); return res.sendFile(path.join(__dirname, 'public', '404.html'));
  }
  let cfg = null; try { cfg = row.config ? JSON.parse(row.config) : null; } catch (_) { cfg = null; }
  const text = cfg && cfg.assets && typeof cfg.assets.coverLetterText === 'string' ? cfg.assets.coverLetterText : '';
  if (!text.trim()) { res.status(404); return res.sendFile(path.join(__dirname, 'public', '404.html')); }
  const name = String(row.name || sub).replace(/[^A-Za-z0-9 _-]/g, '').trim() || sub;
  res.setHeader('Content-Type', 'text/plain; charset=utf-8');
  res.setHeader('Content-Disposition', `attachment; filename="${name} - Cover Letter.txt"`);
  res.send(text);
});

// Registered before the generic /site/:sub/:page catch-all, the same reason
// /cover-letter above is: "llms.txt" would otherwise be treated as a page
// slug, fail to match any real page, and 404.
app.get('/site/:sub/llms.txt', (req, res) => {
  const sub = _validSubdomain(req.params.sub);
  const row = sub ? db.prepare('SELECT * FROM personal_sites WHERE subdomain = ? AND published = 1').get(sub) : null;
  const origin = `${req.protocol}://${req.get('host')}`;
  if (!row) {
    // Not routed through _movedTarget()/sitePublicUrl()'s pageSlug argument:
    // that strips anything outside [a-z0-9-], which would turn "llms.txt"
    // into "llmstxt". Appended after the plain base URL instead.
    const alias = sub ? db.prepare('SELECT new_sub FROM site_aliases WHERE old_sub = ?').get(sub) : null;
    const live = alias ? db.prepare('SELECT subdomain FROM personal_sites WHERE subdomain = ? AND published = 1').get(alias.new_sub) : null;
    if (live) return res.redirect(301, `${sitePublicUrl(live.subdomain, origin)}/llms.txt`);
    res.status(404); return res.sendFile(path.join(__dirname, 'public', '404.html'));
  }
  _serveLlmsTxt(row, origin, res);
});

app.get('/site/:sub', (req, res) => _serveSite(req, res, ''));
app.get('/site/:sub/:page', (req, res) => _serveSite(req, res, String(req.params.page || '').toLowerCase().slice(0, 60)));

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

// ─── Free-tier template allow-list ────────────────────────────────────────────
// Kept in sync with the `free:true` entries in OUT_TPLS (public/app.html): the
// only free templates are Classic/Executive/Minimal (resume) and
// Formal/Bold/Clean (cover). Every other template is Pro. Template gating is
// enforced server-side here — not just in the client picker — so a crafted API
// call can't render a Pro layout or a Pro color variant. A template is
// identified by (layout + primary color) so both the layout AND the specific
// color must match a free template. See PLAN.md §2.
const FREE_TPL_SIGS = new Set([
  'rClassic|1a237e', 'rExecutive|004d40', 'rMinimal|b71c1c', // resume: Classic, Executive, Minimal
  'cFormal|0c4a6e', 'cBold|7c2d12', 'cClean|1e293b',         // cover:  Formal, Bold, Clean
]);
function _tplSig(meta) {
  if (!meta || !meta.layout) return null;
  const prim = String((meta.colors && meta.colors.primary) || '').replace('#', '').toLowerCase().slice(0, 6);
  return `${meta.layout}|${prim}`;
}
// True when the chosen template metadata is one of the free templates. Missing/
// empty metadata (legacy single-column path) counts as free — it uses no
// premium layout.
function isFreeTemplateMeta(meta) {
  if (!meta || !meta.layout) return true;
  const sig = _tplSig(meta);
  return sig ? FREE_TPL_SIGS.has(sig) : false;
}

// ─── API: Free Tool — ATS Keyword Extractor ──────────────────────────────────
const keywordExtractorLimiter = rateLimit({ windowMs: 60 * 1000, max: 8, message: { error: 'rate_limited', message: 'Too many requests — please wait a minute and try again.' } });

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
    stripePrice: !!process.env.STRIPE_PRICE_ID,
    rapidapi: !!process.env.RAPIDAPI_KEY
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

  const email = getSessionEmail(req);
  const subscribed = isSubscriber(email);
  // ATS scanner is a free-tier feature and now unlimited — no per-day cap.

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

    res.json(result);
  } catch(e) {
    console.error('ATS scan error:', e.message);
    res.status(500).json({ error: 'Analysis failed. Please try again.' });
  }
});

// ─── API: Tailor resume ───────────────────────────────────────────────────────
// Per-IP rate limit for the (now unlimited-and-free) tailoring endpoint. The
// free tier no longer has a daily cap, so this limiter is what protects the
// Anthropic API budget from a runaway client or abuse. Generous enough for a
// real user iterating on several applications in a sitting.
const tailorLimiter = rateLimit({ windowMs: 60 * 1000, max: 20, message: { error: 'rate_limited', message: 'You\'re tailoring very quickly — please wait a minute and try again.' } });

app.post('/api/tailor', tailorLimiter, async (req, res) => {
  const { resume, jobPosting, mode } = req.body;

  if (!['resume', 'cover_letter', 'both'].includes(mode)) {
    return res.status(400).json({ error: 'Invalid mode.' });
  }
  if (!jobPosting) {
    return res.status(400).json({ error: 'Job posting is required.' });
  }
  if (mode !== 'cover_letter' && !resume) {
    return res.status(400).json({ error: 'Resume is required.' });
  }

  // Tailoring requires a signed-in account. The free tier is now unlimited, so
  // an account — not a per-day cap — is what guards against anonymous API-cost
  // abuse. The dashboard already forces login before this screen is reachable.
  // Using the session email (not a body-supplied one) also prevents spoofing
  // someone else's subscription status.
  const email = getSessionEmail(req);
  if (!email) {
    return res.status(401).json({ error: 'login_required', message: 'Please sign in to tailor your resume — it\'s free and unlimited.' });
  }

  const subscribed = isSubscriber(email);
  // Free tier now includes unlimited resumes and cover letters — no per-day
  // gating here anymore. Pro-only features (video, personal website, premium
  // templates) are gated at their own routes.

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

    // Free tier is unlimited now — nothing to consume.

    res.json({ result: message.content[0].text });

    const who = email;
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

  // LinkedIn optimization is a free-tier feature and now unlimited — no cap.
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
    const isEmployer = session.metadata?.plan === 'employer';
    if (email && isEmployer) {
      db.prepare('INSERT OR REPLACE INTO employer_subscribers (email, customer_id) VALUES (?, ?)').run(email, session.customer);
      console.log(`New Pro Employer subscriber: ${email}`);
      notifyOwner(`[ResumeTailored] 💼 New Pro Employer subscriber: ${email}`,
        `<p>💼 <strong>${email}</strong> just subscribed — <strong>Pro Employer ($29/mo)</strong>.</p>`);
    } else if (email) {
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
    // Look up the email before deleting so we can name them in the alert. Check
    // both subscriber tables — a canceled subscription's customer_id could
    // belong to either the job-seeker or the employer plan.
    const row = db.prepare('SELECT email FROM subscribers WHERE customer_id = ?').get(customerId);
    const employerRow = db.prepare('SELECT email FROM employer_subscribers WHERE customer_id = ?').get(customerId);
    db.prepare('DELETE FROM subscribers WHERE customer_id = ?').run(customerId);
    db.prepare('DELETE FROM employer_subscribers WHERE customer_id = ?').run(customerId);
    console.log(`Removed subscriber with customer_id: ${customerId}`);
    const who = row?.email || employerRow?.email || customerId;
    const label = employerRow ? ' (Pro Employer)' : '';
    notifyOwner(`[ResumeTailored] Subscription canceled: ${who}${label}`,
      `<p>👋 <strong>${who}</strong>'s subscription${label} was canceled.</p>`);
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

// ═══════════════════════════════════════════════════════════════════════════
// ─── Career Hub ──────────────────────────────────────────────────────────────
// Profession-first career platform: one saved profession drives the Skills Lab,
// Interview Prep, Job Finder, Gap Analyzer, Dashboard and Scenario Lab. Pure
// logic (taxonomy, prompts, validators, scoring) lives in career-hub.js (CH).
// ═══════════════════════════════════════════════════════════════════════════

// The user's target profession, resolved from their check-in row. Single
// source of truth every tool reads.
function getUserProfession(email) {
  if (!email) return null;
  const row = db.prepare('SELECT profession_id, seniority FROM check_ins WHERE email = ?').get(email.toLowerCase());
  if (!row || !row.profession_id) return null;
  return CH.resolveProfession(row.profession_id, row.seniority);
}
function careerEmail(req, res) {
  const email = getSessionEmail(req);
  if (!email) { res.status(401).json({ error: 'login_required', message: 'Please sign in to use the Career Hub.' }); return null; }
  return email;
}
// The UI language for this request (drives in-language AI generation + caching).
function _reqLang(req) {
  const l = (req.query && req.query.lang) || (req.body && req.body.lang) || 'en';
  return l === 'zh' ? 'zh' : 'en';
}
function requireProfession(res, email) {
  const prof = getUserProfession(email);
  if (!prof) { res.status(400).json({ error: 'no_profession', message: 'Set your target profession first.' }); return null; }
  return prof;
}

// ── Free-tier quotas (Pro = unlimited). Reuses the existing usage_store. ─────
function _isoWeekStamp(d) {
  const dt = new Date(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()));
  const day = dt.getUTCDay() || 7;
  dt.setUTCDate(dt.getUTCDate() + 4 - day);
  const yearStart = new Date(Date.UTC(dt.getUTCFullYear(), 0, 1));
  const week = Math.ceil((((dt - yearStart) / 86400000) + 1) / 7);
  return `${dt.getUTCFullYear()}W${week}`;
}
function _quotaKey(userKey, type, period) {
  const now = new Date();
  if (period === 'week') return `${userKey}_${type}_${_isoWeekStamp(now)}`;
  if (period === 'total') return `${userKey}_${type}_total`;
  return `${userKey}_${type}_${now.toISOString().slice(0, 10)}`;
}
function _quotaUsed(userKey, type, period) {
  const row = db.prepare('SELECT count FROM usage_store WHERE key = ?').get(_quotaKey(userKey, type, period));
  return row ? row.count : 0;
}
function _quotaConsume(userKey, type, period) {
  db.prepare('INSERT INTO usage_store (key, count) VALUES (?, 1) ON CONFLICT(key) DO UPDATE SET count = count + 1')
    .run(_quotaKey(userKey, type, period));
}

// Generate JSON from Claude with a one-shot retry if the first output does not
// validate. Throws { code:'llm_json_invalid' } if both attempts fail.
async function callClaudeJSON({ model, system, user, max_tokens, validate }) {
  let lastErr = 'unknown';
  for (let attempt = 0; attempt < 2; attempt++) {
    const content = attempt === 0 ? user
      : user + '\n\nYour previous response was not valid JSON. Return ONLY the JSON object described above — no markdown, no commentary.';
    const msg = await anthropic.messages.create({ model, max_tokens, system, messages: [{ role: 'user', content }] });
    const obj = CH.extractJson(msg.content[0] && msg.content[0].text);
    const v = validate(obj);
    if (v.ok) return v.value;
    lastErr = v.error || 'invalid';
  }
  const e = new Error('llm_json_invalid: ' + lastErr); e.code = 'llm_json_invalid'; throw e;
}

const careerGenLimiter = rateLimit({ windowMs: 60 * 1000, max: 15, message: { error: 'rate_limited', message: 'Slow down a moment and try again.' } });
const jobSearchLimiter = rateLimit({ windowMs: 60 * 1000, max: 15, message: { error: 'rate_limited', message: 'Too many searches — wait a minute.' } });
const answerScoreLimiter = rateLimit({ windowMs: 60 * 1000, max: 10, message: { error: 'rate_limited', message: 'Too many requests — wait a minute.' } });

// ─── Phase 0: Profession selector ───────────────────────────────────────────
app.get('/api/profession', (req, res) => {
  const email = careerEmail(req, res); if (!email) return;
  const prof = getUserProfession(email);
  res.json(prof || {});
});
app.post('/api/profession', (req, res) => {
  const email = careerEmail(req, res); if (!email) return;
  const { professionId, seniority } = req.body || {};
  const data = CH.loadProfessions();
  if (!CH.validateProfessionId(professionId, data)) return res.status(400).json({ error: 'invalid_profession' });
  const sen = CH.validateSeniority(seniority) ? (seniority || '') : '';
  const lang = _reqLang(req);
  const prof = CH.resolveProfession(professionId, sen, data);
  const e = email.toLowerCase();
  const existing = db.prepare('SELECT email FROM check_ins WHERE email = ?').get(e);
  if (existing) {
    db.prepare('UPDATE check_ins SET profession_id = ?, profession_cat = ?, seniority = ?, profession_set_at = ?, lang = ? WHERE email = ?')
      .run(prof.id, prof.category, sen, Date.now(), lang, e);
  } else {
    db.prepare('INSERT INTO check_ins (email, last_check_in, goals, current_role, target_role, next_prompt, profession_id, profession_cat, seniority, profession_set_at, lang) VALUES (?,?,?,?,?,?,?,?,?,?,?)')
      .run(e, null, '', '', '', '', prof.id, prof.category, sen, Date.now(), lang);
  }
  res.json(prof);
});

// ─── Phase 1: Skills Lab ────────────────────────────────────────────────────
app.post('/api/skills-lab/quiz', careerGenLimiter, async (req, res) => {
  const email = careerEmail(req, res); if (!email) return;
  const prof = requireProfession(res, email); if (!prof) return;
  const pro = isSubscriber(email);
  const topic = (req.body && req.body.topic ? String(req.body.topic) : '').slice(0, 80);
  const lang = _reqLang(req);
  const userKey = getUsageKey(req);
  // Free tier: 1 quiz + 1 retake per day.
  const freeCap = CH.LIMITS.quiz.free + CH.LIMITS.retake.free;
  if (!pro && _quotaUsed(userKey, 'quiz', 'day') >= freeCap) {
    return res.status(402).json({ error: 'quota', message: 'Free plan is 1 quiz + 1 retake per day. Upgrade to Pro for unlimited quizzes and all topics.' });
  }
  try {
    const key = CH.quizCacheKey(prof.id, prof.seniority, topic, lang);
    let payload;
    const cached = db.prepare('SELECT payload FROM quiz_cache WHERE cache_key = ?').get(key);
    if (cached) {
      payload = JSON.parse(cached.payload);
    } else {
      const p = CH.buildQuizPrompt(prof, topic, lang);
      payload = await callClaudeJSON({ model: 'claude-haiku-4-5', system: p.system, user: p.user, max_tokens: 2600, validate: CH.validateQuiz });
      db.prepare('INSERT OR REPLACE INTO quiz_cache (cache_key, profession_id, seniority, topic, payload, created_at) VALUES (?,?,?,?,?,?)')
        .run(key, prof.id, prof.seniority, topic, JSON.stringify(payload), Date.now());
    }
    if (!pro) _quotaConsume(userKey, 'quiz', 'day');
    const seed = Date.now() + '-' + Math.random();
    res.json({ quizKey: key, topic: topic || 'general', seed, quiz: CH.quizForDelivery(payload, seed) });
  } catch (err) {
    console.error('skills-lab/quiz error:', err.message);
    res.status(503).json({ error: 'quiz_unavailable', message: 'Could not build a quiz right now — please try again.' });
  }
});

app.post('/api/skills-lab/submit', async (req, res) => {
  const email = careerEmail(req, res); if (!email) return;
  const prof = requireProfession(res, email); if (!prof) return;
  const pro = isSubscriber(email);
  const { quizKey, topic, answers, orders } = req.body || {};
  const cached = quizKey && db.prepare('SELECT payload, topic FROM quiz_cache WHERE cache_key = ?').get(quizKey);
  if (!cached) return res.status(400).json({ error: 'bad_quiz', message: 'Quiz expired — please retake.' });
  const payload = JSON.parse(cached.payload);
  const scored = CH.scoreQuiz(payload, { answers, orders });
  const finalBand = CH.cappedBand(scored.score, pro);
  const topicVal = (topic || cached.topic || '').slice(0, 80);
  db.prepare('INSERT INTO skill_attempts (email, profession_id, topic, score, band, taken_at) VALUES (?,?,?,?,?,?)')
    .run(email.toLowerCase(), prof.id, topicVal, scored.score, finalBand || '', Date.now());
  let badge = null;
  if (finalBand) {
    const slug = CH.badgeSlug();
    db.prepare('INSERT INTO badges (slug, email, profession_id, topic, band, score, created_at) VALUES (?,?,?,?,?,?,?)')
      .run(slug, email.toLowerCase(), prof.id, topicVal, finalBand, scored.score, Date.now());
    badge = { slug, band: finalBand, url: `/badge/${slug}` };
  }
  const goldLocked = !pro && CH.band(scored.score) === 'gold';
  res.json({ score: scored.score, correct: scored.correct, total: scored.total, band: finalBand, results: scored.results, badge, goldLocked });
});

app.get('/api/skills-lab/attempts', (req, res) => {
  const email = careerEmail(req, res); if (!email) return;
  const rows = db.prepare('SELECT profession_id, topic, score, band, taken_at FROM skill_attempts WHERE email = ? ORDER BY taken_at DESC LIMIT 100').all(email.toLowerCase());
  res.json({ attempts: rows });
});

// Public shareable badge page (OG-tagged, branded).
app.get('/badge/:slug', (req, res) => {
  const row = db.prepare('SELECT * FROM badges WHERE slug = ?').get(req.params.slug);
  if (!row) return res.status(404).sendFile(path.join(__dirname, 'public', '404.html'));
  const user = db.prepare('SELECT username FROM users WHERE email = ?').get(row.email);
  const prof = CH.resolveProfession(row.profession_id) || { label: 'Professional' };
  const origin = `${req.protocol}://${req.get('host')}`;
  const lang = req.query.lang === 'zh' ? 'zh' : 'en';
  res.setHeader('Content-Type', 'text/html; charset=utf-8');
  res.send(renderBadgePage({
    slug: row.slug, name: user && user.username, professionLabel: lang === 'zh' ? prof.labelZh : prof.label,
    topic: row.topic, band: row.band, score: row.score, created_at: row.created_at
  }, origin, lang));
});

// ─── Phase 2: Interview Prep ────────────────────────────────────────────────
app.post('/api/interview/questions', careerGenLimiter, async (req, res) => {
  const email = careerEmail(req, res); if (!email) return;
  const prof = requireProfession(res, email); if (!prof) return;
  const pro = isSubscriber(email);
  let kind = (req.body && req.body.kind) === 'technical' ? 'technical' : 'behavioral';
  if (kind === 'technical' && !pro) return res.status(402).json({ error: 'pro_only', message: 'Technical interview questions are a Pro feature. Behavioral questions are free.' });
  const lang = _reqLang(req);
  try {
    const key = CH.interviewCacheKey(prof.id, prof.seniority, kind, lang);
    let payload;
    const cached = db.prepare('SELECT payload FROM interview_cache WHERE cache_key = ?').get(key);
    if (cached) {
      payload = JSON.parse(cached.payload);
    } else {
      const p = CH.buildInterviewPrompt(prof, kind, lang);
      payload = await callClaudeJSON({ model: 'claude-haiku-4-5', system: p.system, user: p.user, max_tokens: 2800, validate: CH.validateInterview });
      db.prepare('INSERT OR REPLACE INTO interview_cache (cache_key, profession_id, seniority, kind, payload, created_at) VALUES (?,?,?,?,?,?)')
        .run(key, prof.id, prof.seniority, kind, JSON.stringify(payload), Date.now());
    }
    // Attach a stable per-question hash so the client can post confidence back.
    const questions = payload.questions.map(q => ({ ...q, hash: CH.sha256(prof.id + '|' + q.prompt).slice(0, 16) }));
    res.json({ kind, questions });
  } catch (err) {
    console.error('interview/questions error:', err.message);
    res.status(503).json({ error: 'unavailable', message: 'Could not load questions — please try again.' });
  }
});

app.post('/api/interview/progress', (req, res) => {
  const email = careerEmail(req, res); if (!email) return;
  const prof = requireProfession(res, email); if (!prof) return;
  const { questionHash, confidence } = req.body || {};
  if (!questionHash) return res.status(400).json({ error: 'bad_request' });
  const c = Math.max(1, Math.min(5, parseInt(confidence, 10) || 3));
  db.prepare('INSERT INTO interview_progress (email, profession_id, question_hash, confidence, practiced_at) VALUES (?,?,?,?,?) ON CONFLICT(email, question_hash) DO UPDATE SET confidence = excluded.confidence, practiced_at = excluded.practiced_at')
    .run(email.toLowerCase(), prof.id, String(questionHash).slice(0, 32), c, Date.now());
  res.json({ success: true });
});

// Pro: "Score my answer" — per-answer feedback (Sonnet).
app.post('/api/interview/score', answerScoreLimiter, async (req, res) => {
  const email = careerEmail(req, res); if (!email) return;
  if (!isSubscriber(email)) return res.status(402).json({ error: 'pro_only', message: 'Upgrade to Pro to get AI feedback on your answers.' });
  const prof = requireProfession(res, email); if (!prof) return;
  const { question, answer } = req.body || {};
  if (!question || !answer) return res.status(400).json({ error: 'bad_request' });
  // Pro, but additionally capped per day — the priciest per-call feature.
  const userKey = getUsageKey(req);
  if (_quotaUsed(userKey, 'answerscore', 'day') >= CH.LIMITS.answerScore.pro) {
    return res.status(402).json({ error: 'quota', message: `You've used all ${CH.LIMITS.answerScore.pro} answer scorings for today — back tomorrow.` });
  }
  try {
    const msg = await anthropic.messages.create({
      model: 'claude-sonnet-4-6', max_tokens: 700,
      system: 'You are an interview coach. Give concise, specific, encouraging feedback on a candidate\'s answer. Output ONLY valid JSON: {"rating":<1-5>,"strengths":["..."],"improvements":["..."],"revised":"a tighter example answer"}.' + CH.langInstruction(_reqLang(req)),
      messages: [{ role: 'user', content: `Role: ${prof.displayLabel}\nQUESTION: ${String(question).slice(0, 600)}\nCANDIDATE ANSWER: ${String(answer).slice(0, 1500)}` }]
    });
    const obj = CH.extractJson(msg.content[0] && msg.content[0].text) || { rating: 3, strengths: [], improvements: [], revised: '' };
    _quotaConsume(userKey, 'answerscore', 'day');
    res.json(obj);
  } catch (err) {
    console.error('interview/score error:', err.message);
    res.status(503).json({ error: 'unavailable' });
  }
});

// ─── Phase 3: Skills Gap Analyzer ───────────────────────────────────────────
app.post('/api/skills-gap', careerGenLimiter, async (req, res) => {
  const email = careerEmail(req, res); if (!email) return;
  const pro = isSubscriber(email);
  const userKey = getUsageKey(req);
  if (!pro && _quotaUsed(userKey, 'gap', 'week') >= CH.LIMITS.gap.free) {
    return res.status(402).json({ error: 'quota', message: 'Free plan includes 1 gap analysis per week. Upgrade to Pro for unlimited.' });
  }
  let { resume, resumeId, jobText, savedJobId } = req.body || {};
  const e = email.toLowerCase();
  if (!resume && resumeId) {
    const r = db.prepare('SELECT content FROM saved_resumes WHERE id = ? AND email = ?').get(resumeId, e);
    if (r) resume = r.content;
  }
  if (!jobText && savedJobId) {
    const j = db.prepare('SELECT snapshot FROM saved_jobs WHERE job_id = ? AND email = ?').get(savedJobId, e);
    if (j && j.snapshot) { try { const s = JSON.parse(j.snapshot); jobText = [s.title, s.company, s.descriptionSnippet].filter(Boolean).join('\n'); } catch (_) {} }
  }
  if (!resume || !jobText) return res.status(400).json({ error: 'bad_request', message: 'A resume and a job description are both required.' });
  const lang = _reqLang(req);
  try {
    const key = CH.gapCacheKey(resume, jobText, lang);
    let payload;
    const cached = db.prepare('SELECT payload FROM gap_cache WHERE cache_key = ?').get(key);
    if (cached) {
      payload = JSON.parse(cached.payload);
    } else {
      const p = CH.buildGapPrompt(resume, jobText, lang);
      payload = await callClaudeJSON({ model: 'claude-sonnet-4-6', system: p.system, user: p.user, max_tokens: 1600, validate: CH.validateGap });
      db.prepare('INSERT OR REPLACE INTO gap_cache (cache_key, payload, created_at) VALUES (?,?,?)').run(key, JSON.stringify(payload), Date.now());
    }
    db.prepare('INSERT INTO gap_reports (email, resume_id, job_id, match_score, payload, created_at) VALUES (?,?,?,?,?,?)')
      .run(e, resumeId || null, savedJobId || null, payload.matchScore, JSON.stringify(payload), Date.now());
    if (!pro) _quotaConsume(userKey, 'gap', 'week');
    res.json(payload);
  } catch (err) {
    console.error('skills-gap error:', err.message);
    res.status(503).json({ error: 'unavailable', message: 'Could not analyze right now — please try again.' });
  }
});

app.get('/api/skills-gap/reports', (req, res) => {
  const email = careerEmail(req, res); if (!email) return;
  const rows = db.prepare('SELECT id, resume_id, job_id, match_score, payload, created_at FROM gap_reports WHERE email = ? ORDER BY created_at DESC LIMIT 20').all(email.toLowerCase());
  res.json({ reports: rows.map(r => ({ id: r.id, matchScore: r.match_score, createdAt: r.created_at, report: JSON.parse(r.payload) })) });
});

// ─── Phase 4: Job Finder (JSearch proxy) ────────────────────────────────────
async function jsearchFetch(params) {
  const key = process.env.RAPIDAPI_KEY;
  if (!key) { const e = new Error('jobs_unconfigured'); e.code = 'jobs_unconfigured'; throw e; }
  const qs = new URLSearchParams({ query: params.query, page: String(params.page || 1), num_pages: '1' });
  if (params.datePosted) qs.set('date_posted', params.datePosted);
  if (params.remote === 'remote') qs.set('remote_jobs_only', 'true');
  if (params.jobType) qs.set('employment_types', params.jobType);
  const r = await fetch(`https://jsearch.p.rapidapi.com/search?${qs.toString()}`, {
    headers: { 'X-RapidAPI-Key': key, 'X-RapidAPI-Host': 'jsearch.p.rapidapi.com' }
  });
  // RapidAPI-hosted APIs don't always signal quota-exceeded / provider errors
  // with a non-2xx status — many (JSearch included) return HTTP 200 with an
  // error-shaped body. If we trusted r.ok alone, a quota-exceeded response
  // reads as a legitimate "zero jobs" result, which then gets cached for 6h
  // and silently served to every user searching anything — see
  // isValidJsearchResponse's comment for the full story.
  if (!r.ok) { const e = new Error('jsearch_http_' + r.status); e.code = 'jsearch_error'; throw e; }
  const json = await r.json();
  if (!CH.isValidJsearchResponse(json)) {
    const e = new Error('jsearch_bad_response: ' + JSON.stringify(json).slice(0, 300));
    e.code = 'jsearch_error';
    throw e;
  }
  return json;
}
const JOB_CACHE_TTL = 60 * 60 * 1000; // 1h — shorter than before so a search reflects fresh listings sooner
app.get('/api/jobs/search', jobSearchLimiter, async (req, res) => {
  const email = careerEmail(req, res); if (!email) return;
  const pro = isSubscriber(email);
  const userKey = getUsageKey(req);
  if (!pro && _quotaUsed(userKey, 'jobsearch', 'day') >= CH.LIMITS.jobsearch.free) {
    return res.status(402).json({ error: 'quota', message: `Free plan is ${CH.LIMITS.jobsearch.free} job searches per day. Upgrade to Pro for unlimited.` });
  }
  const prof = getUserProfession(email);
  // Keyword-only search is fully supported: buildJobQuery falls back to the
  // saved profession label (or "jobs"), and an EMPTY location deliberately
  // means NATIONWIDE — no location is ever forced into the query.
  const query = CH.buildJobQuery(req.query.query, prof);
  const location = (req.query.location || '').toString().slice(0, 80);
  const params = {
    query, location,
    page: parseInt(req.query.page, 10) || 1,
    remote: req.query.remote || '', datePosted: req.query.datePosted || '', jobType: req.query.jobType || ''
  };
  const key = CH.jobCacheKey(params);
  try {
    const cached = db.prepare('SELECT payload, fetched_at FROM job_cache WHERE cache_key = ?').get(key);
    if (cached && (Date.now() - cached.fetched_at) < JOB_CACHE_TTL) {
      if (!pro) _quotaConsume(userKey, 'jobsearch', 'day');
      const c = JSON.parse(cached.payload);
      return res.json({ jobs: c.jobs || c, query, profession: prof ? prof.label : null, sources: c.sources, cached: true });
    }
    // Fan out across every configured provider. A single provider failing
    // (e.g. JSearch 403) no longer empties the whole result.
    const { jobs, sources, anyKeyedConfigured } = await JP.searchJobs(params);
    if (jobs.length) {
      db.prepare('INSERT OR REPLACE INTO job_cache (cache_key, payload, fetched_at) VALUES (?,?,?)')
        .run(key, JSON.stringify({ jobs, sources }), Date.now());
      if (!pro) _quotaConsume(userKey, 'jobsearch', 'day');
      // Surface a note when only the zero-key remote fallbacks answered, so
      // the result set isn't silently missing on-site/US listings.
      const onlyFallbacks = !sources.some(s => s.ok && s.keyed && s.count > 0);
      return res.json({ jobs, query, profession: prof ? prof.label : null, sources, onlyFallbacks });
    }
    // Zero jobs. Distinguish "providers errored" from "genuinely no matches"
    // so we never fail silently.
    const keyedFailed = sources.filter(s => s.keyed && !s.ok);
    if (keyedFailed.length) {
      console.error('jobs/search: keyed provider(s) failed:', keyedFailed.map(s => `${s.name}:${s.error}`).join(', '));
      // Serve any stale cache for this exact query rather than a dead page.
      const stale = db.prepare('SELECT payload, fetched_at FROM job_cache WHERE cache_key = ?').get(key);
      if (stale) {
        if (!pro) _quotaConsume(userKey, 'jobsearch', 'day');
        const c = JSON.parse(stale.payload);
        return res.json({ jobs: c.jobs || c, query, profession: prof ? prof.label : null, stale: true, staleAt: stale.fetched_at });
      }
      return res.status(502).json({
        error: 'jobs_error',
        message: 'The job data source is temporarily unavailable. Please try again shortly.',
        sources: keyedFailed.map(s => ({ name: s.name, error: s.error }))
      });
    }
    if (!anyKeyedConfigured && !sources.some(s => s.ok && s.count > 0)) {
      return res.status(503).json({ error: 'jobs_unconfigured', message: 'Live job search is not fully configured yet. Add an Adzuna API key for nationwide US results.' });
    }
    if (!pro) _quotaConsume(userKey, 'jobsearch', 'day');
    return res.json({ jobs: [], query, profession: prof ? prof.label : null, sources });
  } catch (err) {
    console.error('jobs/search error:', err.message);
    const stale = db.prepare('SELECT payload, fetched_at FROM job_cache WHERE cache_key = ?').get(key);
    if (stale) {
      if (!pro) _quotaConsume(userKey, 'jobsearch', 'day');
      const c = JSON.parse(stale.payload);
      return res.json({ jobs: c.jobs || c, query, profession: prof ? prof.label : null, stale: true, staleAt: stale.fetched_at });
    }
    res.status(502).json({ error: 'jobs_error', message: 'Search is temporarily unavailable — please try again shortly.' });
  }
});
app.post('/api/jobs/save', (req, res) => {
  const email = careerEmail(req, res); if (!email) return;
  const pro = isSubscriber(email);
  const e = email.toLowerCase();
  const job = (req.body && req.body.job) || {};
  if (!job.id || !job.title) return res.status(400).json({ error: 'bad_request' });
  const count = db.prepare('SELECT COUNT(*) c FROM saved_jobs WHERE email = ?').get(e).c;
  const already = db.prepare('SELECT 1 FROM saved_jobs WHERE email = ? AND job_id = ?').get(e, job.id);
  if (!already && !pro && count >= CH.LIMITS.savedJobs.free) {
    return res.status(402).json({ error: 'quota', message: `Free plan saves up to ${CH.LIMITS.savedJobs.free} jobs. Upgrade to Pro for unlimited.` });
  }
  db.prepare('INSERT INTO saved_jobs (email, job_id, title, company, location, url, snapshot, saved_at) VALUES (?,?,?,?,?,?,?,?) ON CONFLICT(email, job_id) DO NOTHING')
    .run(e, job.id, job.title || '', job.company || '', job.location || '', job.url || '', JSON.stringify(job), Date.now());
  res.json({ success: true });
});

// ─── Job Feed Aggregator: "Jobs for You" ─────────────────────────────────────
// Reads the pre-aggregated job_feed table (refreshed every 6h by
// scripts/refresh-job-feed.js — see career-cron.js), so unlike /api/jobs/search
// this costs nothing per view and isn't quota-gated: the API budget was
// already spent once during the periodic refresh, independent of how many
// people look at the result. Employer Portal jobs (priority=1) sort first.
function _feedRowOut(r) {
  return {
    id: `${r.source}:${r.id}`, source: r.source, title: r.title, company: r.company, location: r.location,
    remote: !!r.remote, employmentType: r.job_type, postedAt: r.posted_at,
    url: r.source === 'employer' ? null : r.url,
    jobPostingId: r.source === 'employer' ? Number(r.external_id) : null,
    descriptionSnippet: (r.description || '').slice(0, 320), priority: r.priority
  };
}
app.get('/api/job-feed', (req, res) => {
  const email = careerEmail(req, res); if (!email) return;
  const prof = getUserProfession(email);
  const professionId = (req.query.professionId || (prof && prof.id) || '').toString().slice(0, 60);
  const page = Math.max(1, parseInt(req.query.page, 10) || 1);
  const limit = 20;
  const rows = professionId
    ? db.prepare('SELECT * FROM job_feed WHERE profession_id = ? ORDER BY priority DESC, posted_at DESC, fetched_at DESC LIMIT ? OFFSET ?')
        .all(professionId, limit, (page - 1) * limit)
    : db.prepare('SELECT * FROM job_feed ORDER BY priority DESC, posted_at DESC, fetched_at DESC LIMIT ? OFFSET ?')
        .all(limit, (page - 1) * limit);
  res.json({ jobs: rows.map(_feedRowOut), profession: prof ? prof.label : null, page });
});

app.get('/api/jobs/saved', (req, res) => {
  const email = careerEmail(req, res); if (!email) return;
  const rows = db.prepare('SELECT id, job_id, title, company, location, url, saved_at FROM saved_jobs WHERE email = ? ORDER BY saved_at DESC').all(email.toLowerCase());
  res.json({ jobs: rows });
});
app.delete('/api/jobs/saved/:id', (req, res) => {
  const email = careerEmail(req, res); if (!email) return;
  db.prepare('DELETE FROM saved_jobs WHERE id = ? AND email = ?').run(parseInt(req.params.id, 10), email.toLowerCase());
  res.json({ success: true });
});
// Daily job-alert digest opt-in (stored on the check-in row).
app.get('/api/jobs/alerts', (req, res) => {
  const email = careerEmail(req, res); if (!email) return;
  const row = db.prepare('SELECT job_alerts FROM check_ins WHERE email = ?').get(email.toLowerCase());
  res.json({ enabled: !!(row && row.job_alerts) });
});
app.post('/api/jobs/alerts', (req, res) => {
  const email = careerEmail(req, res); if (!email) return;
  const e = email.toLowerCase();
  const on = (req.body && req.body.enabled) ? 1 : 0;
  const lang = _reqLang(req);
  const exists = db.prepare('SELECT email FROM check_ins WHERE email = ?').get(e);
  if (exists) db.prepare('UPDATE check_ins SET job_alerts = ?, lang = ? WHERE email = ?').run(on, lang, e);
  else db.prepare('INSERT INTO check_ins (email, job_alerts, lang) VALUES (?, ?, ?)').run(e, on, lang);
  res.json({ enabled: !!on });
});

// ─── Phase 6: Scenario Lab (branching troubleshooting simulations) ──────────
app.post('/api/scenario-lab/scenario', careerGenLimiter, async (req, res) => {
  const email = careerEmail(req, res); if (!email) return;
  const prof = requireProfession(res, email); if (!prof) return;
  const pro = isSubscriber(email);
  const userKey = getUsageKey(req);
  const scenarioType = CH.SCENARIO_TYPES[req.body && req.body.scenarioType] ? req.body.scenarioType : 'customer-service';
  const lang = _reqLang(req);
  if (!pro && _quotaUsed(userKey, 'scenario', 'week') >= CH.LIMITS.scenario.free) {
    return res.status(402).json({ error: 'quota', message: 'Free plan includes 1 scenario per week. Upgrade to Pro for unlimited.' });
  }
  try {
    const key = CH.scenarioCacheKey(prof.id, scenarioType, lang);
    let payload;
    const cached = db.prepare('SELECT payload FROM scenario_cache WHERE cache_key = ?').get(key);
    if (cached) {
      payload = JSON.parse(cached.payload);
    } else {
      const p = CH.buildScenarioPrompt(prof, scenarioType, lang);
      payload = await callClaudeJSON({ model: 'claude-haiku-4-5', system: p.system, user: p.user, max_tokens: 2400, validate: CH.validateScenario });
      db.prepare('INSERT OR REPLACE INTO scenario_cache (cache_key, profession_id, scenario_type, payload, created_at) VALUES (?,?,?,?,?)')
        .run(key, prof.id, scenarioType, JSON.stringify(payload), Date.now());
    }
    if (!pro) _quotaConsume(userKey, 'scenario', 'week');
    res.json({ scenarioType, scenario: payload });
  } catch (err) {
    console.error('scenario-lab error:', err.message);
    res.status(503).json({ error: 'unavailable', message: 'Could not build a scenario — please try again.' });
  }
});
app.post('/api/scenario-lab/complete', (req, res) => {
  const email = careerEmail(req, res); if (!email) return;
  const prof = requireProfession(res, email); if (!prof) return;
  const { scenarioType, perfect } = req.body || {};
  const st = CH.SCENARIO_TYPES[scenarioType] ? scenarioType : 'customer-service';
  db.prepare('INSERT INTO scenario_progress (email, profession_id, scenario_type, completed, perfect, completed_at) VALUES (?,?,?,1,?,?) ON CONFLICT(email, profession_id, scenario_type) DO UPDATE SET completed = 1, perfect = MAX(perfect, excluded.perfect), completed_at = excluded.completed_at')
    .run(email.toLowerCase(), prof.id, st, perfect ? 1 : 0, Date.now());
  res.json({ success: true });
});

// ─── Phase 5: Career Dashboard ──────────────────────────────────────────────
app.get('/api/career/dashboard', (req, res) => {
  const email = careerEmail(req, res); if (!email) return;
  const e = email.toLowerCase();
  const prof = getUserProfession(email);
  const resumeCount = db.prepare('SELECT COUNT(*) c FROM saved_resumes WHERE email = ?').get(e).c;
  const lastResume = db.prepare('SELECT created_at FROM saved_resumes WHERE email = ? ORDER BY created_at DESC LIMIT 1').get(e);
  // Best band per topic (gold > silver > bronze).
  const attempts = db.prepare('SELECT topic, score, band FROM skill_attempts WHERE email = ?').all(e);
  const bandRank = { gold: 3, silver: 2, bronze: 1, '': 0 };
  const bestBands = {};
  for (const a of attempts) {
    const t = a.topic || 'general';
    if (!bestBands[t] || (bandRank[a.band] || 0) > (bandRank[bestBands[t].band] || 0)) bestBands[t] = { band: a.band, score: a.score };
  }
  const ip = db.prepare('SELECT COUNT(*) c, AVG(confidence) avg FROM interview_progress WHERE email = ?').get(e);
  const savedJobs = db.prepare('SELECT COUNT(*) c FROM saved_jobs WHERE email = ?').get(e).c;
  const latestGapRow = db.prepare('SELECT payload FROM gap_reports WHERE email = ? ORDER BY created_at DESC LIMIT 1').get(e);
  const latestGap = latestGapRow ? JSON.parse(latestGapRow.payload) : null;
  const scenariosDone = db.prepare('SELECT COUNT(*) c FROM scenario_progress WHERE email = ? AND completed = 1').get(e).c;
  const nextSteps = CH.computeNextSteps({
    hasProfession: !!prof, professionLabel: prof ? prof.label : null,
    resumeCount, tookQuiz: attempts.length > 0, bestBands,
    interviewPracticed: ip.c, interviewTotal: 8,
    savedJobs, latestGap, scenariosDone
  });
  res.json({
    profession: prof,
    resume: { count: resumeCount, lastAt: lastResume ? lastResume.created_at : null },
    skills: { bestBands, attempts: attempts.length },
    interview: { practiced: ip.c, avgConfidence: ip.avg ? Math.round(ip.avg * 10) / 10 : 0 },
    jobs: { saved: savedJobs },
    gap: latestGap ? { matchScore: latestGap.matchScore, topGaps: (latestGap.gaps || []).slice(0, 3) } : null,
    scenarios: { done: scenariosDone },
    nextSteps,
    isSubscriber: isSubscriber(email)
  });
});

// Pro: AI coach summary (Haiku), cached once per user per day.
app.get('/api/career/coach', async (req, res) => {
  const email = careerEmail(req, res); if (!email) return;
  if (!isSubscriber(email)) return res.status(402).json({ error: 'pro_only', message: 'The AI coach summary is a Pro feature.' });
  const e = email.toLowerCase();
  const cacheKey = `coach:${e}:${new Date().toISOString().slice(0, 10)}`;
  const cached = db.prepare('SELECT payload FROM gap_cache WHERE cache_key = ?').get(cacheKey);
  if (cached) return res.json(JSON.parse(cached.payload));
  const prof = getUserProfession(email);
  const resumeCount = db.prepare('SELECT COUNT(*) c FROM saved_resumes WHERE email = ?').get(e).c;
  const attempts = db.prepare('SELECT COUNT(*) c FROM skill_attempts WHERE email = ?').get(e).c;
  const savedJobs = db.prepare('SELECT COUNT(*) c FROM saved_jobs WHERE email = ?').get(e).c;
  try {
    const msg = await anthropic.messages.create({
      model: 'claude-haiku-4-5', max_tokens: 200,
      system: 'You are an encouraging career coach. In 2 short sentences, give the user one motivational nudge and one concrete next action. Plain text, no preamble.' + CH.langInstruction(_reqLang(req)),
      messages: [{ role: 'user', content: `Target role: ${prof ? prof.displayLabel : 'unset'}. Resumes: ${resumeCount}. Skills tests taken: ${attempts}. Saved jobs: ${savedJobs}.` }]
    });
    const payload = { summary: (msg.content[0] && msg.content[0].text || '').trim() };
    db.prepare('INSERT OR REPLACE INTO gap_cache (cache_key, payload, created_at) VALUES (?,?,?)').run(cacheKey, JSON.stringify(payload), Date.now());
    res.json(payload);
  } catch (err) {
    console.error('career/coach error:', err.message);
    res.status(503).json({ error: 'unavailable' });
  }
});

// ═══════════════════════════════════════════════════════════════════════════
// Employer Portal — Phase A: foundation. Any signed-in account can flip on
// "Hire Mode" by saving an employer profile; no separate login. Free tier is
// EH.EMPLOYER_LIMITS.freeActiveJobs (3) active posts with no ATS/search; Pro
// Employer ($29/mo, separate `employer_subscribers` table so it can never be
// confused with the $19.99 job-seeker plan) is unlimited + priority listing.
// Candidate search, ATS kanban and applications land in Phase B.
// ═══════════════════════════════════════════════════════════════════════════
function employerAuthEmail(req, res) {
  const email = getSessionEmail(req);
  if (!email) { res.status(401).json({ error: 'login_required', message: 'Please sign in first.' }); return null; }
  return email;
}
function isEmployerSubscriber(email) {
  if (!email) return false;
  const e = email.toLowerCase();
  const ownerEmail = (process.env.OWNER_EMAIL || 'support@resumetailored.com').toLowerCase();
  if (e === ownerEmail) return true;
  if (COMP_EMAILS.includes(e)) return true;
  return !!db.prepare('SELECT 1 FROM employer_subscribers WHERE email = ?').get(e);
}
function activeJobCount(email) {
  return db.prepare("SELECT COUNT(*) c FROM job_postings WHERE employer_email = ? AND status = 'active'").get(email.toLowerCase()).c;
}
const employerLimiter = rateLimit({ windowMs: 60 * 1000, max: 20, skip: () => RATE_LIMIT_OFF, message: { error: 'rate_limited', message: 'Too many requests — please wait a minute.' } });

// Is this account set up as an employer yet (has a company profile)?
app.get('/api/employer/status', (req, res) => {
  const email = employerAuthEmail(req, res); if (!email) return;
  const e = email.toLowerCase();
  const profile = db.prepare('SELECT company_name, website, created_at FROM employer_profiles WHERE email = ?').get(e);
  res.json({
    isEmployer: !!profile,
    companyName: profile ? profile.company_name : null,
    website: profile ? profile.website : null,
    pro: isEmployerSubscriber(email),
    activeJobs: profile ? activeJobCount(email) : 0,
    freeActiveJobLimit: EH.EMPLOYER_LIMITS.freeActiveJobs
  });
});

// Create/update the employer profile — this IS "turning on Hire Mode."
app.post('/api/employer/profile', employerLimiter, (req, res) => {
  const email = employerAuthEmail(req, res); if (!email) return;
  const e = email.toLowerCase();
  const companyName = String((req.body && req.body.companyName) || '').trim().slice(0, 120);
  const website = String((req.body && req.body.website) || '').trim().slice(0, 200);
  if (companyName.length < 2) return res.status(400).json({ error: 'bad_request', message: 'Company name is required.' });
  const exists = db.prepare('SELECT email FROM employer_profiles WHERE email = ?').get(e);
  if (exists) db.prepare('UPDATE employer_profiles SET company_name = ?, website = ? WHERE email = ?').run(companyName, website, e);
  else db.prepare('INSERT INTO employer_profiles (email, company_name, website, created_at) VALUES (?,?,?,?)').run(e, companyName, website, Date.now());
  res.json({ success: true, companyName, website });
});

app.get('/api/employer/jobs', (req, res) => {
  const email = employerAuthEmail(req, res); if (!email) return;
  const e = email.toLowerCase();
  const rows = db.prepare(`
    SELECT p.*, (SELECT COUNT(*) FROM job_applications a WHERE a.job_id = p.id) AS applicant_count
    FROM job_postings p WHERE p.employer_email = ? ORDER BY p.created_at DESC
  `).all(e);
  res.json({ jobs: rows.map(_jobPostingOut), pro: isEmployerSubscriber(email) });
});

function _jobPostingOut(r) {
  return {
    id: r.id, title: r.title, description: r.description, requirements: r.requirements,
    salaryMin: r.salary_min, salaryMax: r.salary_max, location: r.location,
    workMode: r.work_mode, jobType: r.job_type, isGig: !!r.is_gig, gigRate: r.gig_rate, gigSchedule: r.gig_schedule, gigType: r.gig_type,
    status: r.status, createdAt: r.created_at, updatedAt: r.updated_at, applicantCount: r.applicant_count || 0
  };
}

// Employer Portal jobs get priority placement in the aggregated Job Feed —
// synced immediately on write rather than waiting for the next 6h refresh, so
// a job seeker can find a job the moment it's posted. profession_id is a
// best-effort tag (title/keyword match against the taxonomy) purely so a
// posting can show up in someone's "Jobs for You"; an unmatched title still
// posts fine, it just won't be profession-filtered.
function _guessProfessionId(title) {
  const t = (title || '').toLowerCase();
  const all = Object.values(CH.flattenProfessions(CH.loadProfessions()));
  const hit = all.find(p => t.includes(p.label.toLowerCase()) || (p.aliases || []).some(a => t.includes(a.toLowerCase())));
  return hit ? hit.id : '';
}
function _syncEmployerJobToFeed(job) {
  if (job.status !== 'active') return _removeEmployerJobFromFeed(job.id);
  const employerProfile = db.prepare('SELECT company_name FROM employer_profiles WHERE email = ?').get(job.employer_email);
  db.prepare(`
    INSERT INTO job_feed (source, external_id, title, company, location, url, description, remote, job_type, profession_id, priority, posted_at, fetched_at)
    VALUES ('employer', ?, ?, ?, ?, ?, ?, ?, ?, ?, 1, ?, ?)
    ON CONFLICT(source, external_id) DO UPDATE SET title=excluded.title, company=excluded.company, location=excluded.location,
      description=excluded.description, remote=excluded.remote, job_type=excluded.job_type, profession_id=excluded.profession_id, fetched_at=excluded.fetched_at
  `).run(String(job.id), job.title, employerProfile ? employerProfile.company_name : '', job.location,
    `#job-${job.id}`, job.description, job.work_mode === 'remote' ? 1 : 0, job.job_type, _guessProfessionId(job.title), job.created_at, Date.now());
}
function _removeEmployerJobFromFeed(jobId) {
  db.prepare("DELETE FROM job_feed WHERE source = 'employer' AND external_id = ?").run(String(jobId));
}

app.post('/api/employer/jobs', employerLimiter, (req, res) => {
  const email = employerAuthEmail(req, res); if (!email) return;
  const e = email.toLowerCase();
  const profile = db.prepare('SELECT email FROM employer_profiles WHERE email = ?').get(e);
  if (!profile) return res.status(400).json({ error: 'no_employer_profile', message: 'Set up your company profile before posting a job.' });
  const pro = isEmployerSubscriber(email);
  if (!pro && activeJobCount(email) >= EH.EMPLOYER_LIMITS.freeActiveJobs) {
    return res.status(402).json({ error: 'quota', message: `Free plan allows ${EH.EMPLOYER_LIMITS.freeActiveJobs} active job posts. Upgrade to Pro Employer for unlimited.` });
  }
  const v = EH.validateJobPosting(req.body);
  if (!v.valid) return res.status(400).json({ error: 'bad_request', message: v.errors[0], errors: v.errors });
  const now = Date.now();
  const info = db.prepare(`
    INSERT INTO job_postings (employer_email, title, description, requirements, salary_min, salary_max, location, work_mode, job_type, is_gig, gig_rate, gig_schedule, gig_type, status, created_at, updated_at)
    VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?, 'active', ?, ?)
  `).run(e, v.clean.title, v.clean.description, v.clean.requirements, v.clean.salaryMin, v.clean.salaryMax,
    v.clean.location, v.clean.workMode, v.clean.jobType, v.clean.isGig ? 1 : 0, v.clean.gigRate, v.clean.gigSchedule, v.clean.gigType, now, now);
  const newJob = db.prepare('SELECT * FROM job_postings WHERE id = ?').get(info.lastInsertRowid);
  _syncEmployerJobToFeed(newJob);
  res.json({ success: true, id: info.lastInsertRowid });
});

app.put('/api/employer/jobs/:id', employerLimiter, (req, res) => {
  const email = employerAuthEmail(req, res); if (!email) return;
  const e = email.toLowerCase();
  const id = parseInt(req.params.id, 10);
  const job = db.prepare('SELECT * FROM job_postings WHERE id = ? AND employer_email = ?').get(id, e);
  if (!job) return res.status(404).json({ error: 'not_found' });
  // Status-only update (close/reopen) doesn't need full field re-validation.
  if (req.body && req.body.status && Object.keys(req.body).length === 1) {
    const status = String(req.body.status);
    if (!['active', 'closed'].includes(status)) return res.status(400).json({ error: 'bad_request' });
    db.prepare('UPDATE job_postings SET status = ?, updated_at = ? WHERE id = ?').run(status, Date.now(), id);
    _syncEmployerJobToFeed(db.prepare('SELECT * FROM job_postings WHERE id = ?').get(id));
    return res.json({ success: true, status });
  }
  const v = EH.validateJobPosting(req.body);
  if (!v.valid) return res.status(400).json({ error: 'bad_request', message: v.errors[0], errors: v.errors });
  db.prepare(`
    UPDATE job_postings SET title=?, description=?, requirements=?, salary_min=?, salary_max=?, location=?, work_mode=?, job_type=?, is_gig=?, gig_rate=?, gig_schedule=?, gig_type=?, updated_at=?
    WHERE id = ?
  `).run(v.clean.title, v.clean.description, v.clean.requirements, v.clean.salaryMin, v.clean.salaryMax,
    v.clean.location, v.clean.workMode, v.clean.jobType, v.clean.isGig ? 1 : 0, v.clean.gigRate, v.clean.gigSchedule, v.clean.gigType, Date.now(), id);
  _syncEmployerJobToFeed(db.prepare('SELECT * FROM job_postings WHERE id = ?').get(id));
  res.json({ success: true });
});

app.delete('/api/employer/jobs/:id', (req, res) => {
  const email = employerAuthEmail(req, res); if (!email) return;
  const e = email.toLowerCase();
  const id = parseInt(req.params.id, 10);
  const job = db.prepare('SELECT id FROM job_postings WHERE id = ? AND employer_email = ?').get(id, e);
  if (!job) return res.status(404).json({ error: 'not_found' });
  db.prepare('DELETE FROM job_applications WHERE job_id = ?').run(id);
  db.prepare('DELETE FROM job_postings WHERE id = ?').run(id);
  _removeEmployerJobFromFeed(id);
  res.json({ success: true });
});

// ─── API: Pro Employer Stripe checkout ($29/mo) ─────────────────────────────
app.post('/api/employer/subscribe', async (req, res) => {
  const email = employerAuthEmail(req, res); if (!email) return;
  const priceId = process.env.STRIPE_EMPLOYER_PRICE_ID;
  if (!priceId) return res.status(503).json({ error: 'not_configured', message: 'Pro Employer plan is not yet available.' });
  try {
    const session = await stripe.checkout.sessions.create({
      payment_method_types: ['card'],
      mode: 'subscription',
      customer_email: email,
      line_items: [{ price: priceId, quantity: 1 }],
      success_url: `${req.headers.origin || 'http://localhost:3000'}/success.html?session_id={CHECKOUT_SESSION_ID}&plan=employer`,
      cancel_url: `${req.headers.origin || 'http://localhost:3000'}/employer`,
      metadata: { email, plan: 'employer' }
    });
    res.json({ url: session.url });
  } catch (err) {
    console.error('Stripe employer error:', err);
    res.status(500).json({ error: 'Could not create checkout session.' });
  }
});

// ═══════════════════════════════════════════════════════════════════════════
// Employer Portal — Phase B: candidate database (opt-in), ATS pipeline and
// applications. Candidate visibility is strictly opt-in (`searchable`,
// defaults off) — nothing here surfaces a job seeker who hasn't flipped it on.
// Free employers get view-only applicant lists + a capped candidate search
// (EH.rankCandidates caps at 10); moving applications through the pipeline
// (status/rating/notes, the reject email) is Pro Employer ("no ATS" on free
// per the pricing table).
// ═══════════════════════════════════════════════════════════════════════════
const bandRank = { gold: 3, silver: 2, bronze: 1, '': 0 };
function _candidateBestBand(email) {
  const rows = db.prepare('SELECT band, score FROM badges WHERE email = ?').all(email);
  let best = { band: '', score: 0 };
  for (const r of rows) if ((bandRank[r.band] || 0) > (bandRank[best.band] || 0)) best = r;
  return best;
}

// ── Candidate side: opt-in visibility + applying ────────────────────────────
app.get('/api/candidate/profile', (req, res) => {
  const email = careerEmail(req, res); if (!email) return;
  const row = db.prepare('SELECT * FROM candidate_profiles WHERE email = ?').get(email.toLowerCase());
  res.json({
    searchable: !!(row && row.searchable), openToWork: !!(row && row.open_to_work),
    remotePref: (row && row.remote_pref) || 'any', location: (row && row.location) || '',
    gigAvailable: !!(row && row.gig_available), hourlyRate: row ? row.hourly_rate : null,
    gigSchedule: (row && row.gig_schedule) || '', maxTravelMi: row ? row.max_travel_mi : null
  });
});
app.post('/api/candidate/profile', (req, res) => {
  const email = careerEmail(req, res); if (!email) return;
  const v = EH.validateCandidateProfile(req.body);
  if (!v.valid) return res.status(400).json({ error: 'bad_request', message: v.errors[0], errors: v.errors });
  const e = email.toLowerCase();
  const c = v.clean;
  db.prepare(`
    INSERT INTO candidate_profiles (email, searchable, open_to_work, remote_pref, location, gig_available, hourly_rate, gig_schedule, max_travel_mi, updated_at)
    VALUES (?,?,?,?,?,?,?,?,?,?)
    ON CONFLICT(email) DO UPDATE SET searchable=excluded.searchable, open_to_work=excluded.open_to_work, remote_pref=excluded.remote_pref,
      location=excluded.location, gig_available=excluded.gig_available, hourly_rate=excluded.hourly_rate, gig_schedule=excluded.gig_schedule,
      max_travel_mi=excluded.max_travel_mi, updated_at=excluded.updated_at
  `).run(e, c.searchable ? 1 : 0, c.openToWork ? 1 : 0, c.remotePref, c.location, c.gigAvailable ? 1 : 0, c.hourlyRate, c.gigSchedule, c.maxTravelMi, Date.now());
  res.json({ success: true });
});

app.post('/api/employer/jobs/:id/apply', (req, res) => {
  const email = careerEmail(req, res); if (!email) return;
  const id = parseInt(req.params.id, 10);
  const job = db.prepare("SELECT id FROM job_postings WHERE id = ? AND status = 'active'").get(id);
  if (!job) return res.status(404).json({ error: 'not_found', message: 'This job is no longer accepting applications.' });
  const e = email.toLowerCase();
  const resumeId = Number.isInteger(req.body && req.body.resumeId) ? req.body.resumeId : null;
  const now = Date.now();
  const already = db.prepare('SELECT id FROM job_applications WHERE job_id = ? AND candidate_email = ?').get(id, e);
  if (already) return res.json({ success: true, applicationId: already.id, alreadyApplied: true });
  const info = db.prepare('INSERT INTO job_applications (job_id, candidate_email, resume_id, status, created_at, updated_at) VALUES (?,?,?,\'new\',?,?)')
    .run(id, e, resumeId, now, now);
  res.json({ success: true, applicationId: info.lastInsertRowid });
});

app.get('/api/candidate/contact-requests', (req, res) => {
  const email = careerEmail(req, res); if (!email) return;
  const rows = db.prepare(`
    SELECT cr.id, cr.employer_email, cr.message, cr.status, cr.created_at, ep.company_name
    FROM employer_contact_requests cr LEFT JOIN employer_profiles ep ON ep.email = cr.employer_email
    WHERE cr.candidate_email = ? ORDER BY cr.created_at DESC
  `).all(email.toLowerCase());
  res.json({ requests: rows.map(r => ({ id: r.id, companyName: r.company_name || r.employer_email, message: r.message, status: r.status, createdAt: r.created_at })) });
});
app.post('/api/candidate/contact-requests/:id', (req, res) => {
  const email = careerEmail(req, res); if (!email) return;
  const status = String((req.body && req.body.status) || '').toLowerCase();
  if (!['approved', 'declined'].includes(status)) return res.status(400).json({ error: 'bad_request' });
  const id = parseInt(req.params.id, 10);
  const row = db.prepare('SELECT * FROM employer_contact_requests WHERE id = ? AND candidate_email = ?').get(id, email.toLowerCase());
  if (!row) return res.status(404).json({ error: 'not_found' });
  db.prepare('UPDATE employer_contact_requests SET status = ?, updated_at = ? WHERE id = ?').run(status, Date.now(), id);
  if (status === 'approved') {
    sendEmail({
      to: row.employer_email,
      subject: `${email} approved your contact request`,
      html: `<p><strong>${email}</strong> approved your request to connect on ResumeTailored. You can reach them at this email address.</p>`
    }).catch(err => console.error('[employer] contact-approve email failed:', err.message));
  }
  res.json({ success: true, status });
});

// ── Employer side: candidate search + ATS ───────────────────────────────────
app.get('/api/employer/candidates', (req, res) => {
  const email = employerAuthEmail(req, res); if (!email) return;
  const e = email.toLowerCase();
  const employerProfile = db.prepare('SELECT email FROM employer_profiles WHERE email = ?').get(e);
  if (!employerProfile) return res.status(400).json({ error: 'no_employer_profile', message: 'Set up your company profile first.' });
  const pro = isEmployerSubscriber(email);
  const professionId = (req.query.professionId || '').toString().slice(0, 60);
  const location = (req.query.location || '').toString().toLowerCase().slice(0, 80);
  const remotePref = (req.query.remotePref || '').toString().toLowerCase();
  const gigOnly = req.query.gigOnly === '1' || req.query.gigOnly === 'true';

  let rows = db.prepare(`
    SELECT cp.email, cp.remote_pref, cp.location, cp.gig_available, cp.hourly_rate, cp.open_to_work, cp.updated_at,
           ci.profession_id, ci.seniority, u.username
    FROM candidate_profiles cp
    LEFT JOIN check_ins ci ON ci.email = cp.email
    LEFT JOIN users u ON u.email = cp.email
    WHERE cp.searchable = 1
  `).all();

  if (professionId) rows = rows.filter(r => r.profession_id === professionId);
  if (location) rows = rows.filter(r => (r.location || '').toLowerCase().includes(location));
  if (remotePref) rows = rows.filter(r => r.remote_pref === remotePref || r.remote_pref === 'any');
  if (gigOnly) rows = rows.filter(r => !!r.gig_available);

  const candidates = rows.map(r => {
    const best = _candidateBestBand(r.email);
    const prof = r.profession_id ? CH.resolveProfession(r.profession_id, r.seniority) : null;
    const openToWorkPro = !!r.open_to_work && isSubscriber(r.email);
    return {
      email: r.email, username: r.username || 'ResumeTailored user',
      professionLabel: prof ? prof.displayLabel : null,
      bestBand: best.band || null, bestScore: best.score || 0,
      location: r.location, remotePref: r.remote_pref, gigAvailable: !!r.gig_available, hourlyRate: r.hourly_rate,
      // "Open to Work" badge visibility: a Pro job seeker's badge is visible to
      // every employer (openToWorkPro=true covers that case); a free job
      // seeker's badge only shows to Pro employers — limited exposure, not
      // hidden entirely. The candidate is still findable in search either way;
      // only the badge itself is gated.
      openToWork: !!r.open_to_work && (openToWorkPro || pro), openToWorkPro,
      updatedAt: r.updated_at
    };
  });
  const ranked = EH.rankCandidates(candidates, { employerIsPro: pro });
  res.json({ candidates: ranked, total: candidates.length, pro });
});

app.get('/api/employer/candidates/:email/profile', (req, res) => {
  const email = employerAuthEmail(req, res); if (!email) return;
  if (!isEmployerSubscriber(email)) return res.status(402).json({ error: 'pro_required', message: 'Full candidate profiles are a Pro Employer feature.' });
  const candEmail = String(req.params.email || '').toLowerCase();
  const cp = db.prepare('SELECT * FROM candidate_profiles WHERE email = ? AND searchable = 1').get(candEmail);
  if (!cp) return res.status(404).json({ error: 'not_found' });
  const user = db.prepare('SELECT username FROM users WHERE email = ?').get(candEmail);
  const ci = db.prepare('SELECT profession_id, seniority FROM check_ins WHERE email = ?').get(candEmail);
  const prof = ci && ci.profession_id ? CH.resolveProfession(ci.profession_id, ci.seniority) : null;
  const badges = db.prepare('SELECT topic, band, score, created_at FROM badges WHERE email = ? ORDER BY created_at DESC').all(candEmail);
  const site = db.prepare("SELECT subdomain FROM personal_sites WHERE email = ? AND published = 1 LIMIT 1").get(candEmail);
  const video = db.prepare("SELECT id FROM saved_videos WHERE email = ? ORDER BY created_at DESC LIMIT 1").get(candEmail);
  res.json({
    email: candEmail, username: user ? user.username : 'ResumeTailored user',
    professionLabel: prof ? prof.displayLabel : null,
    badges: badges.map(b => ({ topic: b.topic, band: b.band, score: b.score })),
    location: cp.location, remotePref: cp.remote_pref, gigAvailable: !!cp.gig_available, hourlyRate: cp.hourly_rate, gigSchedule: cp.gig_schedule,
    openToWork: !!cp.open_to_work,
    siteUrl: site ? `/site/${site.subdomain}` : null,
    hasVideoIntro: !!video
  });
});

app.post('/api/employer/candidates/:email/contact', employerLimiter, (req, res) => {
  const email = employerAuthEmail(req, res); if (!email) return;
  const e = email.toLowerCase();
  const employerProfile = db.prepare('SELECT company_name FROM employer_profiles WHERE email = ?').get(e);
  if (!employerProfile) return res.status(400).json({ error: 'no_employer_profile' });
  const candEmail = String(req.params.email || '').toLowerCase();
  const cp = db.prepare('SELECT email FROM candidate_profiles WHERE email = ? AND searchable = 1').get(candEmail);
  if (!cp) return res.status(404).json({ error: 'not_found' });
  const message = String((req.body && req.body.message) || '').trim().slice(0, 1000);
  const now = Date.now();
  db.prepare(`
    INSERT INTO employer_contact_requests (employer_email, candidate_email, message, status, created_at, updated_at) VALUES (?,?,?,'pending',?,?)
    ON CONFLICT(employer_email, candidate_email) DO UPDATE SET message = excluded.message, status = 'pending', updated_at = excluded.updated_at
  `).run(e, candEmail, message, now, now);
  sendEmail({
    to: candEmail,
    subject: `${employerProfile.company_name} wants to connect on ResumeTailored`,
    html: `<p><strong>${employerProfile.company_name}</strong> would like to reach out to you.</p>${message ? `<p>"${message}"</p>` : ''}<p>Approve or decline from your Career Hub dashboard.</p>`
  }).catch(err => console.error('[employer] contact-request email failed:', err.message));
  res.json({ success: true });
});

function _applicationOut(r) {
  return { id: r.id, jobId: r.job_id, candidateEmail: r.candidate_email, resumeId: r.resume_id, status: r.status, rating: r.rating, notes: r.notes, interviewNote: r.interview_note, createdAt: r.created_at, updatedAt: r.updated_at };
}
app.get('/api/employer/jobs/:id/applications', (req, res) => {
  const email = employerAuthEmail(req, res); if (!email) return;
  const e = email.toLowerCase();
  const jobId = parseInt(req.params.id, 10);
  const job = db.prepare('SELECT id FROM job_postings WHERE id = ? AND employer_email = ?').get(jobId, e);
  if (!job) return res.status(404).json({ error: 'not_found' });
  const rows = db.prepare('SELECT * FROM job_applications WHERE job_id = ? ORDER BY created_at DESC').all(jobId);
  res.json({ applications: rows.map(_applicationOut), pro: isEmployerSubscriber(email) });
});

app.put('/api/employer/applications/:id', employerLimiter, (req, res) => {
  const email = employerAuthEmail(req, res); if (!email) return;
  const e = email.toLowerCase();
  const id = parseInt(req.params.id, 10);
  // Ownership is checked before the Pro gate, so an employer who doesn't own
  // this application gets a plain 404 — never a 402 that would leak "this
  // application exists, you just need to upgrade" to someone with no claim to it.
  const app_ = db.prepare(`
    SELECT a.*, j.title AS job_title, j.employer_email FROM job_applications a
    JOIN job_postings j ON j.id = a.job_id WHERE a.id = ? AND j.employer_email = ?
  `).get(id, e);
  if (!app_) return res.status(404).json({ error: 'not_found' });
  if (!isEmployerSubscriber(email)) return res.status(402).json({ error: 'pro_required', message: 'The ATS pipeline (status, rating, notes) is a Pro Employer feature.' });

  const body = req.body || {};
  const sets = []; const vals = [];
  if (body.status !== undefined) {
    if (!EH.validateApplicationStatus(body.status)) return res.status(400).json({ error: 'bad_request', message: 'Invalid application status.' });
    sets.push('status = ?'); vals.push(String(body.status).toLowerCase());
  }
  if (body.rating !== undefined && body.rating !== null) {
    if (!EH.validateRating(body.rating)) return res.status(400).json({ error: 'bad_request', message: 'Rating must be 1-5.' });
    sets.push('rating = ?'); vals.push(Number(body.rating));
  }
  if (body.notes !== undefined) { sets.push('notes = ?'); vals.push(String(body.notes).slice(0, 4000)); }
  if (body.interviewNote !== undefined) { sets.push('interview_note = ?'); vals.push(String(body.interviewNote).slice(0, 1000)); }
  if (!sets.length) return res.status(400).json({ error: 'bad_request', message: 'Nothing to update.' });
  sets.push('updated_at = ?'); vals.push(Date.now());
  vals.push(id);
  db.prepare(`UPDATE job_applications SET ${sets.join(', ')} WHERE id = ?`).run(...vals);

  // One-click "Reject" sends a polite email — fire once, on the transition into rejected.
  if (body.status && String(body.status).toLowerCase() === 'rejected' && app_.status !== 'rejected') {
    const employerProfile = db.prepare('SELECT company_name FROM employer_profiles WHERE email = ?').get(e);
    const candidate = db.prepare('SELECT username FROM users WHERE email = ?').get(app_.candidate_email);
    const rej = EH.buildRejectionEmail({ candidateName: candidate ? candidate.username : '', jobTitle: app_.job_title, companyName: employerProfile ? employerProfile.company_name : '' });
    sendEmail({ to: app_.candidate_email, subject: rej.subject, html: rej.html })
      .catch(err => console.error('[employer] rejection email failed:', err.message));
  }
  res.json({ success: true });
});

// ── Temp/gig staffing: "Need Staff Fast" matching ────────────────────────────
// A gig posting (job_type='temp', gig_rate/gig_schedule/gig_type set) is just
// a job_postings row with is_gig=1 — no separate posting flow, per the brief's
// own framing ("employers post 'Need Staff Fast' jobs"). What's new here is
// the match: who's opted into gig work, roughly nearby, and roughly
// affordable. Pro-gated like full candidate search — matching a specific
// posting against the whole candidate pool is a step up from browsing.
app.get('/api/employer/jobs/:id/matches', (req, res) => {
  const email = employerAuthEmail(req, res); if (!email) return;
  const e = email.toLowerCase();
  const id = parseInt(req.params.id, 10);
  const job = db.prepare('SELECT * FROM job_postings WHERE id = ? AND employer_email = ?').get(id, e);
  if (!job) return res.status(404).json({ error: 'not_found' });
  if (!job.is_gig) return res.status(400).json({ error: 'not_a_gig', message: 'Matching applies to temp/gig postings.' });
  if (!isEmployerSubscriber(email)) return res.status(402).json({ error: 'pro_required', message: 'Candidate matching is a Pro Employer feature.' });

  const rows = db.prepare(`
    SELECT cp.email, cp.remote_pref, cp.location, cp.gig_available, cp.hourly_rate, cp.open_to_work, cp.updated_at,
           ci.profession_id, u.username
    FROM candidate_profiles cp
    LEFT JOIN check_ins ci ON ci.email = cp.email
    LEFT JOIN users u ON u.email = cp.email
    WHERE cp.searchable = 1 AND cp.gig_available = 1
  `).all();
  const candidates = rows.map(r => ({
    email: r.email, username: r.username || 'ResumeTailored user', professionId: r.profession_id,
    location: r.location, remotePref: r.remote_pref, gigAvailable: !!r.gig_available, hourlyRate: r.hourly_rate,
    openToWork: !!r.open_to_work, openToWorkPro: !!r.open_to_work && isSubscriber(r.email), updatedAt: r.updated_at
  }));
  const matched = EH.matchGigCandidates(candidates, { professionId: _guessProfessionId(job.title), location: job.location, gigRate: job.gig_rate });
  const ranked = EH.rankCandidates(matched, { employerIsPro: true }); // already Pro-gated above; no cap here
  res.json({ matches: ranked.map(c => ({ email: c.email, username: c.username, location: c.location, remotePref: c.remotePref, hourlyRate: c.hourlyRate, openToWork: c.openToWork, matchScore: c.matchScore })) });
});

// ═══════════════════════════════════════════════════════════════════════════
// Employer Portal — Phase C: recruiter dashboard. Overview stats, recent
// activity, interview scheduling, in-app messaging, analytics (funnel +
// time-to-hire), CSV export and company settings. All reuse the existing
// job_postings / job_applications data; interviews + messages get their own
// tables. Everything here requires a set-up employer profile.
// ═══════════════════════════════════════════════════════════════════════════
function _requireEmployerProfile(req, res) {
  const email = employerAuthEmail(req, res); if (!email) return null;
  const e = email.toLowerCase();
  const profile = db.prepare('SELECT * FROM employer_profiles WHERE email = ?').get(e);
  if (!profile) { res.status(400).json({ error: 'no_employer_profile', message: 'Set up your company profile first.' }); return null; }
  return { email: e, profile };
}
// All applications across this employer's postings, newest first, with the
// posting title and candidate username joined in for display/export.
function _employerApplications(e) {
  return db.prepare(`
    SELECT a.*, j.title AS job_title, j.location AS job_location, u.username AS candidate_name
    FROM job_applications a
    JOIN job_postings j ON j.id = a.job_id
    LEFT JOIN users u ON u.email = a.candidate_email
    WHERE j.employer_email = ? ORDER BY a.created_at DESC
  `).all(e);
}

app.get('/api/employer/overview', (req, res) => {
  const ctx = _requireEmployerProfile(req, res); if (!ctx) return;
  const { email: e } = ctx;
  const weekAgo = Date.now() - 7 * 24 * 60 * 60 * 1000;
  const apps = _employerApplications(e);
  const activeJobs = db.prepare("SELECT COUNT(*) c FROM job_postings WHERE employer_email = ? AND status = 'active'").get(e).c;
  const totalJobs = db.prepare('SELECT COUNT(*) c FROM job_postings WHERE employer_email = ?').get(e).c;
  const applicationsThisWeek = apps.filter(a => a.created_at >= weekAgo).length;
  const candidatesInPipeline = apps.filter(a => !['hired', 'rejected'].includes(String(a.status).toLowerCase())).length;
  const interviewsScheduled = db.prepare("SELECT COUNT(*) c FROM interviews WHERE employer_email = ? AND status IN ('scheduled','confirmed') AND scheduled_at >= ?").get(e, Date.now()).c;
  // Recent activity: latest applications, interviews and messages, merged.
  const recentApps = apps.slice(0, 8).map(a => ({ type: 'application', at: a.created_at, text: `${a.candidate_name || a.candidate_email} applied to ${a.job_title}`, status: a.status }));
  const recentIv = db.prepare('SELECT * FROM interviews WHERE employer_email = ? ORDER BY created_at DESC LIMIT 5').all(e)
    .map(i => ({ type: 'interview', at: i.created_at, text: `Interview ${i.status} with ${i.candidate_email}`, status: i.status }));
  const recentMsg = db.prepare("SELECT * FROM employer_messages WHERE employer_email = ? AND sender = 'candidate' ORDER BY created_at DESC LIMIT 5").all(e)
    .map(m => ({ type: 'message', at: m.created_at, text: `New message from ${m.candidate_email}` }));
  const activity = [...recentApps, ...recentIv, ...recentMsg].sort((a, b) => b.at - a.at).slice(0, 10);
  res.json({
    companyName: ctx.profile.company_name, pro: isEmployerSubscriber(ctx.email),
    stats: { activeJobs, totalJobs, applicationsThisWeek, candidatesInPipeline, interviewsScheduled },
    activity
  });
});

// ── Interviews ───────────────────────────────────────────────────────────────
function _interviewOut(r) {
  return { id: r.id, candidateEmail: r.candidate_email, jobId: r.job_id, applicationId: r.application_id, scheduledAt: r.scheduled_at, mode: r.mode, locationOrLink: r.location_or_link, status: r.status, notes: r.notes, createdAt: r.created_at };
}
app.get('/api/employer/interviews', (req, res) => {
  const ctx = _requireEmployerProfile(req, res); if (!ctx) return;
  const rows = db.prepare(`
    SELECT iv.*, j.title AS job_title FROM interviews iv
    LEFT JOIN job_postings j ON j.id = iv.job_id
    WHERE iv.employer_email = ? ORDER BY iv.scheduled_at ASC
  `).all(ctx.email);
  res.json({ interviews: rows.map(r => Object.assign(_interviewOut(r), { jobTitle: r.job_title || null })) });
});
app.post('/api/employer/interviews', employerLimiter, (req, res) => {
  const ctx = _requireEmployerProfile(req, res); if (!ctx) return;
  const v = EH.validateInterview(req.body);
  if (!v.valid) return res.status(400).json({ error: 'bad_request', message: v.errors[0], errors: v.errors });
  const c = v.clean; const now = Date.now();
  const appRow = c.jobId ? db.prepare('SELECT id FROM job_applications WHERE job_id = ? AND candidate_email = ?').get(c.jobId, c.candidateEmail) : null;
  const info = db.prepare(`INSERT INTO interviews (employer_email, candidate_email, job_id, application_id, scheduled_at, mode, location_or_link, status, notes, created_at, updated_at)
    VALUES (?,?,?,?,?,?,?, 'scheduled', ?, ?, ?)`).run(ctx.email, c.candidateEmail, c.jobId, appRow ? appRow.id : null, c.scheduledAt, c.mode, c.locationOrLink, c.notes, now, now);
  // Move the linked application into the "interview" stage automatically.
  if (appRow) db.prepare("UPDATE job_applications SET status = 'interview', updated_at = ? WHERE id = ?").run(now, appRow.id);
  // Notify the candidate (fire-and-forget) with an ICS-friendly summary.
  const when = new Date(c.scheduledAt).toUTCString();
  sendEmail({ to: c.candidateEmail, subject: `Interview invitation — ${ctx.profile.company_name}`,
    html: `<p><strong>${ctx.profile.company_name}</strong> has invited you to an interview.</p><p><strong>When:</strong> ${when}<br/><strong>Format:</strong> ${c.mode}${c.locationOrLink ? `<br/><strong>Where/Link:</strong> ${c.locationOrLink}` : ''}</p>${c.notes ? `<p>${c.notes}</p>` : ''}` })
    .catch(err => console.error('[employer] interview email failed:', err.message));
  res.json({ success: true, id: info.lastInsertRowid });
});
app.put('/api/employer/interviews/:id', employerLimiter, (req, res) => {
  const ctx = _requireEmployerProfile(req, res); if (!ctx) return;
  const id = parseInt(req.params.id, 10);
  const iv = db.prepare('SELECT * FROM interviews WHERE id = ? AND employer_email = ?').get(id, ctx.email);
  if (!iv) return res.status(404).json({ error: 'not_found' });
  const body = req.body || {}; const sets = []; const vals = [];
  if (body.status !== undefined) {
    if (!EH.INTERVIEW_STATUSES.includes(String(body.status).toLowerCase())) return res.status(400).json({ error: 'bad_request' });
    sets.push('status = ?'); vals.push(String(body.status).toLowerCase());
  }
  if (body.scheduledAt !== undefined && isFinite(Number(body.scheduledAt))) { sets.push('scheduled_at = ?'); vals.push(Number(body.scheduledAt)); }
  if (body.notes !== undefined) { sets.push('notes = ?'); vals.push(String(body.notes).slice(0, 2000)); }
  if (!sets.length) return res.status(400).json({ error: 'bad_request', message: 'Nothing to update.' });
  sets.push('updated_at = ?'); vals.push(Date.now()); vals.push(id);
  db.prepare(`UPDATE interviews SET ${sets.join(', ')} WHERE id = ?`).run(...vals);
  res.json({ success: true });
});
app.delete('/api/employer/interviews/:id', (req, res) => {
  const ctx = _requireEmployerProfile(req, res); if (!ctx) return;
  db.prepare('DELETE FROM interviews WHERE id = ? AND employer_email = ?').run(parseInt(req.params.id, 10), ctx.email);
  res.json({ success: true });
});

// ── Messaging (employer ↔ candidate) ─────────────────────────────────────────
app.get('/api/employer/messages', (req, res) => {
  const ctx = _requireEmployerProfile(req, res); if (!ctx) return;
  // Thread list: one row per candidate, latest message + unread count.
  const rows = db.prepare(`
    SELECT candidate_email,
           MAX(created_at) AS last_at,
           (SELECT body FROM employer_messages m2 WHERE m2.employer_email = m.employer_email AND m2.candidate_email = m.candidate_email ORDER BY created_at DESC LIMIT 1) AS last_body,
           SUM(CASE WHEN sender = 'candidate' AND read_at IS NULL THEN 1 ELSE 0 END) AS unread
    FROM employer_messages m WHERE employer_email = ? GROUP BY candidate_email ORDER BY last_at DESC
  `).all(ctx.email);
  res.json({ threads: rows.map(r => ({ candidateEmail: r.candidate_email, lastBody: r.last_body, lastAt: r.last_at, unread: r.unread })) });
});
app.get('/api/employer/messages/:candEmail', (req, res) => {
  const ctx = _requireEmployerProfile(req, res); if (!ctx) return;
  const cand = String(req.params.candEmail || '').toLowerCase();
  const msgs = db.prepare('SELECT * FROM employer_messages WHERE employer_email = ? AND candidate_email = ? ORDER BY created_at ASC').all(ctx.email, cand);
  db.prepare("UPDATE employer_messages SET read_at = ? WHERE employer_email = ? AND candidate_email = ? AND sender = 'candidate' AND read_at IS NULL").run(Date.now(), ctx.email, cand);
  res.json({ messages: msgs.map(m => ({ id: m.id, sender: m.sender, body: m.body, createdAt: m.created_at })) });
});
app.post('/api/employer/messages/:candEmail', employerLimiter, (req, res) => {
  const ctx = _requireEmployerProfile(req, res); if (!ctx) return;
  const cand = String(req.params.candEmail || '').toLowerCase();
  const body = String((req.body && req.body.body) || '').trim().slice(0, 4000);
  if (!body) return res.status(400).json({ error: 'bad_request', message: 'Message cannot be empty.' });
  db.prepare("INSERT INTO employer_messages (employer_email, candidate_email, sender, body, created_at) VALUES (?,?,'employer',?,?)").run(ctx.email, cand, body, Date.now());
  sendEmail({ to: cand, subject: `New message from ${ctx.profile.company_name} on ResumeTailored`,
    html: `<p><strong>${ctx.profile.company_name}</strong> sent you a message:</p><blockquote>${body.replace(/</g, '&lt;')}</blockquote><p>Reply from your ResumeTailored dashboard.</p>` })
    .catch(err => console.error('[employer] message email failed:', err.message));
  res.json({ success: true });
});

// ── Analytics ────────────────────────────────────────────────────────────────
app.get('/api/employer/analytics', (req, res) => {
  const ctx = _requireEmployerProfile(req, res); if (!ctx) return;
  const apps = _employerApplications(ctx.email).map(a => ({ status: a.status, createdAt: a.created_at, updatedAt: a.updated_at, job_title: a.job_title }));
  const { counts, funnel, total } = EH.buildFunnel(apps);
  const timeToHire = EH.computeTimeToHire(apps);
  // "Source" tracking: we don't collect a referrer per application, so break
  // volume down by the posting it came through — the honest, real signal we
  // have. Employer Portal jobs vs. anything applied via the aggregated feed.
  const bySource = {};
  for (const a of apps) { const k = a.job_title || 'Unknown'; bySource[k] = (bySource[k] || 0) + 1; }
  const sources = Object.entries(bySource).map(([label, count]) => ({ label, count })).sort((x, y) => y.count - x.count).slice(0, 8);
  res.json({ counts, funnel, total, timeToHire, sources });
});

// CSV export of every applicant across all postings.
app.get('/api/employer/candidates/export.csv', (req, res) => {
  const ctx = _requireEmployerProfile(req, res); if (!ctx) return;
  if (!isEmployerSubscriber(ctx.email)) return res.status(402).json({ error: 'pro_required', message: 'CSV export is a Pro Employer feature.' });
  const apps = _employerApplications(ctx.email);
  const rows = apps.map(a => ({
    name: a.candidate_name || '', email: a.candidate_email, job: a.job_title, location: a.job_location || '',
    status: a.status, rating: a.rating == null ? '' : a.rating,
    applied: new Date(a.created_at).toISOString().slice(0, 10),
    notes: a.notes || ''
  }));
  const csv = EH.toCsv(rows, [
    { key: 'name', label: 'Candidate' }, { key: 'email', label: 'Email' }, { key: 'job', label: 'Job' },
    { key: 'location', label: 'Location' }, { key: 'status', label: 'Status' }, { key: 'rating', label: 'Rating' },
    { key: 'applied', label: 'Applied' }, { key: 'notes', label: 'Notes' }
  ]);
  res.setHeader('Content-Type', 'text/csv; charset=utf-8');
  res.setHeader('Content-Disposition', 'attachment; filename="candidates.csv"');
  res.send(csv);
});

// ── Settings (company profile + notification prefs) ──────────────────────────
app.get('/api/employer/settings', (req, res) => {
  const ctx = _requireEmployerProfile(req, res); if (!ctx) return;
  const p = ctx.profile;
  res.json({
    companyName: p.company_name, website: p.website || '', logoUrl: p.logo_url || '', description: p.description || '',
    notifyApplications: p.notify_applications == null ? true : !!p.notify_applications,
    notifyMessages: p.notify_messages == null ? true : !!p.notify_messages,
    pro: isEmployerSubscriber(ctx.email)
  });
});
app.post('/api/employer/settings', employerLimiter, (req, res) => {
  const ctx = _requireEmployerProfile(req, res); if (!ctx) return;
  const b = req.body || {};
  const companyName = String(b.companyName || ctx.profile.company_name || '').trim().slice(0, 120);
  if (companyName.length < 2) return res.status(400).json({ error: 'bad_request', message: 'Company name is required.' });
  db.prepare('UPDATE employer_profiles SET company_name = ?, website = ?, logo_url = ?, description = ?, notify_applications = ?, notify_messages = ? WHERE email = ?')
    .run(companyName, String(b.website || '').trim().slice(0, 200), String(b.logoUrl || '').trim().slice(0, 500), String(b.description || '').trim().slice(0, 2000),
      b.notifyApplications === false ? 0 : 1, b.notifyMessages === false ? 0 : 1, ctx.email);
  res.json({ success: true });
});

// Branded 404 for anything that fell through every route above (replaces
// Express's default "Cannot GET /…" page). API paths keep a JSON error.
app.use((req, res) => {
  if (req.path.startsWith('/api/')) return res.status(404).json({ error: 'Not found.' });
  res.status(404).sendFile(path.join(__dirname, 'public', '404.html'));
});

const PORT = process.env.PORT || 3000;
if (require.main === module) {
  app.listen(PORT, () => console.log(`ResumeTailored running on http://localhost:${PORT}`));
  // Career Hub daily jobs (warm cache + job-alert digest). In-process because
  // both need this service's SQLite volume, which a separate cron service
  // cannot reach — see career-cron.js. Off unless CAREER_CRON=on.
  try { require('./career-cron.js').startCareerCron(); } catch (e) { console.error('[career-cron] init failed:', e.message); }
}

// Exported for offline rendering/tests (e.g. DOCX alignment verification).
module.exports = { app, buildTemplatedDocxBuffer, _shareResumeHtml, _renderPersonalSite };
