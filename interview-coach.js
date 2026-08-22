/* interview-coach.js — pure, testable core for the AI Interview Coach.
 *
 * The plan's job-seeker Interview Coach: a calm, audio-only practice loop.
 *   • Text mode  — a question is shown, the user types an answer, and gets
 *     instant feedback on structure / relevance / keywords.
 *   • Voice mode — the browser speaks the question (TTS) and transcribes the
 *     spoken answer (Web Speech API); the server analyzes the transcript +
 *     timing for pace and filler words. Voice mode is Pro.
 *   • Free teaser — one full text question with basic feedback, then the voice
 *     mode / full report / progress are previewed behind the tasteful scrim.
 *
 * Everything here is deterministic and offline: the question bank, the delivery
 * analysis (words-per-minute, filler words), and a heuristic feedback fallback
 * used when no AI provider is configured. server.js layers _aiComplete on top
 * for richer feedback when a key is present. No DB, no network.
 */
'use strict';

const MODES = ['text', 'voice'];
// Free tier: one full question + basic feedback per day (a taste, renewable so
// they come back); Pro: unlimited, voice mode, full report, progress history.
const LIMITS = Object.freeze({ freePerDay: 1, freeMode: 'text' });

// Competency-tagged question bank. `{role}` is filled with the user's target
// role so every question feels tailored without an AI call. Behavioral first
// (the free teaser draws from these), then role/technical.
const QUESTION_BANK = Object.freeze([
  { id: 'tell-me', competency: 'intro', kind: 'behavioral', text: 'Tell me about yourself and why you are a strong fit for a {role} role.' },
  { id: 'challenge', competency: 'problem-solving', kind: 'behavioral', text: 'Describe a challenging problem you solved as a {role}. What was the situation, what did you do, and what was the result?' },
  { id: 'conflict', competency: 'collaboration', kind: 'behavioral', text: 'Tell me about a time you disagreed with a teammate. How did you handle it?' },
  { id: 'failure', competency: 'growth', kind: 'behavioral', text: 'Describe a time something went wrong on your watch. What did you learn?' },
  { id: 'impact', competency: 'impact', kind: 'behavioral', text: 'What accomplishment as a {role} are you most proud of, and how did you measure its impact?' },
  { id: 'strength', competency: 'self-awareness', kind: 'behavioral', text: 'What is your greatest strength as a {role}, and where are you actively trying to improve?' },
  { id: 'deadline', competency: 'execution', kind: 'behavioral', text: 'Tell me about a time you delivered under a tight deadline. How did you prioritize?' },
  { id: 'why-us', competency: 'motivation', kind: 'behavioral', text: 'Why do you want this {role} position, and what would you focus on in your first 90 days?' }
]);

const FILLER_WORDS = ['um', 'uh', 'er', 'ah', 'like', 'you know', 'sort of', 'kind of', 'basically', 'actually', 'literally', 'i mean', 'so yeah'];
// STAR structure markers used by the heuristic feedback.
const STAR_MARKERS = {
  situation: ['when', 'while', 'at the time', 'situation', 'context', 'faced', 'project'],
  task: ['needed to', 'had to', 'my job', 'responsible', 'goal', 'task', 'asked to'],
  action: ['i ', 'we ', 'decided', 'implemented', 'built', 'led', 'created', 'organized', 'analyzed'],
  result: ['result', 'increased', 'reduced', 'saved', 'grew', 'delivered', 'achieved', 'percent', '%', 'improved', 'won']
};

function normStr(v, max) { const s = (v == null ? '' : String(v)).trim(); return max ? s.slice(0, max) : s; }

// Pick the next question for a session. `askedIds` are the ids already served;
// role personalizes the text. Behavioral questions come first (the free teaser
// is always the first behavioral one). Wraps around if all have been asked.
function nextQuestion({ role, askedIds } = {}) {
  const asked = new Set(askedIds || []);
  const remaining = QUESTION_BANK.filter(q => !asked.has(q.id));
  const pool = remaining.length ? remaining : QUESTION_BANK;
  const q = pool[0];
  return { id: q.id, competency: q.competency, kind: q.kind, text: q.text.replace(/\{role\}/g, normStr(role) || 'this') };
}

// Analyze spoken delivery from a transcript + spoken duration (seconds).
// Deterministic: word count, words-per-minute, filler-word tally, and a pace
// band. durationSec ≤ 0 ⇒ pace/wpm are null (can't compute) but fillers still
// counted. This is what voice mode reports on top of the content feedback.
function analyzeDelivery(transcript, durationSec) {
  const text = normStr(transcript, 20000);
  const lower = ' ' + text.toLowerCase().replace(/[^a-z0-9%\s]/g, ' ').replace(/\s+/g, ' ') + ' ';
  const words = text ? text.split(/\s+/).filter(Boolean) : [];
  const wordCount = words.length;
  const fillers = {};
  let fillerCount = 0;
  for (const f of FILLER_WORDS) {
    const needle = ' ' + f + ' ';
    let idx = 0, n = 0;
    while ((idx = lower.indexOf(needle, idx)) !== -1) { n++; idx += needle.length - 1; }
    if (n > 0) { fillers[f] = n; fillerCount += n; }
  }
  const dur = Number(durationSec);
  const hasDur = Number.isFinite(dur) && dur > 0;
  const wpm = hasDur ? Math.round((wordCount / dur) * 60) : null;
  let pace = null;
  if (wpm != null) pace = wpm < 110 ? 'slow' : wpm > 170 ? 'fast' : 'good';
  const fillerRate = wordCount ? Math.round((fillerCount / wordCount) * 1000) / 10 : 0; // % of words
  return { wordCount, wpm, pace, fillerCount, fillerWords: fillers, fillerRatePct: fillerRate };
}

