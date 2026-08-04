# Career Hub — Full Chinese Localization

Built on branch **`claude/career-hub-i18n`** (PR to follow). Full test suite (20 files) green, server boots clean.

## The key technical fact (why it's built this way)

Your translate button (`toggleLang` → `applyLangApp`) is a **static dictionary swap**: it replaces text from `APP_I18N.zh[key]` where a Chinese value exists. It is **not** a live AI translator.

- **Fixed UI text** → works perfectly with a dictionary. Done: every Career Hub label/button/nudge/error routes through `t()` and now has a Chinese entry in `APP_I18N.zh`.
- **AI-generated content** (quiz questions, options, explanations, interview Qs, scenario steps, gap report) → **cannot** live in a static dictionary, because each generation is unique and unbounded. `t('quiz_question_123')` would just return English forever. So per your chosen option, the **generator is now language-aware**: in Chinese mode the server generates that content *in Chinese*, cached separately by language.

Net effect: hit the 中文 button and the **entire** Career Hub — chrome *and* AI content — is Chinese. Nothing a user reads is hardcoded English.

## What was built

### 1. In-language AI generation (the core)
- Every prompt builder (`buildQuizPrompt`, `buildInterviewPrompt`, `buildGapPrompt`, `buildScenarioPrompt`) takes a `lang`; in `zh` it appends an instruction to write all user-facing values in Simplified Chinese (JSON keys stay English so validators are unchanged).
- Cache keys are **namespaced by language** (`quizCacheKey(..., lang)` etc.), so the Chinese quiz for a role is generated once and cached cross-user, independently of the English one. Bilingual users each hit a warm cache after the first.
- `/api/skills-lab/quiz`, `/api/interview/questions`, `/api/skills-gap`, `/api/scenario-lab/scenario`, `/api/interview/score`, `/api/career/coach` all read the request language and thread it through. The client sends the current `rt_lang` on every call.

### 2. All static UI → `t()` + `APP_I18N.zh`
- ~150 Career Hub strings wrapped in `t('ch_*', 'English')`, with a complete Simplified-Chinese dictionary merged into `APP_I18N.zh` at boot (`CH_I18N_ZH` in `public/career-hub.js`).
- Persistent DOM (sidebar buttons, profession picker) carries `data-i18n` so your existing `applyLangApp` swaps it directly.
- The site's **`toggleLang` is wrapped** so the open Career Hub tool re-renders in the new language the instant you press the button.

### 3. Profession names in Chinese (67 roles + 10 categories)
- `labelZh` added to `public/data/professions.json` (single source; the client picker reads it). `resolveProfession()` returns `labelZh` / `displayLabelZh` / `categoryLabelZh`, with the seniority prefix localized too (e.g. `高级注册护士`).
- Picker search matches Chinese input as well.

### 4. Badge page + job digest email localized
- `/badge/:slug?lang=zh` renders the whole page in Chinese (band = 金牌/银牌/铜牌, labels, date locale, `lang="zh-CN"`). Quiz result badge links carry the current language.
- The daily digest email is bilingual: subject `今天有 N 个新的[职业]职位` and Chinese body chrome. The user's language is stored on `check_ins.lang` (set when they pick a profession / toggle alerts) so the server-side email matches what they read.

### 5. Cache warm-up is language-aware
- `scripts/warm-career-cache.js` takes `WARM_LANGS` (default `en`; set `en,zh` to warm both). Warming Chinese too means the first Chinese user of a top-20 role also waits on nothing — at ~2× credits, so it's opt-in.

## Files touched
`career-hub.js` (lang in keys/prompts, zh label maps, digest lang), `badge-page.js` (lang), `server.js` (`_reqLang`, `check_ins.lang`, lang threaded into 6 routes + badge), `public/career-hub.js` (t()/data-i18n throughout, zh dictionary, toggle wrapper, lang on all calls), `public/data/professions.json` (labelZh), `scripts/*` (lang), tests, `CLAUDE.md`.

## Tests
- `test/career-hub.js`: language-namespaced cache keys, `langInstruction` on all four builders, Chinese profession/category labels (all 67), Chinese digest subject/body, Chinese badge render.
- `test/career-hub-routes.js`: a `lang:'zh'` quiz request served from the zh-keyed cache returns Chinese; `/badge/:slug?lang=zh` renders Chinese; profession POST persists `lang`.
- **Full suite: 20/20 green.**

## Notes / your call
- **Translations are machine-quality Simplified Chinese** written inline. If you have a preferred glossary (e.g. specific role titles), send it and I'll adjust the dictionary — it's one object, easy to tune.
- **Warming Chinese caches** (`WARM_LANGS=en,zh`) doubles the nightly warm-up credits. Left off by default; flip it on when Chinese traffic justifies it. The first Chinese user of any role still works — they just wait ~1–2s for that one generation, then it's cached for everyone.
- A user's language is captured when they set a profession or toggle alerts. If someone enabled alerts long ago in English and later switches to Chinese without re-touching those, their next profession-set or alert-toggle updates it.

*Reply with any glossary preferences or whether to enable Chinese cache warming, and I'll finish up. PR is a draft pending your review.*
