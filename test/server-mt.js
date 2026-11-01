#!/usr/bin/env node
/**
 * Site-wide UI translator — `parseMtJson` shape-robust parsing and `_mtBatch`'s
 * repair/split retry ladder (fix for the live "llm_json_invalid: expected
 * array of length N" failures: the old path rejected anything that wasn't a
 * strict bare JSON array of the exact length, including common Claude-shaped
 * wrappers like `{"translations":[...]}`, fenced code blocks, and bare
 * single-string replies).
 *
 * `parseMtJson` is pure (no network, no DB) and unit-tested directly.
 * `_mtBatch`'s retry ladder is tested by swapping `_mtCallClaudeRaw` on the
 * module's exports object for a mock — no live API key or network call is
 * ever made here. `require('../server.js')` still boots a real Express app
 * (DB + routes), same as the other test/*.js files, but this file only
 * exercises the exported pure/mockable functions, not HTTP.
 *
 * Usage: node test/server-mt.js
 */
process.env.TOOLS_HASH_SALT = process.env.TOOLS_HASH_SALT || 'test-only-tools-hash-salt-0123456789'; // server.js refuses to boot without it
process.env.ANTHROPIC_API_KEY = process.env.ANTHROPIC_API_KEY || 'sk-test-not-a-real-key'; // truthy so _mtBatch doesn't short-circuit before reaching the mock
const fs = require('fs');
const os = require('os');
const path = require('path');

let failures = 0;
const check = (name, cond, detail) => {
  if (cond) console.log(`PASS  ${name}`);
  else { failures++; console.error(`FAIL  ${name}${detail ? ' — ' + detail : ''}`); }
};

process.env.DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'rt-mt-'));
process.env.RT_DISABLE_RATE_LIMIT = '1';
const mod = require('../server.js');
const { parseMtJson, _mtBatch } = mod;

// ── Console capture (no real logging noise, and lets tests assert on it) ────
async function withConsole(fn) {
  const warns = [], errors = [];
  const origWarn = console.warn, origError = console.error;
  console.warn = (...a) => warns.push(a.join(' '));
  console.error = (...a) => errors.push(a.join(' '));
  try { const result = await fn(); return { result, warns, errors }; }
  finally { console.warn = origWarn; console.error = origError; }
}

// ── parseMtJson: the shape-robust parse ladder ───────────────────────────────
function throws(fn) { try { fn(); return null; } catch (e) { return e; } }

(function parseMtJsonTests() {
  // 1. strict array, exact length -> accepted, step=strict
  {
    const r = parseMtJson('["Hola","Mundo"]', 2);
    check('1. strict array exact length accepted', r[0] === 'Hola' && r[1] === 'Mundo' && r.step === 'strict', JSON.stringify(r));
  }
  // 2. fenced array -> accepted, step=fence_strip
  {
    const r = parseMtJson('```json\n["Hola"]\n```', 1);
    check('2. fenced array accepted via fence_strip', r[0] === 'Hola' && r.step === 'fence_strip', JSON.stringify(r));
  }
  // 3. {"translations":[...]} exact length -> accepted, step=key_unwrap
  {
    const r = parseMtJson('{"translations":["Hola","Mundo"]}', 2);
    check('3. wrapped object accepted via key_unwrap', r[0] === 'Hola' && r[1] === 'Mundo' && r.step === 'key_unwrap', JSON.stringify(r));
  }
  // 4. [{"translation":"hola"}] -> accepted via object_map
  {
    const r = parseMtJson('[{"translation":"hola"}]', 1);
    check('4. array of translation-objects accepted via object_map', r[0] === 'hola' && r.step === 'object_map', JSON.stringify(r));
  }
  // 5. bare "hola" with expectedLen=1 -> accepted, step=bare_string
  {
    const r = parseMtJson('hola', 1);
    check('5. bare unquoted string accepted via bare_string (len 1 only)', r[0] === 'hola' && r.step === 'bare_string', JSON.stringify(r));
    const r2 = parseMtJson('"hola"', 1);
    check('5b. bare JSON string literal also accepted via bare_string', r2[0] === 'hola' && r2.step === 'bare_string', JSON.stringify(r2));
  }
  // 6. array of correct strings but WRONG length -> llm_json_invalid (no padding/truncation)
  {
    const e = throws(() => parseMtJson('["Hola"]', 2));
    check('6. wrong-length array is rejected, not padded/truncated', !!e && e.code === 'llm_json_invalid', String(e));
  }
  // 7. prose/garbage -> llm_json_invalid
  {
    const e = throws(() => parseMtJson('Sorry, I cannot help with that right now.', 2));
    check('7. prose/garbage rejected', !!e && e.code === 'llm_json_invalid', String(e));
  }
  // 8. array of 2 objects where one lacks a known key -> llm_json_invalid
  {
    const e = throws(() => parseMtJson('[{"translation":"hola"},{"foo":"bar"}]', 2));
    check('8. object_map rejects an element missing every known field', !!e && e.code === 'llm_json_invalid', String(e));
  }
  // Extra coverage: bare string must NOT be accepted when expectedLen > 1.
  {
    const e = throws(() => parseMtJson('hola', 2));
    check('extra: bare string never accepted for expectedLen > 1', !!e && e.code === 'llm_json_invalid', String(e));
  }
  // Extra coverage: a non-string element anywhere fails strict array match.
  {
    const e = throws(() => parseMtJson('["Hola", 5]', 2));
    check('extra: non-string element rejected (no coercion)', !!e && e.code === 'llm_json_invalid', String(e));
  }
})();

