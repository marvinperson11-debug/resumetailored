#!/usr/bin/env node
/**
 * Career Hub — pure core (career-hub.js) + the public badge page (badge-page.js).
 *
 * Everything here is deterministic and offline: taxonomy resolution, cache-key
 * stability + version-sensitivity, LLM-response validators, quiz scoring with
 * the deterministic option shuffle round-trip, band/cappedBand gating,
 * JSearch normalization, the rule-based dashboard next-steps engine, and the
 * OG-tagged badge HTML. No network, no API budget.
 *
 * Usage: node test/career-hub.js
 */
const CH = require('../career-hub.js');
const { renderBadgePage } = require('../badge-page.js');

let failures = 0;
const check = (name, cond, detail) => {
  if (cond) console.log(`PASS  ${name}`);
  else { failures++; console.error(`FAIL  ${name}${detail ? ' — ' + detail : ''}`); }
};

// ── professions ─────────────────────────────────────────────────────────────
const data = CH.loadProfessions();
check('taxonomy has 10 categories', (data.categories || []).length === 10, String((data.categories || []).length));
check('validateProfessionId accepts a real slug', CH.validateProfessionId('registered-nurse'));
check('validateProfessionId rejects an unknown slug', !CH.validateProfessionId('wizard'));
check('validateProfessionId rejects empty', !CH.validateProfessionId(''));

const rn = CH.resolveProfession('registered-nurse', 'senior');
check('resolveProfession builds a display label with seniority', rn.displayLabel === 'Senior Registered Nurse', rn.displayLabel);
check('resolveProfession carries the category', rn.categoryLabel === 'Healthcare', rn.categoryLabel);
check('resolveProfession derives keywords', rn.keywords.includes('nurse'));
check('resolveProfession deep-links reuse the role-page slug', rn.resumePage === '/registered-nurse-resume');
check('resolveProfession returns null for unknown', CH.resolveProfession('nope') === null);
check('invalid seniority is dropped, not stored', CH.resolveProfession('registered-nurse', 'bogus').seniority === '');
check('non-seniority roles do not gain a prefix',
  CH.resolveProfession('bookkeeper', 'senior').displayLabel === 'Bookkeeper');

// ── cache keys ───────────────────────────────────────────────────────────────
check('quizCacheKey is stable', CH.quizCacheKey('a', 'senior', 'x') === CH.quizCacheKey('a', 'senior', 'x'));
check('quizCacheKey varies by profession', CH.quizCacheKey('a', 'senior', 'x') !== CH.quizCacheKey('b', 'senior', 'x'));
check('quizCacheKey varies by topic', CH.quizCacheKey('a', 'senior', 'x') !== CH.quizCacheKey('a', 'senior', 'y'));
check('empty topic normalizes to general', CH.quizCacheKey('a', 's', '') === CH.quizCacheKey('a', 's', 'general'));
check('gapCacheKey ignores whitespace/case', CH.gapCacheKey('Hello  World', 'JOB') === CH.gapCacheKey('hello world', 'job'));
check('gapCacheKey varies by content', CH.gapCacheKey('a', 'b') !== CH.gapCacheKey('a', 'c'));
check('jobCacheKey stable + case-insensitive', CH.jobCacheKey({ query: 'RN', location: 'Chicago' }) === CH.jobCacheKey({ query: 'rn', location: 'chicago' }));
check('badgeSlug is url-safe and non-empty', /^[a-zA-Z0-9]{6,12}$/.test(CH.badgeSlug()));

// ── validators ───────────────────────────────────────────────────────────────
const goodQuiz = { title: 'T', questions: Array.from({ length: 10 }, (_, i) => ({ id: i + 1, difficulty: 'easy', prompt: 'q' + i, options: ['a', 'b', 'c', 'd'], answerIndex: i % 4, explanation: 'because' })) };
check('validateQuiz accepts a well-formed quiz', CH.validateQuiz(goodQuiz).ok);
check('validateQuiz rejects wrong question count', !CH.validateQuiz({ questions: goodQuiz.questions.slice(0, 5) }).ok);
check('validateQuiz rejects a bad answerIndex', !CH.validateQuiz({ questions: goodQuiz.questions.map((q, i) => i === 0 ? Object.assign({}, q, { answerIndex: 9 }) : q) }).ok);
check('validateQuiz rejects a question with 3 options', !CH.validateQuiz({ questions: goodQuiz.questions.map((q, i) => i === 0 ? Object.assign({}, q, { options: ['a', 'b', 'c'] }) : q) }).ok);

