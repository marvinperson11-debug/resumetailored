/* career-hub.js — pure, testable core for the Career Hub expansion.
 *
 * This module holds everything that can be reasoned about without a database,
 * an HTTP request, or a live LLM call: the profession taxonomy resolver, the
 * cache-key builders, the LLM prompt builders, the JSON response validators,
 * quiz scoring/banding, deterministic option shuffling, JSearch normalization,
 * the free/Pro limit table, and the rule-based dashboard "next steps" engine.
 *
 * server.js wires these into routes, SQLite, Anthropic and RapidAPI. Keeping
 * the logic here (mirroring llms-txt.js / resume-writeback.js) means the tests
 * exercise real behaviour with no network and no API budget.
 */
'use strict';

const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

// Bump this to invalidate EVERY cached quiz / interview set / gap report /
// scenario at once after a prompt change — it is part of every cache key.
const PROMPT_VERSION = 'v1';

const SENIORITY_LEVELS = ['', 'entry-level', 'mid', 'senior', 'lead'];
const SENIORITY_LABELS = {
  '': '', 'entry-level': 'Entry Level', 'mid': 'Mid Level', 'senior': 'Senior', 'lead': 'Lead'
};

// ── Free-tier limits (Pro = unlimited unless noted). Enforced in server.js
//    against the existing usage_store; the numbers live here so tests and the
//    client can read one source of truth. `period` is how the key is bucketed.
const LIMITS = {
  quiz:      { free: 1, period: 'day'  },  // 1 fresh quiz / day
  retake:    { free: 1, period: 'day'  },  // + 1 retake / day
  jobsearch: { free: 5, period: 'day'  },
  savedJobs: { free: 5, period: 'total' },
  gap:       { free: 1, period: 'week' },
  scenario:  { free: 1, period: 'week' }
};

// ── hashing / cache keys ────────────────────────────────────────────────────
function sha256(str) {
  return crypto.createHash('sha256').update(String(str)).digest('hex');
}
function quizCacheKey(professionId, seniority, topic) {
  return sha256([professionId, seniority || '', topic || 'general', PROMPT_VERSION].join('|'));
}
function interviewCacheKey(professionId, seniority, kind) {
  return sha256([professionId, seniority || '', kind, PROMPT_VERSION].join('|'));
}
function gapCacheKey(resumeText, jobText) {
  return sha256([sha256(normalizeForHash(resumeText)), sha256(normalizeForHash(jobText)), PROMPT_VERSION].join('|'));
}
function scenarioCacheKey(professionId, scenarioType) {
  return sha256([professionId, scenarioType, PROMPT_VERSION].join('|'));
}
function jobCacheKey(params) {
  const p = params || {};
  return sha256([
    (p.query || '').toLowerCase().trim(),
    (p.location || '').toLowerCase().trim(),
    p.remote || '', p.datePosted || '', p.jobType || '', p.page || 1, PROMPT_VERSION
  ].join('|'));
}
function normalizeForHash(s) {
  return String(s || '').replace(/\s+/g, ' ').trim().toLowerCase();
}
function badgeSlug() {
  return crypto.randomBytes(9).toString('base64').replace(/[^a-zA-Z0-9]/g, '').slice(0, 12);
}