// ── _mtBatch: repair + split retry ladder (mocked Claude client) ────────────
async function runMtBatchTests() {
  // 9. attempt1 returns an unusable shape -> repair attempt2 succeeds -> translated
  {
    let calls = 0;
    mod._mtCallClaudeRaw = async (_system, user) => {
      calls++;
      if (/Reformat the content above/.test(user)) return '["Hola","Mundo"]'; // repair call
      return '{"translations":["Hola"]}'; // attempt 1: wrong length (expected 2) -> invalid
    };
    const { result: out, warns } = await withConsole(() => _mtBatch(['Hello', 'World'], 'es'));
    check('9. repair call recovers after attempt1 fails', out[0] === 'Hola' && out[1] === 'Mundo', JSON.stringify(out));
    check('9b. exactly 2 calls made (attempt1 + repair, no split needed)', calls === 2, String(calls));
    check('9c. a warn log was emitted for the repair path', warns.some((w) => /repaired via parse step/.test(w)), warns.join(' | '));
  }

  // 10. attempt1+2 both bad, chunk len 3 (<= MT_SPLIT_MAX_CHUNK) -> split fallback,
  //     3 single calls, reassembled in order.
  {
    const calls = [];
    mod._mtCallClaudeRaw = async (_system, user) => {
      calls.push(user);
      if (/Reformat the content above/.test(user)) return 'still not JSON'; // repair also fails
      // Single-string split calls arrive as a length-1 JSON array; translate deterministically.
      let parsedUser;
      try { parsedUser = JSON.parse(user); } catch (_) { parsedUser = null; }
      if (Array.isArray(parsedUser) && parsedUser.length === 1) {
        return JSON.stringify([parsedUser[0] + '-es']);
      }
      return 'garbage, not json'; // the original 3-item attempt1 call
    };
    const { result: out, warns } = await withConsole(() => _mtBatch(['A', 'B', 'C'], 'es'));
    check('10. split fallback reassembles translations in original order',
      out[0] === 'A-es' && out[1] === 'B-es' && out[2] === 'C-es', JSON.stringify(out));
    check('10b. split made one call per string (3 single-item calls + attempt1 + repair = 5)', calls.length === 5, String(calls.length));
    check('10c. a warn log named the split fallback', warns.some((w) => /splitting into 3 single-string calls/.test(w)), warns.join(' | '));
  }

  // 11. everything fails -> strings stay English (null, i.e. caller leaves the
  //     original text), no throw, error log emitted. (Chunk length 1 means an
  //     empty response is the only way to fail every rung: per spec step f,
  //     ANY non-empty text is accepted as the one translation when len === 1 —
  //     see the "garbage accepted via bare_string" case covered by test 12's
  //     sibling scenarios above, so a non-empty garbage reply would actually
  //     succeed here, not fail.)
  {
    mod._mtCallClaudeRaw = async () => '   ';
    const { result: out, errors } = await withConsole(() => _mtBatch(['Only'], 'fr'));
    check('11. unrecoverable chunk leaves the slot null (stays English)', out[0] === null, JSON.stringify(out));
    check('11b. an error log names the lang and chunk range', errors.some((e) => e.includes('lang=fr') && e.includes('chunk=0-1')), errors.join(' | '));
  }

  // Operator cap: a chunk bigger than MT_SPLIT_MAX_CHUNK (10) that fails both
  // attempts must NOT fan out into one call per string — it stays English.
  {
    const calls = [];
    mod._mtCallClaudeRaw = async (_system, user) => { calls.push(user); return 'garbage'; };
    const big = Array.from({ length: 11 }, (_, i) => `Str${i}`);
    const { result: out, errors } = await withConsole(() => _mtBatch(big, 'zh'));
    check('cap: all 11 slots stay null (no padding/guessing)', out.every((v) => v === null), JSON.stringify(out));
    check('cap: only 2 calls made (attempt1 + repair) — split skipped above the cap', calls.length === 2, String(calls.length));
    check('cap: error log reflects the failure', errors.some((e) => e.includes('lang=zh')), errors.join(' | '));
  }

  // 12. a salvage (non-strict) success on attempt 1 emits a warn log naming the step.
  {
    mod._mtCallClaudeRaw = async () => '```json\n["Bonjour"]\n```';
    const { result: out, warns } = await withConsole(() => _mtBatch(['Hello'], 'fr'));
    check('12. fenced attempt1 success still translates', out[0] === 'Bonjour', JSON.stringify(out));
    check('12b. warn log names the parse step (fence_strip)', warns.some((w) => /salvaged via parse step=fence_strip/.test(w)), warns.join(' | '));
  }

  // No-API-key guard is unchanged: still fails open with no calls at all.
  {
    const savedKey = process.env.ANTHROPIC_API_KEY;
    delete process.env.ANTHROPIC_API_KEY;
    let called = false;
    mod._mtCallClaudeRaw = async () => { called = true; return '["x"]'; };
    const out = await _mtBatch(['Hello'], 'es');
    check('no-key guard: still returns null without calling Claude', out[0] === null && called === false);
    process.env.ANTHROPIC_API_KEY = savedKey;
  }
}

runMtBatchTests().then(() => {
  if (failures) { console.error(`\nFAILED (${failures} failure${failures === 1 ? '' : 's'})`); process.exit(1); }
  console.log('\nALL PASS (0 failures)');
  process.exit(0);
}).catch((e) => {
  console.error('THREW', e && e.stack ? e.stack : e);
  process.exit(1);
});