const goodIv = { questions: Array.from({ length: 8 }, (_, i) => ({ prompt: 'q' + i, framework: 'STAR', modelAnswer: 'ans', watchFor: 'x' })) };
check('validateInterview accepts a well-formed set', CH.validateInterview(goodIv).ok);
check('validateInterview rejects too few', !CH.validateInterview({ questions: [{ prompt: 'a', framework: 'b', modelAnswer: 'c' }] }).ok);

const goodGap = { matchScore: 72.6, strengths: ['a'], gaps: [{ requirement: 'BLS', severity: 'critical', evidence: 'x', action: 'y' }], quickWins: ['w'], studyPlan: [{ skill: 's', how: 'h', estWeeks: 3 }] };
const gv = CH.validateGap(JSON.parse(JSON.stringify(goodGap)));
check('validateGap rounds + clamps matchScore', gv.ok && gv.value.matchScore === 73, String(gv.value && gv.value.matchScore));
check('validateGap defaults an unknown severity to important',
  CH.validateGap({ matchScore: 50, gaps: [{ requirement: 'x', severity: 'weird' }] }).value.gaps[0].severity === 'important');
check('validateGap rejects a missing matchScore', !CH.validateGap({ strengths: [] }).ok);

const goodSc = { title: 'S', situation: 'setup', steps: Array.from({ length: 4 }, (_, i) => ({ prompt: 'p' + i, options: [{ text: 'a', consequence: 'c' }, { text: 'b', consequence: 'd' }, { text: 'e', consequence: 'f' }], correctIndex: 1 })), outcome: 'done' };
check('validateScenario accepts a well-formed scenario', CH.validateScenario(goodSc).ok);
check('validateScenario rejects <3 steps', !CH.validateScenario(Object.assign({}, goodSc, { steps: goodSc.steps.slice(0, 2) })).ok);
check('validateScenario rejects a bad correctIndex', !CH.validateScenario({ situation: 's', steps: goodSc.steps.map((st, i) => i === 0 ? Object.assign({}, st, { correctIndex: 9 }) : st) }).ok);

check('extractJson reads a fenced block', CH.extractJson('pre ```json\n{"a":1}\n``` post').a === 1);
check('extractJson reads a bare object', CH.extractJson('{"b":2}').b === 2);
check('extractJson returns null on garbage', CH.extractJson('no json here') === null);

// ── quiz delivery + scoring round-trip ───────────────────────────────────────
const seed = 'seed-123';
const delivery = CH.quizForDelivery(goodQuiz, seed);
check('delivery strips answerIndex', delivery.questions.every(q => q.answerIndex === undefined));
check('delivery strips explanations', delivery.questions.every(q => q.explanation === undefined));
check('delivery carries a 4-length order per question', delivery.questions.every(q => Array.isArray(q.order) && q.order.length === 4));
check('delivery order is a real permutation', delivery.questions.every(q => [0, 1, 2, 3].every(n => q.order.indexOf(n) !== -1)));
check('shuffle is deterministic for a seed', JSON.stringify(CH.quizForDelivery(goodQuiz, seed)) === JSON.stringify(delivery));
check('different seeds shuffle differently', JSON.stringify(CH.quizForDelivery(goodQuiz, 'other')) !== JSON.stringify(delivery));

// perfect submission: pick the display slot mapping to the canonical answer
const perfectAnswers = delivery.questions.map(q => q.order.indexOf(goodQuiz.questions.find(x => x.id === q.id).answerIndex));
const orders = delivery.questions.map(q => q.order);
const perfect = CH.scoreQuiz(goodQuiz, { answers: perfectAnswers, orders });
check('perfect submission scores 100', perfect.score === 100, String(perfect.score));
check('perfect submission is Gold', perfect.band === 'gold');
check('scored results expose the explanation', perfect.results[0].explanation === 'because');

// half-wrong submission
const halfAnswers = perfectAnswers.map((a, i) => i < 5 ? a : (a + 1) % 4);
const half = CH.scoreQuiz(goodQuiz, { answers: halfAnswers, orders });
check('half-correct submission scores 50', half.score === 50, String(half.score));
check('50% earns no band', half.band === null);

check('band thresholds', CH.band(95) === 'gold' && CH.band(80) === 'silver' && CH.band(60) === 'bronze' && CH.band(59) === null);
check('free tier is capped at Silver', CH.cappedBand(100, false) === 'silver');
check('Pro keeps Gold', CH.cappedBand(100, true) === 'gold');
check('capping never promotes', CH.cappedBand(60, false) === 'bronze');