// Heuristic content feedback used when no AI provider is configured. Scores the
// answer on structure (STAR coverage), relevance (length/specificity), and
// keyword presence (numbers + role terms). Returns the same shape the AI path
// returns so the client renders one way.
function heuristicFeedback({ answer, role, question }) {
  const text = normStr(answer, 8000);
  const lower = ' ' + text.toLowerCase() + ' ';
  const wc = text ? text.split(/\s+/).filter(Boolean).length : 0;
  const covered = {};
  for (const [part, markers] of Object.entries(STAR_MARKERS)) covered[part] = markers.some(m => lower.includes(m));
  const starCount = Object.values(covered).filter(Boolean).length;
  const hasNumbers = /\d/.test(text);
  const roleTerm = normStr(role).toLowerCase().split(/\s+/).filter(Boolean);
  const mentionsRole = roleTerm.length ? roleTerm.some(t => t.length > 2 && lower.includes(t)) : false;

  const structure = Math.min(5, 1 + starCount);           // 1..5
  const relevance = wc < 25 ? 2 : wc < 60 ? 3 : wc < 220 ? 5 : 4; // too short/long both dinged
  const keywords = 2 + (hasNumbers ? 2 : 0) + (mentionsRole ? 1 : 0); // up to 5
  const overall = Math.round(((structure + relevance + Math.min(5, keywords)) / 3) * 10) / 10;

  const tips = [];
  if (!covered.situation) tips.push('Open by setting the scene — the situation and your specific role in it.');
  if (!covered.result) tips.push('Close with a concrete result; quantify it if you can (a number, %, or time saved).');
  if (!hasNumbers) tips.push('Add a metric — interviewers remember quantified impact.');
  if (wc < 40) tips.push('Expand a little: two to four sentences of specifics beat a one-liner.');
  if (wc > 260) tips.push('Tighten it — aim for a focused 60–120 word answer.');
  if (!mentionsRole && roleTerm.length) tips.push(`Tie it back to the ${normStr(role)} role explicitly.`);
  if (!tips.length) tips.push('Strong structure — keep leading with impact and specifics.');

  return {
    overall,
    scores: { structure, relevance, keywords: Math.min(5, keywords) },
    star: covered,
    strengths: starCount >= 3 ? ['Clear STAR structure', 'Good specificity'] : (hasNumbers ? ['Includes a concrete metric'] : ['A solid starting point']),
    improvements: tips.slice(0, 3),
    summary: `A ${overall >= 4 ? 'strong' : overall >= 3 ? 'solid' : 'developing'} answer. ${tips[0]}`,
    source: 'heuristic'
  };
}

// Validate the shape of an AI feedback JSON so the model output can't ship a
// broken card. Returns { ok, value } | { ok:false }.
function validateFeedback(obj) {
  if (!obj || typeof obj !== 'object') return { ok: false };
  const num = (v, d) => { const n = Number(v); return Number.isFinite(n) ? Math.max(0, Math.min(5, Math.round(n * 10) / 10)) : d; };
  const arr = (v) => Array.isArray(v) ? v.map(x => normStr(x, 300)).filter(Boolean).slice(0, 5) : [];
  const s = obj.scores || {};
  return { ok: true, value: {
    overall: num(obj.overall, 3),
    scores: { structure: num(s.structure, 3), relevance: num(s.relevance, 3), keywords: num(s.keywords, 3) },
    strengths: arr(obj.strengths),
    improvements: arr(obj.improvements),
    summary: normStr(obj.summary, 600),
    source: 'ai'
  } };
}

function buildFeedbackPrompt({ role, question, answer, mode }) {
  const system = 'You are a calm, professional interview coach. You give direct, specific, encouraging feedback on ONE interview answer. Score structure, relevance, and keyword coverage 0-5. Respond with ONLY a JSON object, no markdown.';
  const user = `TARGET ROLE: ${normStr(role, 120) || 'general'}
MODE: ${mode === 'voice' ? 'spoken (voice)' : 'written (text)'}
QUESTION: ${normStr(question, 500)}
CANDIDATE ANSWER: ${normStr(answer, 4000) || '(empty)'}

Return exactly:
{
  "overall": <0-5>,
  "scores": { "structure": <0-5>, "relevance": <0-5>, "keywords": <0-5> },
  "strengths": ["<short, specific>"],
  "improvements": ["<short, actionable>"],
  "summary": "<one or two encouraging sentences>"
}`;
  return { system, user };
}

module.exports = {
  MODES, LIMITS, QUESTION_BANK, FILLER_WORDS,
  nextQuestion, analyzeDelivery, heuristicFeedback, validateFeedback, buildFeedbackPrompt
};