// ── professions ─────────────────────────────────────────────────────────────
let _profCacheData = null;
let _profCachePath = null;
function professionsPath() {
  return path.join(__dirname, 'public', 'data', 'professions.json');
}
function loadProfessions(file) {
  const p = file || professionsPath();
  if (!file && _profCacheData && _profCachePath === p) return _profCacheData;
  const data = JSON.parse(fs.readFileSync(p, 'utf8'));
  if (!file) { _profCacheData = data; _profCachePath = p; }
  return data;
}
// flat map id -> { id, label, categoryId, categoryLabel, seniority, technicalStyle, aliases }
function flattenProfessions(data) {
  const out = {};
  for (const cat of (data.categories || [])) {
    for (const pr of (cat.professions || [])) {
      out[pr.id] = {
        id: pr.id,
        label: pr.label,
        categoryId: cat.id,
        categoryLabel: cat.label,
        seniority: !!pr.seniority,
        technicalStyle: cat.technicalStyle || 'role-specific technical questions',
        aliases: pr.aliases || []
      };
    }
  }
  return out;
}
function validateProfessionId(id, data) {
  if (!id || typeof id !== 'string') return false;
  return !!flattenProfessions(data || loadProfessions())[id];
}
function validateSeniority(s) {
  return SENIORITY_LEVELS.includes(s || '');
}
// Full resolved object used by every tool. `keywords` seeds prompts + job search.
function resolveProfession(id, seniority, data) {
  const flat = flattenProfessions(data || loadProfessions());
  const base = flat[id];
  if (!base) return null;
  const sen = validateSeniority(seniority) ? (seniority || '') : '';
  const kw = deriveKeywords(base);
  const label = sen && base.seniority ? `${SENIORITY_LABELS[sen]} ${base.label}` : base.label;
  return {
    id: base.id,
    label: base.label,
    displayLabel: label,
    category: base.categoryId,
    categoryLabel: base.categoryLabel,
    seniority: sen,
    seniorityLabel: SENIORITY_LABELS[sen] || '',
    technicalStyle: base.technicalStyle,
    keywords: kw,
    // Deep-links that reuse the existing SEO role pages when the slug matches.
    resumePage: `/${base.id}-resume`,
    coverPage: `/${base.id}-cover-letter`
  };
}
function deriveKeywords(base) {
  const words = new Set();
  String(base.label).toLowerCase().split(/[^a-z0-9+]+/i).forEach(w => { if (w.length > 1) words.add(w); });
  (base.aliases || []).forEach(a => words.add(String(a).toLowerCase()));
  words.add(base.categoryLabel.toLowerCase());
  return Array.from(words);
}

// ── LLM prompt builders. Each returns { system, user } strings. ─────────────
const QUIZ_QUESTION_COUNT = 10;
function buildQuizPrompt(prof, topic) {
  const t = topic && String(topic).trim() ? String(topic).trim() : 'core professional competence';
  const senLine = prof.seniority ? `  Seniority:  ${prof.seniorityLabel}\n` : '';
  return {
    system: 'You are an expert assessment writer for professional skills tests. You write fair, unambiguous multiple-choice questions that test real on-the-job competence, not trivia. Output ONLY valid JSON matching the schema. No markdown, no preamble.',
    user: `Write a ${QUIZ_QUESTION_COUNT}-question multiple-choice skills assessment for this role:
  Profession: ${prof.label}
${senLine}  Topic:      ${t}

Rules:
- Exactly ${QUIZ_QUESTION_COUNT} questions, each with exactly 4 options.
- Exactly one correct option per question.
- Mix difficulty: 3 easy, 5 medium, 2 hard.
- Each question includes a one-sentence explanation of why the answer is correct.
- No question may reference a specific employer, brand, or country's regulations unless universally standard.
Return JSON:
{
  "title": "${prof.label} — ${t}",
  "questions": [
    { "id": 1, "difficulty": "easy|medium|hard", "prompt": "...", "options": ["A","B","C","D"], "answerIndex": 0, "explanation": "..." }
  ]
}`
  };
}

function buildInterviewPrompt(prof, kind) {
  const count = 8;
  const isTech = kind === 'technical';
  const focus = isTech
    ? `technical / role-specific questions (${prof.technicalStyle})`
    : 'behavioral questions a hiring manager would realistically ask';
  return {
    system: 'You are an expert interview coach. Output ONLY valid JSON. No markdown, no preamble.',
    user: `Generate ${count} ${focus} for a ${prof.displayLabel}.
For each question provide:
  - "prompt": the interview question
  - "framework": the recommended answer structure (e.g., STAR for behavioral) with role-specific guidance
  - "modelAnswer": a concise 3-4 sentence example answer tailored to this role
  - "watchFor": one common mistake candidates make on this question
Return JSON:
{ "questions": [ { "id": 1, "kind": "${kind}", "prompt": "...", "framework": "...", "modelAnswer": "...", "watchFor": "..." } ] }`
  };
}

function buildGapPrompt(resumeText, jobText) {
  return {
    system: 'You are a career coach and ATS expert. Compare a candidate\'s resume to a target job. Output ONLY valid JSON. Be specific and actionable — name exact skills, tools, and keywords from the job description.',
    user: `RESUME:
${String(resumeText).slice(0, 4000)}

TARGET JOB:
${String(jobText).slice(0, 4000)}

Return JSON:
{
  "matchScore": 0,
  "strengths": ["skills/experience the candidate already has that the job wants"],
  "gaps": [ { "requirement": "...", "severity": "critical|important|nice-to-have", "evidence": "...", "action": "..." } ],
  "quickWins": ["resume-wording changes that close a gap immediately"],
  "studyPlan": [ { "skill": "...", "how": "specific resource type or path", "estWeeks": 2 } ]
}`
  };
}

