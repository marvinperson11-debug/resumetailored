'use strict';
/*
 * tools-core.js — pure, dependency-free core for the seven job-search tools
 * that ship in the Free Tools (/score) and Pro Tools (/pro-tools) hubs.
 *
 * Mirrors the career-hub.js / resume-writeback.js pattern: no DB access, no
 * network. It holds the gating table, the deterministic Offer Comparison
 * scorer, the LLM prompt builders, and the JSON validators used by
 * callClaudeJSON in server.js. Everything here is unit-tested directly in
 * test/tools.js so the routing/gating layer in server.js can stay thin.
 *
 * Bump PROMPT_VERSION to invalidate any content the server chooses to cache.
 */

const PROMPT_VERSION = 1;

// ── Free-tier limits (Pro is always unlimited) ───────────────────────────────
// `period` maps onto the tool_usage window the server counts against:
//   'day'   → resets at 00:00 UTC
//   'month' → resets on the 1st (UTC)
// resumeVersions is a hard row cap, not a time window.
//
// Tier philosophy: FREE = the full basic utility a competitor gives away; PRO =
// intelligence and outcomes (live data, analytics, optimization). So the Salary
// Negotiation Script is FREE and unlimited (no `free`/`period` key ⇒ the route
// never meters it) — Pro adds live market data, email templates and a risk
// meter, not "more uses". The A/B Tracker saves 3 versions free — Pro adds
// response-rate analytics, AI diagnosis and unlimited versions.
const LIMITS = {
  jobDecode:         { free: 3, period: 'day',   tool: 'job_decode' },
  followUp:          { free: 5, period: 'month', tool: 'follow_up' },
  mockInterview:     { free: 1, period: 'month', tool: 'mock_interview' },
  salaryNegotiation: { tool: 'salary_negotiation' }, // FREE + unlimited (no cap)
  resumeVersions:    { free: 3 },
};

// Pro-only capability flags, referenced by the routes and surfaced to the client
// so the UI can pitch the exact intelligence behind each paywall (never just
// "unlimited"). FREE gets full basic utility; these are the upsell.
const PRO_FLAGS = {
  marketData:        'market_data',        // Salary: live median for role + city
  emailTemplates:    'email_templates',    // Salary: initial / follow-up / final push
  responseAnalytics: 'response_analytics', // A/B: response-rate per version + leader
  aiDiagnosis:       'ai_diagnosis',       // A/B: "missing 4 keywords from the JD"
};

// ── helpers ──────────────────────────────────────────────────────────────────
function num(v) { const n = Number(v); return Number.isFinite(n) ? n : 0; }
function str(v, max) { return String(v == null ? '' : v).slice(0, max || 4000); }
function clampScore(n) { return Math.max(0, Math.min(100, Math.round(n))); }

// ── 1. Offer Comparison (COMPLETELY FREE — deterministic, no LLM) ─────────────
// Each offer: { label, baseSalary, bonus, equityPerYear, benefitsValue,
//               commuteMinutes, ptoDays, remote }
// Returns a normalized 0–100 score per offer (weighted total-comp / commute /
// PTO / remote) plus the winning label. Fully deterministic so it is testable
// and costs nothing to run.
const OFFER_WEIGHTS = { comp: 0.6, commute: 0.15, pto: 0.1, remote: 0.15 };

function normalizeOffer(o) {
  const base = num(o && o.baseSalary);
  const bonus = num(o && o.bonus);
  const equity = num(o && o.equityPerYear);
  const benefits = num(o && o.benefitsValue);
  return {
    label: str(o && o.label, 80) || 'Offer',
    baseSalary: base,
    bonus,
    equityPerYear: equity,
    benefitsValue: benefits,
    commuteMinutes: Math.max(0, num(o && o.commuteMinutes)),
    ptoDays: Math.max(0, num(o && o.ptoDays)),
    remote: !!(o && o.remote),
    totalComp: base + bonus + equity + benefits,
  };
}