// ── JSearch normalization ────────────────────────────────────────────────────
const norm = CH.normalizeJobs({ data: [
  { job_id: '1', job_title: 'RN', employer_name: 'Mercy', job_city: 'Chicago', job_state: 'IL', job_is_remote: false, job_apply_link: 'http://a', job_description: 'x'.repeat(500) },
  { job_title: '', employer_name: 'Empty' }
] });
check('normalizeJobs drops title-less rows', norm.length === 1);
check('normalizeJobs joins the location', norm[0].location === 'Chicago, IL', norm[0].location);
check('normalizeJobs truncates the description snippet', norm[0].descriptionSnippet.length <= 320);
check('buildJobQuery falls back to the profession label', CH.buildJobQuery('', rn) === 'Registered Nurse');
check('buildJobQuery honours an explicit query', CH.buildJobQuery('nurse manager', rn) === 'nurse manager');

// ── dashboard next steps ─────────────────────────────────────────────────────
check('no profession → prompt to set one', CH.computeNextSteps({ hasProfession: false })[0].id === 'set-profession');
const partial = CH.computeNextSteps({ hasProfession: true, professionLabel: 'RN', resumeCount: 0, tookQuiz: false, interviewPracticed: 0, interviewTotal: 8, savedJobs: 0, scenariosDone: 0, latestGap: null });
check('empty state suggests tailoring first', partial.some(s => s.id === 'tailor'));
check('empty state suggests a quiz', partial.some(s => s.id === 'quiz'));
check('next steps cap at 5', partial.length <= 5);
const withCrit = CH.computeNextSteps({ hasProfession: true, professionLabel: 'RN', resumeCount: 1, tookQuiz: true, interviewPracticed: 8, interviewTotal: 8, savedJobs: 1, scenariosDone: 1, latestGap: { gaps: [{ severity: 'critical', requirement: 'ACLS' }] } });
check('a critical gap surfaces as a next step', withCrit.some(s => s.id === 'gap-crit' && /ACLS/.test(s.text)));

// ── badge page ───────────────────────────────────────────────────────────────
const badge = renderBadgePage({ slug: 'abc123', name: 'Jane Doe', professionLabel: 'Registered Nurse', topic: 'Patient Safety', band: 'gold', score: 96, created_at: Date.now() }, 'https://resumetailored.com');
check('badge page has an OG title', /<meta property="og:title"/.test(badge));
check('badge page shows the score', badge.includes('96%'));
check('badge page shows the name', badge.includes('Jane Doe'));
check('badge page shows the band medal', badge.includes('🥇'));
check('badge page has the canonical og:url', badge.includes('https://resumetailored.com/badge/abc123'));
check('badge page escapes HTML in the name', renderBadgePage({ slug: 's', name: '<script>x</script>', band: 'bronze', score: 60 }, '').indexOf('<script>x') === -1);
check('badge page respects reduced motion', /prefers-reduced-motion/.test(badge));
check('badge page is noindex (share asset, not an SEO page)', /<meta name="robots" content="noindex"/.test(badge));

// ── job-alert digest email (pure builder) ────────────────────────────────────
const dig = renderBadgePage ? CH.buildJobDigestEmail('Registered Nurse', [
  { title: 'ICU Nurse', company: 'Mercy', location: 'Chicago, IL', remote: false, url: 'http://a' },
  { title: 'ER Nurse', company: 'General', location: 'Remote', remote: true, url: 'http://b' }
], 'https://resumetailored.com') : null;
check('digest subject counts + names the profession', dig.subject === '2 new Registered Nurse jobs posted today', dig.subject);
check('digest singular when one job', CH.buildJobDigestEmail('Chef', [{ title: 'Line Cook', company: 'X' }], '').subject === '1 new Chef job posted today');
check('digest lists the job titles', /ICU Nurse/.test(dig.html) && /ER Nurse/.test(dig.html));
check('digest has a link back to the app', /\/app/.test(dig.html));
check('digest escapes HTML in a title', CH.buildJobDigestEmail('X', [{ title: '<b>hi</b>', company: 'C' }], '').html.indexOf('<b>hi</b>') === -1);
check('TOP_PROFESSIONS lists 20 real slugs', CH.TOP_PROFESSIONS.length === 20 && CH.TOP_PROFESSIONS.every(id => CH.validateProfessionId(id)));

// ── answerScore limit surface ────────────────────────────────────────────────
check('answerScore is Pro-only and capped 5/day', CH.LIMITS.answerScore.free === 0 && CH.LIMITS.answerScore.pro === 5 && CH.LIMITS.answerScore.period === 'day');