const SCENARIO_TYPES = {
  'customer-service': 'Customer Service',
  'technical-debugging': 'Technical Debugging',
  'document-errors': 'Spreadsheet/Document Errors',
  'team-conflict': 'Team Conflict',
  'safety-compliance': 'Safety/Compliance'
};
function buildScenarioPrompt(prof, scenarioType) {
  const label = SCENARIO_TYPES[scenarioType] || 'Workplace Problem';
  return {
    system: 'You design interactive, branching workplace troubleshooting simulations for professional training. Output ONLY valid JSON. No markdown, no preamble.',
    user: `Create a realistic, branching "${label}" troubleshooting scenario for a ${prof.displayLabel}.
Rules:
- 3 to 5 steps. Each step is a decision point with 3 options.
- Exactly one option per step is the best action ("correctIndex").
- Each option has a "consequence": what happens if chosen (the wrong ones explain the risk so the user learns).
- Start with a vivid "situation" that sets up the problem.
Return JSON:
{
  "title": "...",
  "situation": "the opening problem the professional faces",
  "steps": [
    { "id": 1, "prompt": "what do you do?", "options": [ { "text": "...", "consequence": "..." } ], "correctIndex": 0 }
  ],
  "outcome": "a one-paragraph summary of the correct resolution path"
}`
  };
}

// ── validators. Each returns { ok:true, value } or { ok:false, error }. ─────
function isNonEmptyStr(x) { return typeof x === 'string' && x.trim().length > 0; }

function validateQuiz(obj, expectedCount) {
  const n = expectedCount || QUIZ_QUESTION_COUNT;
  if (!obj || typeof obj !== 'object') return fail('not an object');
  if (!Array.isArray(obj.questions) || obj.questions.length !== n) return fail(`expected ${n} questions`);
  for (let i = 0; i < obj.questions.length; i++) {
    const q = obj.questions[i];
    if (!q || !isNonEmptyStr(q.prompt)) return fail(`q${i}: missing prompt`);
    if (!Array.isArray(q.options) || q.options.length !== 4) return fail(`q${i}: needs 4 options`);
    if (!q.options.every(isNonEmptyStr)) return fail(`q${i}: empty option`);
    if (!Number.isInteger(q.answerIndex) || q.answerIndex < 0 || q.answerIndex > 3) return fail(`q${i}: bad answerIndex`);
    if (!isNonEmptyStr(q.explanation)) return fail(`q${i}: missing explanation`);
    q.id = i + 1;
    if (!['easy', 'medium', 'hard'].includes(q.difficulty)) q.difficulty = 'medium';
  }
  if (!isNonEmptyStr(obj.title)) obj.title = 'Skills Assessment';
  return ok(obj);
}

function validateInterview(obj) {
  if (!obj || !Array.isArray(obj.questions) || obj.questions.length < 4) return fail('need >= 4 questions');
  for (let i = 0; i < obj.questions.length; i++) {
    const q = obj.questions[i];
    if (!q || !isNonEmptyStr(q.prompt)) return fail(`q${i}: missing prompt`);
    if (!isNonEmptyStr(q.framework)) return fail(`q${i}: missing framework`);
    if (!isNonEmptyStr(q.modelAnswer)) return fail(`q${i}: missing modelAnswer`);
    if (!isNonEmptyStr(q.watchFor)) q.watchFor = '';
    q.id = i + 1;
  }
  return ok(obj);
}

function validateGap(obj) {
  if (!obj || typeof obj !== 'object') return fail('not an object');
  if (!Number.isFinite(obj.matchScore)) return fail('missing matchScore');
  obj.matchScore = Math.max(0, Math.min(100, Math.round(obj.matchScore)));
  obj.strengths = Array.isArray(obj.strengths) ? obj.strengths.filter(isNonEmptyStr) : [];
  obj.quickWins = Array.isArray(obj.quickWins) ? obj.quickWins.filter(isNonEmptyStr) : [];
  obj.gaps = Array.isArray(obj.gaps) ? obj.gaps.filter(g => g && isNonEmptyStr(g.requirement)).map(g => ({
    requirement: g.requirement,
    severity: ['critical', 'important', 'nice-to-have'].includes(g.severity) ? g.severity : 'important',
    evidence: isNonEmptyStr(g.evidence) ? g.evidence : '',
    action: isNonEmptyStr(g.action) ? g.action : ''
  })) : [];
  obj.studyPlan = Array.isArray(obj.studyPlan) ? obj.studyPlan.filter(s => s && isNonEmptyStr(s.skill)).map(s => ({
    skill: s.skill,
    how: isNonEmptyStr(s.how) ? s.how : '',
    estWeeks: Number.isFinite(s.estWeeks) ? Math.max(1, Math.round(s.estWeeks)) : 2
  })) : [];
  return ok(obj);
}