function scoreOffers(offersRaw) {
  const offers = (Array.isArray(offersRaw) ? offersRaw : []).map(normalizeOffer);
  if (offers.length < 2) { const e = new Error('need_two_offers'); e.code = 'need_two_offers'; throw e; }

  const maxComp = Math.max(...offers.map(o => o.totalComp));
  const maxCom = Math.max(...offers.map(o => o.commuteMinutes));
  const maxPto = Math.max(...offers.map(o => o.ptoDays));
  // Ratio-of-max normalization (not min–max): a small dollar gap stays a small
  // score gap, instead of min–max forcing the lowest offer to 0 on that factor
  // — otherwise a $2k difference on a $150k package would read as a total loss.
  // A factor where every offer ties (or max is 0) contributes fully to all.
  const ratio = (v, max) => (max > 0 ? v / max : 1);

  const rows = offers.map(o => {
    const compScore = ratio(o.totalComp, maxComp);                       // higher is better
    const commuteScore = maxCom > 0 ? (1 - o.commuteMinutes / maxCom) : 1; // lower is better
    const ptoScore = ratio(o.ptoDays, maxPto);                           // higher is better
    const remoteScore = o.remote ? 1 : 0;
    const score = clampScore(100 * (
      OFFER_WEIGHTS.comp * compScore +
      OFFER_WEIGHTS.commute * commuteScore +
      OFFER_WEIGHTS.pto * ptoScore +
      OFFER_WEIGHTS.remote * remoteScore
    ));
    return Object.assign({}, o, { score });
  });

  // Highest score wins; ties break on higher total comp, then earlier entry.
  let best = rows[0];
  for (const r of rows) {
    if (r.score > best.score || (r.score === best.score && r.totalComp > best.totalComp)) best = r;
  }
  return { rows, bestLabel: best.label, bestScore: best.score };
}

// ── 2. Job Description Decoder (3/day free) — JSON via Claude ─────────────────
function buildJobDecodePrompt(jdText, lang) {
  const zh = lang === 'zh';
  const system = 'You are a candid career coach who reads job descriptions the way an experienced recruiter does. '
    + 'You surface the things a job seeker cannot see on a first read: euphemisms that hint at overwork, unstated must-haves, and a realistic pay band. '
    + 'Be specific and honest but never cynical. '
    + (zh ? 'Respond in Simplified Chinese for all human-readable strings.' : 'Respond in English.')
    + ' Return ONLY a JSON object, no markdown.';
  const user = `Analyze this job posting and return a JSON object with EXACTLY these keys:
{
  "summary": "2-sentence plain-language summary of the real role",
  "seniority": "one of: entry, mid, senior, lead, unclear",
  "redFlags": ["short phrases — vague overtime language, unrealistic scope, churn signals; [] if none"],
  "greenFlags": ["genuinely positive signals; [] if none"],
  "hiddenRequirements": ["skills/experience implied but not stated as requirements"],
  "keyThemes": ["the central themes and competencies this language rewards"],
  "keywords": ["specific ATS or profile keywords worth mirroring"],
  "mirrorSuggestions": ["truthful example phrases the reader can adapt for a resume or LinkedIn profile"],
  "salaryRange": { "low": number_or_null, "high": number_or_null, "currency": "USD", "note": "one sentence; say if this is an estimate" }
}
Keep each array to at most 6 concise items. If the posting states a salary, use it; otherwise estimate a realistic band and say so in note.

JOB POSTING:
${str(jdText, 12000)}`;
  return { system, user };
}

function validateJobDecode(obj) {
  if (!obj || typeof obj !== 'object') return { ok: false, error: 'not_object' };
  const arr = k => Array.isArray(obj[k]) ? obj[k].map(x => str(x, 240)).filter(Boolean).slice(0, 6) : [];
  const sr = obj.salaryRange && typeof obj.salaryRange === 'object' ? obj.salaryRange : {};
  const value = {
    summary: str(obj.summary, 600),
    seniority: str(obj.seniority, 20) || 'unclear',
    redFlags: arr('redFlags'),
    greenFlags: arr('greenFlags'),
    hiddenRequirements: arr('hiddenRequirements'),
    keyThemes: arr('keyThemes'),
    keywords: arr('keywords'),
    mirrorSuggestions: arr('mirrorSuggestions'),
    salaryRange: {
      low: sr.low == null ? null : num(sr.low),
      high: sr.high == null ? null : num(sr.high),
      currency: str(sr.currency, 8) || 'USD',
      note: str(sr.note, 300),
    },
  };
  if (!value.summary) return { ok: false, error: 'missing_summary' };
  return { ok: true, value };
}

