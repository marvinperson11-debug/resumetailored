#!/usr/bin/env node
/**
 * Warm the Career Hub content caches for the top professions.
 *
 * The quiz / interview / scenario caches are cross-user and keyed by
 * hash + PROMPT_VERSION, so generating each variant once means the FIRST real
 * user of a popular role never waits on a live model call. This pre-generates
 * that set overnight for CH.TOP_PROFESSIONS only — obscure roles stay lazy so
 * we don't burn credits on traffic that may never come.
 *
 * Run nightly (cron / Railway scheduled job):
 *     node scripts/warm-career-cache.js
 *
 * Requires ANTHROPIC_API_KEY. DATA_DIR must match the app's SQLite dir.
 * Idempotent: anything already cached is skipped, so a re-run is cheap.
 */
require('dotenv').config();
const path = require('path');
const Database = require('better-sqlite3');
const Anthropic = require('@anthropic-ai/sdk');
const CH = require('../career-hub.js');

const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
const dataDir = process.env.DATA_DIR || path.join(__dirname, '..', 'data');
const db = new Database(path.join(dataDir, 'resumetailor.db'));
// Default seniority to warm; the app keys quizzes by seniority so we pick the
// most common one rather than every level (keeps credits bounded).
const SENIORITY = process.env.WARM_SENIORITY || 'mid';

async function gen({ system, user, max_tokens, validate }) {
  for (let attempt = 0; attempt < 2; attempt++) {
    const content = attempt === 0 ? user : user + '\n\nReturn ONLY the JSON object.';
    const msg = await anthropic.messages.create({ model: 'claude-haiku-4-5', max_tokens, system, messages: [{ role: 'user', content }] });
    const v = validate(CH.extractJson(msg.content[0] && msg.content[0].text));
    if (v.ok) return v.value;
  }
  throw new Error('invalid JSON after retry');
}

(async () => {
  if (!process.env.ANTHROPIC_API_KEY) { console.error('ANTHROPIC_API_KEY not set'); process.exit(1); }
  let made = 0, skipped = 0, failed = 0;
  for (const pid of CH.TOP_PROFESSIONS) {
    const prof = CH.resolveProfession(pid, SENIORITY);
    if (!prof) continue;

    // Quiz (general topic)
    const qKey = CH.quizCacheKey(prof.id, prof.seniority, '');
    if (db.prepare('SELECT 1 FROM quiz_cache WHERE cache_key = ?').get(qKey)) { skipped++; }
    else {
      try {
        const p = CH.buildQuizPrompt(prof, '');
        const payload = await gen({ system: p.system, user: p.user, max_tokens: 2600, validate: CH.validateQuiz });
        db.prepare('INSERT OR REPLACE INTO quiz_cache (cache_key,profession_id,seniority,topic,payload,created_at) VALUES (?,?,?,?,?,?)')
          .run(qKey, prof.id, prof.seniority, '', JSON.stringify(payload), Date.now());
        made++; console.log(`  quiz     ✓ ${prof.displayLabel}`);
      } catch (e) { failed++; console.error(`  quiz     ✗ ${prof.displayLabel}: ${e.message}`); }
    }

    // Interview (behavioral + technical)
    for (const kind of ['behavioral', 'technical']) {
      const iKey = CH.interviewCacheKey(prof.id, prof.seniority, kind);
      if (db.prepare('SELECT 1 FROM interview_cache WHERE cache_key = ?').get(iKey)) { skipped++; continue; }
      try {
        const p = CH.buildInterviewPrompt(prof, kind);
        const payload = await gen({ system: p.system, user: p.user, max_tokens: 2800, validate: CH.validateInterview });
        db.prepare('INSERT OR REPLACE INTO interview_cache (cache_key,profession_id,seniority,kind,payload,created_at) VALUES (?,?,?,?,?,?)')
          .run(iKey, prof.id, prof.seniority, kind, JSON.stringify(payload), Date.now());
        made++; console.log(`  iv/${kind.slice(0, 4)}  ✓ ${prof.displayLabel}`);
      } catch (e) { failed++; console.error(`  iv/${kind} ✗ ${prof.displayLabel}: ${e.message}`); }
    }

    // Scenarios (all types)
    for (const stype of Object.keys(CH.SCENARIO_TYPES)) {
      const sKey = CH.scenarioCacheKey(prof.id, stype);
      if (db.prepare('SELECT 1 FROM scenario_cache WHERE cache_key = ?').get(sKey)) { skipped++; continue; }
      try {
        const p = CH.buildScenarioPrompt(prof, stype);
        const payload = await gen({ system: p.system, user: p.user, max_tokens: 2400, validate: CH.validateScenario });
        db.prepare('INSERT OR REPLACE INTO scenario_cache (cache_key,profession_id,scenario_type,payload,created_at) VALUES (?,?,?,?,?)')
          .run(sKey, prof.id, stype, JSON.stringify(payload), Date.now());
        made++; console.log(`  scen     ✓ ${prof.displayLabel} / ${stype}`);
      } catch (e) { failed++; console.error(`  scen     ✗ ${prof.displayLabel}/${stype}: ${e.message}`); }
    }
  }
  console.log(`\n[warm] generated ${made}, skipped ${skipped} (already cached), failed ${failed}`);
  process.exit(failed && !made ? 1 : 0);
})();