function validateScenario(obj) {
  if (!obj || typeof obj !== 'object') return fail('not an object');
  if (!isNonEmptyStr(obj.situation)) return fail('missing situation');
  if (!Array.isArray(obj.steps) || obj.steps.length < 3 || obj.steps.length > 5) return fail('need 3-5 steps');
  for (let i = 0; i < obj.steps.length; i++) {
    const s = obj.steps[i];
    if (!s || !isNonEmptyStr(s.prompt)) return fail(`step${i}: missing prompt`);
    if (!Array.isArray(s.options) || s.options.length < 2) return fail(`step${i}: needs options`);
    if (!s.options.every(o => o && isNonEmptyStr(o.text))) return fail(`step${i}: empty option`);
    s.options.forEach(o => { if (!isNonEmptyStr(o.consequence)) o.consequence = ''; });
    if (!Number.isInteger(s.correctIndex) || s.correctIndex < 0 || s.correctIndex >= s.options.length) return fail(`step${i}: bad correctIndex`);
    s.id = i + 1;
  }
  if (!isNonEmptyStr(obj.title)) obj.title = 'Troubleshooting Scenario';
  if (!isNonEmptyStr(obj.outcome)) obj.outcome = '';
  return ok(obj);
}

function ok(value) { return { ok: true, value }; }
function fail(error) { return { ok: false, error }; }

// Extract the first JSON object from a model response that may be wrapped in
// prose or ```json fences.
function extractJson(text) {
  if (!text) return null;
  let t = String(text).trim();
  const fence = t.match(/```(?:json)?\s*([\s\S]*?)```/i);
  if (fence) t = fence[1].trim();
  const start = t.indexOf('{');
  const end = t.lastIndexOf('}');
  if (start === -1 || end === -1 || end < start) return null;
  try { return JSON.parse(t.slice(start, end + 1)); } catch (_) { return null; }
}