// ── 3. Ghosted Follow-Up Generator (5/month free) — plain-text email ─────────
const FOLLOWUP_TONES = ['warm', 'professional', 'direct'];
function buildFollowUpPrompt(input, lang) {
  const zh = lang === 'zh';
  const company = str(input && input.company, 120) || 'the company';
  const role = str(input && input.role, 120) || 'the role';
  const days = Math.max(1, num(input && input.daysSince) || 7);
  const tone = FOLLOWUP_TONES.includes(input && input.tone) ? input.tone : 'professional';
  const contact = str(input && input.contactName, 80);
  const extra = str(input && input.extra, 600);
  const system = 'You write concise, high-response follow-up emails for job applicants who have not heard back. '
    + 'No fluff, no desperation, no groveling. One clear ask, a reason to reply, and a short reaffirmation of fit. '
    + (zh ? 'Write the email in Simplified Chinese.' : 'Write the email in English.')
    + ' Output the email only — a subject line, then the body. No commentary, no markdown.';
  const user = `Write a follow-up email.
- Company: ${company}
- Role: ${role}
- Days since applying: ${days}
- Tone: ${tone}
- Recipient name (may be blank): ${contact || '(unknown — use a neutral greeting)'}
- Extra context to weave in (optional): ${extra || '(none)'}

Format:
Subject: <subject line>

<3 short paragraphs, ≤160 words total, signed "[Your Name]">`;
  return { system, user };
}

// ── 4. AI Mock Interview (1/month free) — JSON questions + JSON feedback ──────
function buildMockQuestionsPrompt(input, lang) {
  const zh = lang === 'zh';
  const role = str(input && input.role, 120) || 'the role';
  const exp = str(input && input.experience, 40) || 'mid';
  const system = 'You are a seasoned hiring manager running a focused mock interview. '
    + 'You ask a balanced mix of behavioral and role-specific questions, calibrated to the candidate’s experience level. '
    + (zh ? 'Write all questions in Simplified Chinese.' : 'Write all questions in English.')
    + ' Return ONLY a JSON object, no markdown.';
  const user = `Generate a mock interview for a ${exp}-level ${role}.
Return JSON: { "questions": [ { "id": 1, "category": "behavioral|technical|role", "question": "..." }, ... ] }
Exactly 5 questions, ids 1..5, a natural interview arc (open → deeper → closing).`;
  return { system, user };
}

function validateMockQuestions(obj) {
  if (!obj || !Array.isArray(obj.questions)) return { ok: false, error: 'no_questions' };
  const questions = obj.questions.slice(0, 5).map((q, i) => ({
    id: num(q && q.id) || i + 1,
    category: str(q && q.category, 20) || 'behavioral',
    question: str(q && q.question, 500),
  })).filter(q => q.question);
  if (questions.length < 3) return { ok: false, error: 'too_few_questions' };
  return { ok: true, value: { questions } };
}

function buildMockFeedbackPrompt(input, lang) {
  const zh = lang === 'zh';
  const role = str(input && input.role, 120) || 'the role';
  const pairs = (Array.isArray(input && input.answers) ? input.answers : []).slice(0, 5).map((a, i) => {
    return `Q${i + 1}: ${str(a && a.question, 500)}\nA${i + 1}: ${str(a && a.answer, 1500) || '(no answer given)'}`;
  }).join('\n\n');
  const system = 'You are an interview coach giving direct, actionable feedback on a candidate’s answers. '
    + 'Score fairly on a 0–100 scale, name concrete strengths, and give specific, rewritable improvements — not platitudes. '
    + (zh ? 'Respond in Simplified Chinese.' : 'Respond in English.')
    + ' Return ONLY a JSON object, no markdown.';
  const user = `Role: ${role}
Score each answer and give overall feedback. Return JSON:
{
  "items": [ { "id": 1, "score": 0-100, "strengths": "one sentence", "improvements": "one specific, actionable sentence" } ],
  "overallScore": 0-100,
  "summary": "2-sentence overall read + the single highest-leverage fix"
}

TRANSCRIPT:
${pairs || '(no answers submitted)'}`;
  return { system, user };
}

function validateMockFeedback(obj) {
  if (!obj || !Array.isArray(obj.items)) return { ok: false, error: 'no_items' };
  const items = obj.items.slice(0, 5).map((it, i) => ({
    id: num(it && it.id) || i + 1,
    score: clampScore(num(it && it.score)),
    strengths: str(it && it.strengths, 400),
    improvements: str(it && it.improvements, 400),
  }));
  if (!items.length) return { ok: false, error: 'empty_items' };
  const overallScore = obj.overallScore == null
    ? clampScore(items.reduce((s, x) => s + x.score, 0) / items.length)
    : clampScore(num(obj.overallScore));
  return { ok: true, value: { items, overallScore, summary: str(obj.summary, 600) } };
}

