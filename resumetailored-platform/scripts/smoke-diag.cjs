/**
 * Diagnostics for the PR #639 smoke run. Harness-only: it changes no application behaviour.
 *
 * 1. instrument(ROOT) wraps a few lib/docs exports with pass-through loggers. The transpiled pipeline calls them
 *    as live export lookups (`(0, validate_1.checkEmployer)(...)`), so the wrappers see every call. Each wrapper
 *    calls the original with the same arguments and returns or re-throws its result unchanged. Logged:
 *    - every model call (cover letter / resume, employer, call number, any correction text, stop_reason, token
 *      usage, duration, and the raw API error if it throws),
 *    - every employer-gate check (ok, problems, otherEmployers, and the letter itself when the check fails),
 *    - any throw from JSON extraction / coercion / scrub / validate / renderDocument, with its stack.
 *    These show attempt 1 apart from the retry, and the gate apart from LLM/render failures. The guard in
 *    runVacancyPackage replaces a non-GenerationError with a generic message, so these logs are the only
 *    record of that raw error.
 * 2. dumpBatch(c, batchId) prints every batch item verbatim (id, status, errors[], flags) and every
 *    _REVIEW_REQUIRED.txt in the batch ZIP. smoke-staging.cjs calls it BEFORE cleanup deletes the rows.
 *
 * Every line goes to stdout (prefixed DIAG) and is also appended to $RUNNER_TEMP/smoke-diag.txt when that is
 * set, so the workflow's always() "Echo diagnostics" step can print them again in their own section.
 */
const fs = require("fs"), path = require("path"), JSZip = require("jszip");

const FILE = process.env.RUNNER_TEMP ? path.join(process.env.RUNNER_TEMP, "smoke-diag.txt") : null;
const T0 = Date.now();
const state = { phase: "setup" };
function log(...parts) {
  const line = `DIAG +${((Date.now() - T0) / 1000).toFixed(1)}s [${state.phase}] ` + parts.map((p) => (typeof p === "string" ? p : JSON.stringify(p))).join(" ");
  console.log(line);
  if (FILE) try { fs.appendFileSync(FILE, line + "\n"); } catch { /* diagnostics must never fail the run */ }
}
const errInfo = (e) => (e && typeof e === "object"
  ? { name: e.name, code: e.code, status: e.status, type: e.error && e.error.type, message: e.message, problems: e.problems, stack: e.stack && String(e.stack).split("\n").slice(0, 6).join(" | ") }
  : { thrown: String(e) });