// ── language: in-language generation + localized labels ──────────────────────
check('cache keys are namespaced by language', CH.quizCacheKey('a', 's', 'x', 'zh') !== CH.quizCacheKey('a', 's', 'x', 'en'));
check('default lang is en', CH.quizCacheKey('a', 's', 'x') === CH.quizCacheKey('a', 's', 'x', 'en'));
check('interview/gap/scenario keys vary by language',
  CH.interviewCacheKey('a', 's', 'behavioral', 'zh') !== CH.interviewCacheKey('a', 's', 'behavioral', 'en') &&
  CH.gapCacheKey('r', 'j', 'zh') !== CH.gapCacheKey('r', 'j', 'en') &&
  CH.scenarioCacheKey('a', 'customer-service', 'zh') !== CH.scenarioCacheKey('a', 'customer-service', 'en'));
check('langInstruction adds a Chinese directive only for zh',
  /Chinese/.test(CH.buildQuizPrompt(rn, '', 'zh').user) && !/Chinese/.test(CH.buildQuizPrompt(rn, '', 'en').user));
check('langInstruction covers interview, gap and scenario prompts',
  /Chinese/.test(CH.buildInterviewPrompt(rn, 'behavioral', 'zh').user) &&
  /Chinese/.test(CH.buildGapPrompt('r', 'j', 'zh').user) &&
  /Chinese/.test(CH.buildScenarioPrompt(rn, 'customer-service', 'zh').user));
check('resolveProfession carries a Chinese label', rn.labelZh === '注册护士', rn.labelZh);
check('Chinese display label prefixes seniority in Chinese', rn.displayLabelZh === '高级注册护士', rn.displayLabelZh);
check('category has a Chinese label', rn.categoryLabelZh === '医疗保健', rn.categoryLabelZh);
check('every profession has a Chinese label', Object.keys(CH.PROFESSION_ZH).length >= 60 && Object.values(CH.flattenProfessions(data)).every(p => p.labelZh && p.labelZh !== p.label));
check('digest email localizes to Chinese',
  CH.buildJobDigestEmail('注册护士', [{ title: 'RN', company: 'X' }], '', 'zh').subject === '今天有 1 个新的注册护士职位');
check('digest Chinese body uses Chinese chrome', /查看全部职位/.test(CH.buildJobDigestEmail('注册护士', [{ title: 'RN', company: 'X' }], '', 'zh').html));
const badgeZh = renderBadgePage({ slug: 's', name: '张伟', professionLabel: '注册护士', band: 'gold', score: 96 }, '', 'zh');
check('badge page renders Chinese band + labels', /金牌/.test(badgeZh) && /测评得分/.test(badgeZh) && /lang="zh-CN"/.test(badgeZh));

// ── LIMITS surface ───────────────────────────────────────────────────────────
check('LIMITS covers all metered features', ['quiz', 'retake', 'jobsearch', 'savedJobs', 'gap', 'scenario'].every(k => CH.LIMITS[k]));
check('gap + scenario are weekly', CH.LIMITS.gap.period === 'week' && CH.LIMITS.scenario.period === 'week');
check('jobsearch is 5/day', CH.LIMITS.jobsearch.free === 5 && CH.LIMITS.jobsearch.period === 'day');

// ── Job Feed Aggregator: RSS parsing ────────────────────────────────────────
const sampleRss = `<?xml version="1.0"?><rss><channel><title>Acme Careers</title>
  <item><title>Registered Nurse &amp; Charge Nurse</title><link>https://acme.com/jobs/1</link><description><![CDATA[<p>ICU role</p>]]></description><pubDate>Mon, 03 Aug 2026 09:00:00 GMT</pubDate><guid>acme-1</guid></item>
  <item><title>Software Engineer</title><link>https://acme.com/jobs/2</link><description>Backend role</description></item>
</channel></rss>`;
const rssItems = CH.parseRssItems(sampleRss);
check('parseRssItems extracts every item', rssItems.length === 2, String(rssItems.length));
check('parseRssItems decodes HTML entities in the title', rssItems[0].title === 'Registered Nurse & Charge Nurse', rssItems[0].title);
check('parseRssItems unwraps CDATA in the description', rssItems[0].description === '<p>ICU role</p>', rssItems[0].description);
check('parseRssItems carries the link + guid', rssItems[0].link === 'https://acme.com/jobs/1' && rssItems[0].guid === 'acme-1');
check('parseRssItems falls back to the link as guid when none given', rssItems[1].guid === 'https://acme.com/jobs/2');
check('parseRssItems handles a missing pubDate', rssItems[1].pubDate === null);
check('parseRssItems drops an item with no title or link', CH.parseRssItems('<item><title>No link here</title></item>').length === 0);
check('parseRssItems never throws on garbage input', CH.parseRssItems('<not><even','rss</not>').length === 0 && CH.parseRssItems('').length === 0 && CH.parseRssItems(null).length === 0);

if (failures) { console.error(`\nFAILED (${failures} failure${failures === 1 ? '' : 's'})`); process.exit(1); }
console.log('\nALL PASS (0 failures)');
process.exit(0);