// ── 5. Salary Negotiation Script — FREE + unlimited; Pro adds intelligence ────
// FREE tier: a custom counter-offer script + talking points in a professional,
// generic tone — the full basic utility, no account, no cap.
// PRO tier (`pro=true`): additionally asks for three ready-to-send email
// templates (initial counter / follow-up / final push). Live market data and
// the risk meter are attached server-side (buildSalaryMarket / computeRiskMeter)
// — the model is never asked to invent a data source.
// `marketHint` is an optional string the server injects from live JSearch data
// for Pro; otherwise the model estimates the range and says so.
function buildSalaryPrompt(input, marketHint, lang, pro) {
  const zh = lang === 'zh';
  const role = str(input && input.role, 120) || 'the role';
  const location = str(input && input.location, 120) || 'unspecified location';
  const current = num(input && input.currentBase);
  const offer = num(input && input.offerBase);
  const target = num(input && input.targetBase);
  const competing = str(input && input.competingOffer, 200);
  const system = 'You are a compensation negotiation coach. You produce a calm, specific counter-offer script grounded in market reality, '
    + 'and you are explicit that any range you estimate is an estimate, not a guarantee. Never invent a data source. '
    + (zh ? 'Write all human-readable strings in Simplified Chinese.' : 'Write in English.')
    + ' Return ONLY a JSON object, no markdown.';
  const proKeys = pro ? `,
  "marketRange": { "low": number, "high": number, "currency": "USD", "note": "one sentence; say whether this is live data or an estimate" },
  "emailTemplates": {
    "initialCounter": "a ready-to-send email opening the negotiation with the counter number",
    "followUp": "a short, warm nudge if there is no reply after a few days",
    "finalPush": "a decisive but graceful final ask that signals readiness to accept"
  }` : '';
  const user = `Create a salary negotiation plan.
- Role: ${role}
- Location: ${location}
- Current salary: ${current ? '$' + current : '(not given)'}
- Current offer base: ${offer ? '$' + offer : '(not given)'}
- Target base: ${target ? '$' + target : '(not given)'}
- Competing offer / leverage: ${competing || '(none)'}
${pro ? (marketHint ? '- Live market signal (from job listings): ' + str(marketHint, 500) : '- No live market data available; estimate a realistic band and mark it clearly as an estimate.') : '- Keep the tone professional and broadly applicable; do not cite specific market figures.'}

Return JSON:
{
  "counterOffer": { "base": number, "note": "why this number is defensible" },
  "talkingPoints": ["3–5 crisp, evidence-based points"],
  "script": "a ready-to-send 120–180 word message the candidate can adapt"${proKeys}
}`;
  return { system, user };
}

// Validate the model output. `marketRange` and `emailTemplates` are optional
// (Pro-only); the route strips them for free users regardless.
function validateSalary(obj) {
  if (!obj || typeof obj !== 'object') return { ok: false, error: 'not_object' };
  const co = obj.counterOffer && typeof obj.counterOffer === 'object' ? obj.counterOffer : {};
  const value = {
    counterOffer: { base: co.base == null ? null : num(co.base), note: str(co.note, 300) },
    talkingPoints: Array.isArray(obj.talkingPoints) ? obj.talkingPoints.map(x => str(x, 300)).filter(Boolean).slice(0, 5) : [],
    script: str(obj.script, 1600),
  };
  if (obj.marketRange && typeof obj.marketRange === 'object') {
    const mr = obj.marketRange;
    value.marketRange = {
      low: mr.low == null ? null : num(mr.low),
      high: mr.high == null ? null : num(mr.high),
      currency: str(mr.currency, 8) || 'USD',
      note: str(mr.note, 300),
    };
  }
  if (obj.emailTemplates && typeof obj.emailTemplates === 'object') {
    const et = obj.emailTemplates;
    value.emailTemplates = {
      initialCounter: str(et.initialCounter, 1600),
      followUp: str(et.followUp, 1600),
      finalPush: str(et.finalPush, 1600),
    };
  }
  if (!value.script) return { ok: false, error: 'missing_script' };
  return { ok: true, value };
}