function instrument(ROOT) {
  const mod = (p) => require(path.join(ROOT, p));
  const prompts = mod("lib/docs/prompts.ts"), validate = mod("lib/docs/validate.ts"), types = mod("lib/docs/types.ts");
  const scrub = mod("lib/docs/scrub.ts"), render = mod("lib/docs/docx-render.ts"), ai = mod("lib/ai.ts");

  let pending = null;
  const counters = new Map();
  const next = (k) => { const n = (counters.get(k) || 0) + 1; counters.set(k, n); return n; }
  for (const [fn, kind] of [["resumeUser", "resume"], ["coverLetterUser", "cover_letter"]]) {
    const orig = prompts[fn];
    prompts[fn] = function (v, profileText, prefs, correction) {
      const key = `${state.phase}|${kind}|${v && v.employer}|${v && v.id}`;
      pending = { kind, employer: v && v.employer, position: v && v.position, vacancyId: v && v.id, call: next(key), correction: correction || "" };
      return orig.apply(this, arguments);
    };
  }

  const replyCtx = new Map(); const objCtx = new WeakMap();
  const origGet = ai.getAnthropic;
  ai.getAnthropic = function () {
    const real = origGet.apply(this, arguments);
    if (!real) return real;
    const messages = new Proxy(real.messages, {
      get(t, k) {
        if (k !== "create") return Reflect.get(t, k);
        return async function (params) {
          const ctx = pending || { kind: "unknown" }; pending = null;
          const tag = `${ctx.kind} "${ctx.employer}" (vacancy ${ctx.vacancyId}) model call #${ctx.call}`;
          log(`LLM START ${tag}`, ctx.correction ? { correction: ctx.correction } : { correction: null });
          const s = Date.now();
          try {
            const m = await t.create.apply(t, arguments);
            const b = m && m.content && m.content[0];
            const text = b && b.type === "text" ? b.text : "";
            log(`LLM DONE  ${tag}`, { ms: Date.now() - s, stop_reason: m && m.stop_reason, usage: m && m.usage, firstBlock: b && b.type, textChars: text.length });
            if (text) replyCtx.set(text, tag);
            return m;
          } catch (e) {
            log(`LLM THREW ${tag}`, { ms: Date.now() - s, ...errInfo(e) });
            throw e;
          }
        };
      },
    });
    return new Proxy(real, { get: (t, k) => (k === "messages" ? messages : Reflect.get(t, k)) });
  };

  const origExtract = types.extractJson;
  types.extractJson = function (reply) {
    const tag = replyCtx.get(reply) || "unattributed reply"; replyCtx.delete(reply);
    try { const o = origExtract.apply(this, arguments); if (o && typeof o === "object") objCtx.set(o, tag); return o; }
    catch (e) { log(`EXTRACT_JSON THREW for ${tag}`, { ...errInfo(e), replyHead: String(reply).slice(0, 600), replyTail: String(reply).slice(-300) }); throw e; }
  };
  for (const fn of Object.keys(types).filter((k) => /^coerce/.test(k) && typeof types[k] === "function")) {
    const orig = types[fn];
    types[fn] = function (raw) {
      const tag = (raw && typeof raw === "object" && objCtx.get(raw)) || "unattributed";
      try {
        const out = orig.apply(this, arguments);
        if (fn === "coerceCoverLetterDoc") log(`COERCE OK ${fn} for ${tag}`, { keys: raw && Object.keys(raw), senderPresent: !!(out && out.sender), paragraphs: out && out.paragraphs && out.paragraphs.length });
        return out;
      } catch (e) { log(`COERCE THREW ${fn} for ${tag}`, { ...errInfo(e), rawKeys: raw && typeof raw === "object" ? Object.keys(raw) : typeof raw }); throw e; }
    };
  }

  const origCheck = validate.checkEmployer;
  validate.checkEmployer = function (letter, vacancy, opts) {
    const n = next(`${state.phase}|gate|${vacancy && vacancy.employer}|${vacancy && vacancy.id}`);
    const tag = `GATE "${vacancy && vacancy.employer}" (vacancy ${vacancy && vacancy.id}) check #${n}`;
    let r;
    try { r = origCheck.apply(this, arguments); }
    catch (e) { log(`${tag} THREW`, errInfo(e)); throw e; }
    const base = { ok: r && r.ok, problems: r && r.problems, otherEmployers: opts && opts.otherEmployers };
    if (r && r.ok) log(`${tag} PASS`, base);
    else log(`${tag} FAIL`, { ...base, letter: letter && { employer: letter.employer, position: letter.position, salutation: letter.salutation, paragraphs: letter.paragraphs, signOff: letter.signOff } });
    return r;
  };

  const wrapThrows = (m, label, names) => {
    for (const fn of names) {
      const orig = m[fn]; if (typeof orig !== "function") continue;
      m[fn] = function () {
        let out;
        try { out = orig.apply(this, arguments); } catch (e) { log(`${label}.${fn} THREW`, errInfo(e)); throw e; }
        if (out && typeof out.then === "function") return out.catch((e) => { log(`${label}.${fn} REJECTED`, errInfo(e)); throw e; });
        return out;
      };
    }
  };
  wrapThrows(render, "docx-render", ["renderDocument"]);
  wrapThrows(scrub, "scrub", ["scrubDeep", "findBanned"]);
  wrapThrows(validate, "validate", ["norm", "verifyResumeAgainstProfile"]);
  log("instrumentation installed", { file: FILE });
}

async function dumpBatch(c, batchId, getFile) {
  log("===== BATCH DUMP (before cleanup) =====", { batchId });
  if (!batchId) { log("no batch was created — nothing to dump"); return; }
  try {
    const { data: b, error: be } = await c.from("document_batches").select("*").eq("id", batchId).maybeSingle();
    log("batch row", be ? { error: be } : { id: b && b.id, status: b && b.status, zip_path: b && b.zip_path });
    const { data: items, error: ie } = await c.from("document_batch_items").select("*").eq("batch_id", batchId).order("position", { ascending: true });
    if (ie) log("items query error", ie);
    for (const it of items || []) {
      const { data: v } = await c.from("vacancies").select("id, employer, position").eq("id", it.vacancy_id).maybeSingle();
      log(`ITEM position=${it.position} id=${it.id} status=${it.status}`, { vacancy: v, resume_path: it.resume_path, cover_path: it.cover_path });
      log(`ITEM id=${it.id} errors[] (verbatim):`, it.errors);
      log(`ITEM id=${it.id} flags (verbatim):`, it.flags);
    }
    if (b && b.zip_path) {
      const zip = await JSZip.loadAsync(await getFile(b.zip_path));
      const names = Object.keys(zip.files).filter((n) => !zip.files[n].dir).sort();
      log("ZIP entries", names);
      const reviews = names.filter((n) => /(^|\/)_REVIEW_REQUIRED\.txt$/.test(n));
      if (!reviews.length) log("no _REVIEW_REQUIRED.txt in the ZIP");
      for (const n of reviews) {
        const txt = await zip.file(n).async("string");
        log(`----- BEGIN ${n} (verbatim) -----`);
        for (const line of txt.split("\n")) log(`| ${line}`);
        log(`----- END ${n} -----`);
      }
    } else log("batch has no zip_path — no ZIP to read");
  } catch (e) {
    log("BATCH DUMP FAILED (cleanup still runs)", errInfo(e));
  }
  log("===== END BATCH DUMP =====");
}

module.exports = { instrument, dumpBatch, log, state };
