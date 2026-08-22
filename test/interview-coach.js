#!/usr/bin/env node
/** Interview Coach — pure core (interview-coach.js). Offline, deterministic. */
const IC = require('../interview-coach.js');

let failures = 0;
const check = (name, cond, detail) => {
  if (cond) console.log(`PASS  ${name}`);
  else { failures++; console.error(`FAIL  ${name}${detail ? ' — ' + detail : ''}`); }
};

// ── question bank ────────────────────────────────────────────────────────────
check('question bank is non-empty', IC.QUESTION_BANK.length >= 5);
const q1 = IC.nextQuestion({ role: 'Product Manager', askedIds: [] });
check('first question is the behavioral teaser', q1.id === 'tell-me' && q1.kind === 'behavioral');
check('role is interpolated into the question', /Product Manager/.test(q1.text) && !/\{role\}/.test(q1.text));
const q2 = IC.nextQuestion({ role: 'PM', askedIds: ['tell-me'] });
check('nextQuestion skips already-asked ids', q2.id !== 'tell-me');
const qAll = IC.nextQuestion({ role: 'PM', askedIds: IC.QUESTION_BANK.map(q => q.id) });
check('wraps around when everything was asked', !!qAll.id);
check('missing role does not leave a placeholder', !/\{role\}/.test(IC.nextQuestion({}).text));

// ── delivery analysis (voice) ────────────────────────────────────────────────
const d = IC.analyzeDelivery('Um, so I basically, uh, led the project and, like, we improved sales by 20%.', 10);
check('counts words', d.wordCount > 0);
check('computes wpm from duration', d.wpm === Math.round((d.wordCount / 10) * 60));
check('detects filler words (um/uh/like/basically)', d.fillerCount >= 4, JSON.stringify(d.fillerWords));
check('reports a pace band', ['slow', 'good', 'fast'].includes(d.pace));
check('filler rate is a percentage', typeof d.fillerRatePct === 'number' && d.fillerRatePct > 0);
const dNoDur = IC.analyzeDelivery('hello there world', 0);
check('no duration → null wpm/pace but still counts words', dNoDur.wpm === null && dNoDur.pace === null && dNoDur.wordCount === 3);
const dClean = IC.analyzeDelivery('I led the migration and cut costs by thirty percent.', 8);
check('a clean answer has zero fillers', dClean.fillerCount === 0);

// ── heuristic feedback ───────────────────────────────────────────────────────
const strong = IC.heuristicFeedback({ role: 'Data Analyst', question: 'Tell me about impact', answer: 'When our dashboard was slow, I was responsible for the fix. I rebuilt the query pipeline and we reduced load time by 40%, which improved adoption.' });
check('strong STAR answer scores well', strong.overall >= 3.5, JSON.stringify(strong.scores));
check('detects STAR result via a metric', strong.star.result === true && strong.scores.keywords >= 4);
const weak = IC.heuristicFeedback({ role: 'Data Analyst', question: 'x', answer: 'I am good.' });
check('a thin answer scores lower and gets tips', weak.overall < strong.overall && weak.improvements.length >= 1);
check('feedback shape is stable (scores + summary)', typeof strong.summary === 'string' && strong.scores && 'structure' in strong.scores);

// ── AI feedback validation ───────────────────────────────────────────────────
const okv = IC.validateFeedback({ overall: 4, scores: { structure: 4, relevance: 5, keywords: 3 }, strengths: ['clear'], improvements: ['add a metric'], summary: 'Good.' });
check('validates a well-formed AI feedback', okv.ok && okv.value.source === 'ai' && okv.value.overall === 4);
check('clamps out-of-range scores', IC.validateFeedback({ overall: 99, scores: {} }).value.overall === 5);
check('rejects non-object', IC.validateFeedback(null).ok === false);
const p = IC.buildFeedbackPrompt({ role: 'PM', question: 'Q', answer: 'A', mode: 'voice' });
check('feedback prompt names the mode', /voice/.test(p.user) && /JSON/.test(p.system));

console.log(failures ? `\n${failures} FAILURE(S)` : '\nALL PASS (0 failures)');
process.exit(failures ? 1 : 0);