// Deterministic risk meter (Pro). Given the counter-offer base and a market
// band, express how aggressive the ask is versus the market median. Pure and
// testable — the intelligence is in the comparison, not an LLM guess.
// Returns null when there is no market band to compare against.
function computeRiskMeter(counterBase, low, high) {
  const base = num(counterBase);
  const lo = low == null ? null : num(low);
  const hi = high == null ? null : num(high);
  let median = null;
  if (lo != null && hi != null) median = (lo + hi) / 2;
  else if (lo != null) median = lo;
  else if (hi != null) median = hi;
  if (!base || !median) return null;
  const percent = Math.round(((base - median) / median) * 100);
  let level, note;
  if (percent <= 0) { level = 'low'; note = `Your ask is at or below the market median — low risk, and you likely have room to ask for more.`; }
  else if (percent <= 10) { level = 'low'; note = `This ask is ${percent}% above the market median — low risk.`; }
  else if (percent <= 20) { level = 'moderate'; note = `This ask is ${percent}% above the market median — moderate risk. Anchor it to your leverage.`; }
  else { level = 'high'; note = `This ask is ${percent}% above the market median — a strong ask; be ready to justify it with concrete leverage.`; }
  return { level, percent, median: Math.round(median), note };
}

// ── 6. Resume A/B Tracker — response-rate helper (pure) ──────────────────────
// Given saved versions with jobs_applied_with / responses_received, compute a
// response rate and pick the current leader. Deterministic.
function summarizeVersions(rows) {
  const versions = (Array.isArray(rows) ? rows : []).map(r => {
    const applied = Math.max(0, num(r && r.jobs_applied_with));
    const responses = Math.max(0, num(r && r.responses_received));
    return {
      id: r && r.id,
      version_name: str(r && r.version_name, 120),
      template_used: str(r && r.template_used, 80),
      job_tag: str(r && r.job_tag, 120),
      jobs_applied_with: applied,
      responses_received: responses,
      responseRate: applied > 0 ? Math.round((responses / applied) * 100) : null,
    };
  });
  // Leader: highest response rate among versions with ≥1 application; ties break
  // on more applications (more signal).
  let leader = null;
  for (const v of versions) {
    if (v.responseRate == null) continue;
    if (!leader || v.responseRate > leader.responseRate ||
      (v.responseRate === leader.responseRate && v.jobs_applied_with > leader.jobs_applied_with)) {
      leader = v;
    }
  }
  return { versions, leaderId: leader ? leader.id : null };
}

// Response-rate analytics are a Pro capability. For free users the route calls
// this to strip the computed rate + leader, leaving the raw counts they logged
// (the basic side-by-side). Pure so the gating is testable without a DB.
function stripAnalytics(summary) {
  return {
    versions: (summary.versions || []).map(v => {
      const { responseRate, ...rest } = v;
      return Object.assign(rest, { responseRate: null });
    }),
    leaderId: null,
  };
}

// AI Diagnosis (Pro): compare one saved resume version against a target job
// description and surface the keyword gap — "Version A is missing 4 keywords".
function buildDiagnosisPrompt(resumeText, jobText, lang) {
  const zh = lang === 'zh';
  const system = 'You are an ATS keyword analyst. You compare a resume against a specific job description and report, precisely, which '
    + 'important keywords and skills from the posting are missing from the resume, which are present, and the concrete edits that would close the gap. '
    + 'Only surface terms that genuinely appear in the job description. '
    + (zh ? 'Write all human-readable strings in Simplified Chinese.' : 'Write in English.')
    + ' Return ONLY a JSON object, no markdown.';
  const user = `Compare this resume version against the job description.

Return JSON:
{
  "matchScore": 0-100,
  "missingKeywords": ["important terms in the JD that are absent from the resume; [] if none"],
  "presentKeywords": ["important JD terms the resume already covers"],
  "suggestions": ["2–5 specific, rewritable edits to close the gap"]
}
Keep each array to at most 8 concise items.

JOB DESCRIPTION:
${str(jobText, 8000)}

RESUME VERSION:
${str(resumeText, 12000)}`;
  return { system, user };
}

function validateDiagnosis(obj) {
  if (!obj || typeof obj !== 'object') return { ok: false, error: 'not_object' };
  const arr = k => Array.isArray(obj[k]) ? obj[k].map(x => str(x, 200)).filter(Boolean).slice(0, 8) : [];
  const value = {
    matchScore: clampScore(num(obj.matchScore)),
    missingKeywords: arr('missingKeywords'),
    presentKeywords: arr('presentKeywords'),
    suggestions: arr('suggestions'),
  };
  return { ok: true, value };
}