// ── quiz delivery (answer-stripping + deterministic shuffle) ────────────────
// A permutation of [0..n-1] derived from a seed. Fisher-Yates with a small LCG,
// so the same (n, seed) always yields the same order — the server can rebuild
// it at submit time without storing anything.
function seededPermutation(n, seed) {
  const arr = Array.from({ length: n }, (_, i) => i);
  let s = (typeof seed === 'number' ? seed : parseInt(sha256(String(seed)).slice(0, 8), 16)) >>> 0;
  const rnd = () => { s = (s * 1664525 + 1013904223) >>> 0; return s / 4294967296; };
  for (let i = n - 1; i > 0; i--) {
    const j = Math.floor(rnd() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}
// Turn the canonical cached quiz into what the client receives: options in a
// shuffled order, an `order` array (canonical index per displayed slot) for
// scoring, and NO answerIndex / explanation. `order` reveals nothing about the
// answer, so it is safe to round-trip through the client.
function quizForDelivery(payload, seed) {
  const questions = payload.questions.map((q, qi) => {
    const perm = seededPermutation(4, `${seed}:${qi}`);
    return {
      id: q.id,
      difficulty: q.difficulty,
      prompt: q.prompt,
      options: perm.map(p => q.options[p]),
      order: perm
    };
  });
  return { title: payload.title, questions };
}
// Score submitted display-indices against the canonical payload using the same
// per-question `order` the client was given.
function scoreQuiz(payload, submission) {
  const answers = (submission && submission.answers) || [];
  const orders = (submission && submission.orders) || [];
  let correct = 0;
  const results = payload.questions.map((q, i) => {
    const order = Array.isArray(orders[i]) && orders[i].length === 4 ? orders[i] : [0, 1, 2, 3];
    const chosenDisplay = answers[i];
    const chosenCanonical = Number.isInteger(chosenDisplay) ? order[chosenDisplay] : -1;
    const isCorrect = chosenCanonical === q.answerIndex;
    if (isCorrect) correct++;
    return {
      id: q.id,
      correctCanonical: q.answerIndex,
      correctDisplay: order.indexOf(q.answerIndex),
      chosenDisplay: Number.isInteger(chosenDisplay) ? chosenDisplay : null,
      isCorrect,
      explanation: q.explanation
    };
  });
  const total = payload.questions.length;
  const score = Math.round((correct / total) * 100);
  return { score, correct, total, band: band(score), results };
}
function band(score) {
  if (score >= 95) return 'gold';
  if (score >= 80) return 'silver';
  if (score >= 60) return 'bronze';
  return null;
}
// Free tier tops out at Silver; Gold requires Pro.
function cappedBand(score, isSubscriber) {
  const b = band(score);
  if (b === 'gold' && !isSubscriber) return 'silver';
  return b;
}

// ── JSearch normalization ───────────────────────────────────────────────────
function buildJobQuery(explicitQuery, prof) {
  const q = (explicitQuery || '').trim();
  if (q) return q;
  return prof ? prof.label : 'jobs';
}
function normalizeJobs(apiResponse) {
  const data = (apiResponse && apiResponse.data) || [];
  return data.map(j => ({
    id: j.job_id || sha256((j.job_title || '') + (j.employer_name || '') + (j.job_apply_link || '')),
    title: j.job_title || '',
    company: j.employer_name || '',
    location: [j.job_city, j.job_state, j.job_country].filter(Boolean).join(', '),
    remote: !!j.job_is_remote,
    employmentType: j.job_employment_type || '',
    postedAt: j.job_posted_at_datetime_utc || null,
    url: j.job_apply_link || j.job_google_link || '',
    applyUrl: j.job_apply_link || '',
    logo: j.employer_logo || '',
    descriptionSnippet: (j.job_description || '').slice(0, 320)
  })).filter(j => j.title);
}

// ── dashboard rule-based next steps (pure) ──────────────────────────────────
// state: { hasProfession, professionLabel, resumeCount, tookQuiz, bestBands{},
//          interviewPracticed, interviewTotal, savedJobs, latestGap, scenariosDone }
function computeNextSteps(state) {
  const s = state || {};
  const steps = [];
  const prof = s.professionLabel || 'your profession';
  if (!s.hasProfession) {
    steps.push({ id: 'set-profession', text: 'Set your target profession to personalize every tool', tab: 'career', action: 'pickProfession' });
    return steps;
  }
  if (!s.resumeCount) {
    steps.push({ id: 'tailor', text: 'Tailor your first resume to a job', tab: 'tailor' });
  }
  if (!s.tookQuiz) {
    steps.push({ id: 'quiz', text: `Take the ${prof} Skills Test`, tab: 'skillslab' });
  }
  if ((s.interviewPracticed || 0) < (s.interviewTotal || 1)) {
    steps.push({ id: 'interview', text: 'Practice your interview questions', tab: 'interview' });
  }
  if (s.latestGap && Array.isArray(s.latestGap.gaps)) {
    const crit = s.latestGap.gaps.find(g => g.severity === 'critical');
    if (crit) steps.push({ id: 'gap-crit', text: `Close a critical gap: ${crit.requirement}`, tab: 'skillslab' });
  } else {
    steps.push({ id: 'gap', text: 'Analyze your resume against a target job', tab: 'gap' });
  }
  if (!s.savedJobs) {
    steps.push({ id: 'jobs', text: `Find ${prof} jobs and save your first one`, tab: 'jobfinder' });
  }
  if (!s.scenariosDone) {
    steps.push({ id: 'scenario', text: 'Try a workplace troubleshooting scenario', tab: 'scenariolab' });
  }
  return steps.slice(0, 5);
}

module.exports = {
  PROMPT_VERSION, SENIORITY_LEVELS, SENIORITY_LABELS, LIMITS, SCENARIO_TYPES, QUIZ_QUESTION_COUNT,
  sha256, quizCacheKey, interviewCacheKey, gapCacheKey, scenarioCacheKey, jobCacheKey, badgeSlug,
  loadProfessions, flattenProfessions, validateProfessionId, validateSeniority, resolveProfession, deriveKeywords,
  buildQuizPrompt, buildInterviewPrompt, buildGapPrompt, buildScenarioPrompt,
  validateQuiz, validateInterview, validateGap, validateScenario, extractJson,
  seededPermutation, quizForDelivery, scoreQuiz, band, cappedBand,
  buildJobQuery, normalizeJobs, computeNextSteps
};