// ── 7. Weekly Job Search Report — pure email builder ─────────────────────────
// stats: { applied, responses, interviews, staleFollowUps:[{company,role,days}] }
function buildWeeklyReportEmail(input) {
  const name = str(input && input.name, 80) || 'there';
  const s = (input && input.stats) || {};
  const applied = num(s.applied), responses = num(s.responses), interviews = num(s.interviews);
  const stale = Array.isArray(s.staleFollowUps) ? s.staleFollowUps.slice(0, 5) : [];
  const rate = applied > 0 ? Math.round((responses / applied) * 100) : 0;
  const origin = str(input && input.origin, 200) || 'https://resumetailored.com';

  const actions = [];
  if (stale.length) actions.push(`Send ${stale.length} follow-up${stale.length > 1 ? 's' : ''} — you have applications sitting 7+ days with no reply.`);
  if (applied === 0) actions.push('Apply to at least 5 roles this week to keep momentum.');
  if (rate < 15 && applied >= 5) actions.push('Response rate is low — try the Resume A/B Tracker to test a stronger version.');
  if (!actions.length) actions.push('Keep going — your pipeline looks healthy. Aim for 5 more applications.');

  const staleRows = stale.map(f =>
    `<li style="margin:4px 0;">${str(f && f.role, 80)} at <strong>${str(f && f.company, 80)}</strong> — ${num(f && f.days)} days, no reply</li>`
  ).join('');

  const html = `<div style="font-family:Inter,Arial,sans-serif;max-width:560px;margin:0 auto;color:#191512;">
  <h2 style="color:#1F5C3D;margin:0 0 4px;">Your weekly job-search report</h2>
  <p style="color:#57514A;margin:0 0 20px;">Hi ${name}, here's how last week went.</p>
  <table style="width:100%;border-collapse:collapse;margin-bottom:20px;">
    <tr>
      <td style="text-align:center;padding:12px;background:#F1F7F2;border-radius:10px;"><div style="font-size:24px;font-weight:800;color:#1F5C3D;">${applied}</div><div style="font-size:12px;color:#57514A;">Applications</div></td>
      <td style="width:10px;"></td>
      <td style="text-align:center;padding:12px;background:#F1F7F2;border-radius:10px;"><div style="font-size:24px;font-weight:800;color:#1F5C3D;">${responses}</div><div style="font-size:12px;color:#57514A;">Responses (${rate}%)</div></td>
      <td style="width:10px;"></td>
      <td style="text-align:center;padding:12px;background:#F1F7F2;border-radius:10px;"><div style="font-size:24px;font-weight:800;color:#1F5C3D;">${interviews}</div><div style="font-size:12px;color:#57514A;">Interviews</div></td>
    </tr>
  </table>
  ${staleRows ? `<h3 style="font-size:15px;margin:0 0 6px;">Needs a follow-up</h3><ul style="padding-left:18px;margin:0 0 20px;color:#57514A;font-size:14px;">${staleRows}</ul>` : ''}
  <h3 style="font-size:15px;margin:0 0 6px;">This week's action items</h3>
  <ol style="padding-left:18px;margin:0 0 24px;color:#191512;font-size:14px;">${actions.map(a => `<li style="margin:4px 0;">${a}</li>`).join('')}</ol>
  <a href="${origin}/job-tracker" style="display:inline-block;background:#1F5C3D;color:#fff;font-weight:700;padding:12px 22px;border-radius:10px;text-decoration:none;">Open your Job Tracker</a>
  <p style="color:#8A8378;font-size:12px;margin-top:24px;">You're receiving this because Weekly Job Search Report is on. Turn it off any time in your account settings.</p>
</div>`;

  const subject = `Your job search: ${applied} applied, ${responses} response${responses === 1 ? '' : 's'} last week`;
  return { subject, html };
}

module.exports = {
  PROMPT_VERSION,
  LIMITS,
  PRO_FLAGS,
  OFFER_WEIGHTS,
  scoreOffers,
  normalizeOffer,
  buildJobDecodePrompt, validateJobDecode,
  buildFollowUpPrompt, FOLLOWUP_TONES,
  buildMockQuestionsPrompt, validateMockQuestions,
  buildMockFeedbackPrompt, validateMockFeedback,
  buildSalaryPrompt, validateSalary, computeRiskMeter,
  summarizeVersions, stripAnalytics,
  buildDiagnosisPrompt, validateDiagnosis,
  buildWeeklyReportEmail,
};
