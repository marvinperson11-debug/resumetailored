#!/usr/bin/env node
/**
 * Resume Video regression test (npm run test:resume-video).
 * - The generated voiceover MP3 travels to the renderer intact, as a data:audio URL, so it is muxed in as the MP4's audio track.
 * - The voice dropdown's selection is the voice generation uses; samples use the same ElevenLabs settings as generation.
 * - The page has no browser-TTS preview, exactly one video player, no blue script-preview box, one voiceover control area.
 */
const fs = require("fs");
const path = require("path");
const ts = require("typescript");
const ROOT = path.resolve(__dirname, "..");
require.extensions[".ts"] = (module, filename) => {
  const out = ts.transpileModule(fs.readFileSync(filename, "utf8"), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020, esModuleInterop: true } });
  module._compile(out.outputText, filename);
};
const render = require(path.join(ROOT, "lib/resume-video-render.ts"));
const ai = require(path.join(ROOT, "lib/video-ai.ts"));
const vs = require(path.join(ROOT, "lib/video-settings.ts"));
let failures = 0;
const check = (name, ok, detail) => { if (ok) console.log("PASS ", name); else { failures++; console.error("FAIL ", name, detail ? "— " + detail : ""); } };
const read = (p) => fs.readFileSync(path.join(ROOT, p), "utf8");

// ── The voiceover reaches the renderer untouched (it muxes a data:audio URL as the MP4 audio track) ──
const mp3 = "data:audio/mpeg;base64," + Buffer.from("ID3-fake-mp3-bytes".repeat(2000)).toString("base64");
const p = render.buildRenderPayload({ script: "Hello there, this is my script.", resume: "", style: "#1e3a8a", audioUrl: mp3, title: "Resume video" }, "user_1");
check("payload carries the voiceover data URL byte-for-byte", p.audioUrl === mp3);
check("payload keeps script, style and user", p.script.startsWith("Hello") && p.style === "#1e3a8a" && p.userId === "user_1");
check("a non-audio / remote audioUrl is not forwarded (the renderer only muxes data:audio)", render.buildRenderPayload({ script: "x".repeat(20), audioUrl: "https://example.com/a.mp3" }, "u").audioUrl === undefined && render.buildRenderPayload({ script: "x".repeat(20), audioUrl: "data:text/html;base64,AAAA" }, "u").audioUrl === undefined);
check("no audio → no audioUrl (silent render stays silent on purpose)", render.buildRenderPayload({ script: "x".repeat(20) }, "u").audioUrl === undefined);
const route = read("app/api/resume-video/mp4/route.ts");
check("the MP4 route builds the renderer payload through buildRenderPayload", /buildRenderPayload\(body, userId\)/.test(route));

// ── Voice: the dropdown value is what generation uses; samples use the same settings ──
const ui = read("app/candidate/tools/resume-video.tsx");
const vo = read("app/api/resume-video/voiceover/route.ts");
check("the voiceover route maps that voice to the ElevenLabs voice id", /voiceIdForKey\(body\.voice\)/.test(vo));
check("the voiceover route and the sample generator share one set of ElevenLabs settings", /elevenLabsRequestBody\(text, process\.env\.ELEVENLABS_MODEL_ID\)/.test(vo) && /elevenLabsRequestBody\(text, process\.env\.ELEVENLABS_MODEL_ID\)/.test(read("scripts/generate-voice-samples.cjs")));
const body = ai.elevenLabsRequestBody("hi");
check("settings are the ones generation always used", body.model_id === "eleven_multilingual_v2" && body.voice_settings.stability === 0.5 && body.voice_settings.similarity_boost === 0.75);
check("sample line names the voice", ai.voiceSampleText("Rachel — calm & professional") === "Hi, I'm Rachel, and this is how I'll sound in your video.");
check("every voice has a sample url", ai.VIDEO_VOICES.every((v) => ai.voiceSampleUrl(v.key) === `/voice-samples/${v.key}.mp3`));

// ── Page simplification ──
const whole = ui + read("lib/video-ai.ts");
check("no browser text-to-speech anywhere", !/speechSynthesis|SpeechSynthesisUtterance|browserPreview/.test(whole));
check("exactly one video player", (ui.match(/<video\b/g) || []).length === 1);
check("no <audio controls> second player (voiceover is driven by one Play button)", !/<audio[^>]*controls/.test(ui));
check("the blue script-preview box is gone", !/linear-gradient\(135deg, \$\{tpl\.accent\}/.test(ui) && !/aspect-video flex-col items-center justify-center gap-3 p-6 text-center/.test(ui));
check("the browser-preview string is removed from every locale", ["en", "es", "fr", "hi", "zh"].every((l) => !/previewVoiceBrowser/.test(read(`messages/${l}.json`))));
check("slide structure untouched (script scene parser still exported and unchanged API)", typeof ai.parseScriptScenes === "function");


// ── Part 2: slide flips follow the narration's real (ElevenLabs) timestamps ──
const SCRIPT = "HOOK: Hello, I'm Jordan Lee, a backend engineer.\nPROOF: I cut latency by 42 percent.\nSTRENGTHS: I lead teams and ship reliably.\nCLOSE: I'm looking for my next role. Thank you for your time.";
const { text: spoken, spans } = ai.scriptSpeechWithSpans(SCRIPT);
check("the spoken text is exactly what scriptToSpeech sends (unchanged)", spoken === ai.scriptToSpeech(SCRIPT));
check("four beats map to four character spans over that text", spans.length === 4 && spans.every((sp) => spoken.slice(sp.start, sp.end).length > 0) && spoken.slice(spans[1].start, spans[1].end).startsWith("I cut latency"));
// A fake alignment: character i is spoken at i * 0.05s.
const aln = { characters: spoken.split(""), character_start_times_seconds: spoken.split("").map((_, i) => i * 0.05), character_end_times_seconds: spoken.split("").map((_, i) => (i + 1) * 0.05) };
const built = ai.buildSceneStarts(aln, spoken, spans);
check("slide starts come straight from the timestamps (beat start minus the small lead)", built && built.sceneStarts.length === 4 && built.sceneStarts[0] === 0 && Math.abs(built.sceneStarts[1] - (spans[1].start * 0.05 - ai.SLIDE_LEAD_SECONDS)) < 0.002 && Math.abs(built.sceneStarts[3] - (spans[3].start * 0.05 - ai.SLIDE_LEAD_SECONDS)) < 0.002);
check("starts are non-decreasing and the duration is the last character's end", built && built.sceneStarts.every((n, i, a) => i === 0 || n >= a[i - 1]) && Math.abs(built.durationSeconds - spoken.length * 0.05) < 1e-9);
check("no alignment → null (the caller keeps the fixed timing; nothing is estimated)", ai.buildSceneStarts(undefined, spoken, spans) === null && ai.buildSceneStarts(null, spoken, spans) === null);
check("alignment for different text → null", ai.buildSceneStarts({ ...aln, characters: aln.characters.slice(0, -3) }, spoken, spans) === null && ai.buildSceneStarts({ ...aln, characters: aln.characters.map((c) => c.toUpperCase()) }, spoken, spans) === null);
check("an unlabelled script has no beats → null", ai.scriptSpeechWithSpans("Just a plain paragraph of speech.").spans.length === 0 && ai.buildSceneStarts(aln, spoken, []) === null);
const vo2 = read("app/api/resume-video/voiceover/route.ts");
check("the voiceover route uses /with-timestamps with the same voice settings, and falls back to plain audio", /text-to-speech\/\$\{voiceId\}\/with-timestamps/.test(vo2) && /text-to-speech\/\$\{voiceId\}`/.test(vo2) && (vo2.match(/elevenLabsRequestBody\(text, process\.env\.ELEVENLABS_MODEL_ID\)/g) || []).length === 1 && /aligned: !!sceneStarts/.test(vo2));

// ── Part 2: settings are validated, saved per user and reach the renderer ──
const JPEG = "data:image/jpeg;base64," + Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0, 0x10, 0x4a, 0x46, 0x49, 0x46, 0, 1, 1, 0, 0, 1, 0, 1]).toString("base64");
const PNG = "data:image/png;base64," + Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 0x0d, 0x49, 0x48, 0x44, 0x52]).toString("base64");
check("a real jpeg and png headshot pass", vs.cleanHeadshot(JPEG) === JPEG && vs.cleanHeadshot(PNG) === PNG);
check("webp, gif, svg, html and a mislabelled file are refused", [
  "data:image/webp;base64,UklGRg==", "data:image/gif;base64,R0lGODlh", "data:image/svg+xml;base64,PHN2Zz48L3N2Zz4=", "data:text/html;base64,PGI+", "https://example.com/a.jpg",
  "data:image/png;base64," + Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0]).toString("base64"),
].every((v) => vs.cleanHeadshot(v) === null));
check("an oversized headshot is refused", vs.cleanHeadshot(JPEG + "A".repeat(vs.MAX_HEADSHOT_DATA_URL_CHARS)) === null);
check("background colour must be #rrggbb (lower-cased); anything else is the default look", vs.cleanHexColor("#10223A") === "#10223a" && ["red", "#fff", "url(x)", "#12345g", 5, null].every((v) => vs.cleanHexColor(v) === null));
const cs = vs.cleanVideoSettings({ voice: "nope", backgroundColor: "#ABCDEF", headshot: JPEG, headshotX: 4, headshotY: -2, everySlide: "yes" });
check("settings are cleaned: unknown voice → default, position clamped to 0–1, every-slide strictly boolean", cs.voice === "rachel" && cs.backgroundColor === "#abcdef" && cs.headshotX === 1 && cs.headshotY === 0 && cs.everySlide === false);
check("defaults: title slide only, default look, no headshot", vs.DEFAULT_VIDEO_SETTINGS.everySlide === false && vs.DEFAULT_VIDEO_SETTINGS.backgroundColor === null && vs.DEFAULT_VIDEO_SETTINGS.headshot === null && JSON.stringify(vs.cleanVideoSettings(undefined)) === JSON.stringify(vs.DEFAULT_VIDEO_SETTINGS));
const pay = render.buildRenderPayload({ script: "x".repeat(20), audioUrl: mp3, sceneStarts: [0, 3, 6, 9], settings: { backgroundColor: "#10223a", headshot: JPEG, headshotX: 0.2, headshotY: 0.3, everySlide: true } }, "u");
check("the render payload carries colour, headshot + placement, slide starts and quick pacing", pay.backgroundColor === "#10223a" && pay.photoUrl === JPEG && pay.photoOverlay.x === 0.2 && pay.photoOverlay.y === 0.3 && pay.photoOverlay.everySlide === true && JSON.stringify(pay.sceneStarts) === "[0,3,6,9]" && pay.quick === true);
const bare = render.buildRenderPayload({ script: "x".repeat(20), sceneStarts: [0, 3, 6, 9] }, "u");
check("no voiceover → no slide starts; no settings → no colour/headshot (default look)", bare.sceneStarts === undefined && bare.backgroundColor === undefined && bare.photoUrl === undefined && bare.photoOverlay === undefined);
check("bad slide starts are not forwarded", ["abc", [0, 1, 2], [1, 2, 3, 4], [0, 5, 3, 9], [0, 1, 2, NaN]].every((v) => render.buildRenderPayload({ script: "x".repeat(20), audioUrl: mp3, sceneStarts: v }, "u").sceneStarts === undefined));
check("a headshot that isn't a jpeg/png never reaches the renderer", render.buildRenderPayload({ script: "x".repeat(20), settings: { headshot: "data:image/webp;base64,UklGRg==" } }, "u").photoUrl === undefined);

// ── Part 2: the controls are on the pre-generation screen ──
const left = ui.slice(ui.indexOf("{/* Left: inputs */}"), ui.indexOf("{/* Right: voiceover"));
const panel = read("app/candidate/tools/resume-video-settings.tsx");
check("headshot upload accepts only jpeg/png, is size-limited, and the preview is draggable", /accept="image\/jpeg,image\/png"/.test(panel) && /MAX_UPLOAD_BYTES/.test(panel) && /onPointerMove/.test(panel) && /everySlide/.test(panel) && /type="color"/.test(panel));
check("settings persist per user: route + store + migration", /video_settings/.test(read("lib/video-settings-store.ts")) && /add column if not exists video_settings jsonb/.test(read("supabase/migrations/0046_resume_video_settings.sql")) && /cleanVideoSettings/.test(read("app/api/resume-video/settings/route.ts")));
const KEYS = ["videoSettings", "backgroundColor", "headshotUpload", "headshotEverySlide", "slidesSynced", "slidesFixedTiming", "errorHeadshotType", "generateVideo", "regenerateVideo", "generatingVideo", "stepScript", "stepVoice", "stepRender", "playerEmpty", "voiceoverSkipped", "yours"];
check("every new string exists in all five locales", ["en", "es", "fr", "hi", "zh"].every((l) => { const rv = JSON.parse(read(`messages/${l}.json`)).candidateTools.resumeVideo; return KEYS.every((k) => typeof rv[k] === "string" && rv[k]); }));

// ── Part 3: one tap = script → voiceover (chosen voice) → rendered MP4 ──
const gen = ui.slice(ui.indexOf("async function generateVideo()"), ui.indexOf("async function copyMp4Link"));
const iScript = gen.indexOf('"/api/resume-video/script"'), iVoice = gen.indexOf('"/api/resume-video/voiceover"'), iMp4 = gen.indexOf('"/api/resume-video/mp4"');
check("one generate action runs script, then voiceover, then render — in that order, with no click between", iScript > 0 && iVoice > iScript && iMp4 > iVoice && (gen.match(/await postJson/g) || []).length === 3);
check("the voiceover uses the voice chosen in Video settings and its script comes from step one", /\/api\/resume-video\/voiceover"[\s\S]{0,40}\{\s*script: finalScript, voice,/.test(gen) && /scriptToEditableText\(sc\.data\.script\)/.test(gen) && /const finalScript = scriptText/.test(gen));
check("the render gets the voiceover audio, its slide starts and the settings", /audioUrl: audio,[\s\S]{0,120}sceneStarts: audio && starts \? starts : undefined,[\s\S]{0,40}settings,/.test(gen));
check("a voiceover that can't be made still renders the video (without narration), and says so", /setNote\(t\("voiceoverSkipped"\)\)/.test(gen) && /audio = vo\.data\.audio/.test(gen));
check("a new generation clears the previous render first", /setMp4Url\(null\);[\s\S]{0,200}setStep\(useAsIs/.test(gen));
check("a double click or a closed modal can't run two flows / update a dead page", /const run = \+\+runId\.current/.test(gen) && /runId\.current === run/.test(gen) && /loading=\{generating\}/.test(ui));
check("the voice picker still has per-voice sample playback in the settings", /voicePicker=\{<VoicePicker/.test(ui) && /playSample\(v\.key\)/.test(ui));
check("Video settings sit in the left column with the generate button on the same screen", ui.indexOf("<VideoSettingsPanel") > 0 && ui.indexOf("<VideoSettingsPanel") < ui.indexOf("{/* Right:") && /onClick=\{generateVideo\}/.test(ui));
check("the MP4 request body carries the settings and slide starts", /settings,\n/.test(gen));
const uiNoComments = ui.replace(/\{\/\*[\s\S]*?\*\/\}/g, "").replace(/\/\/.*$/gm, "");
check("no Generate voiceover / Generate MP4 / Re-render buttons, no voiceover playback or MP3 download", !/generateVoiceover|generateMp4|reRenderMp4|playVoiceover|downloadMp3|downloadAudio|togglePlay|<audio\b|new Audio\(audio/.test(uiNoComments.replace(/new Audio\(voiceSampleUrl/g, "")));
check("no voice label row after generation", !/voiceUsed/.test(ui));
check("after the video appears the only actions are Download and Share (copy link)", /downloadMp4/.test(ui) && /copyMp4Link/.test(ui) && (ui.slice(ui.indexOf("{/* Right:")).match(/<button\b|<a\b/g) || []).length === 2);
check("progress state names what is happening, and the old render-it-yourself empty state is gone", /t\("generatingVideo"\)/.test(ui) && /t\("stepVoice"\)/.test(ui) && /t\("stepRender"\)/.test(ui) && !/playerIdle/.test(ui));

// ── Part 3: custom openers / closers are remembered and offered next time ──
check("more built-in presets for both dropdowns", ["Hello", "Hi", "Good morning", "Greetings"].every((x) => ai.GREETING_OPTIONS.includes(x)) && ["Thank you for your time", "Thanks for watching", "I look forward to speaking with you", "Let's connect soon"].every((x) => ai.CLOSING_OPTIONS.includes(x)));
let mine = vs.rememberPhrase([], "Hey team", ai.GREETING_OPTIONS, vs.MAX_OPENER_CHARS);
check("a typed opener that isn't a preset is saved", mine.length === 1 && mine[0] === "Hey team");
check("a preset (any case) or a blank is not saved", vs.rememberPhrase(mine, "hello", ai.GREETING_OPTIONS, 60) === mine && vs.rememberPhrase(mine, "   ", ai.GREETING_OPTIONS, 60) === mine);
check("a repeat is not duplicated; the newest custom goes first", vs.rememberPhrase(mine, "HEY TEAM", ai.GREETING_OPTIONS, 60) === mine && vs.rememberPhrase(mine, "Howdy", ai.GREETING_OPTIONS, 60)[0] === "Howdy");
const many = Array.from({ length: 40 }, (_, i) => "c" + i);
check("the saved list is capped and text is length-limited, single-line", vs.cleanPhraseList(many, 60).length === vs.MAX_CUSTOM_PHRASES && vs.cleanPhraseList(["a\n\nb\tc"], 60)[0] === "a b c" && vs.cleanPhraseList(["x".repeat(500)], 60)[0].length === 60 && vs.cleanPhraseList("nope", 60).length === 0);
const withCustom = vs.cleanVideoSettings({ customOpeners: ["Yo", "yo", 5, ""], customClosers: ["Onward!"] });
check("custom openers/closers persist inside the same video_settings object (no migration of their own)", JSON.stringify(withCustom.customOpeners) === '["Yo"]' && withCustom.customClosers[0] === "Onward!" && !/video_settings/.test(read("supabase/migrations/0047_saved_resume_videos.sql")));
check("the flow saves what was typed, and the dropdowns list the user's own first, tagged", /rememberPhrase\(st\.customOpeners, greeting, GREETING_OPTIONS/.test(gen) && /rememberPhrase\(st\.customClosers, closing, CLOSING_OPTIONS/.test(gen) && /settings\.customOpeners\.map[\s\S]{0,160}GREETING_OPTIONS\.map/.test(ui) && /settings\.customClosers\.map[\s\S]{0,160}CLOSING_OPTIONS\.map/.test(ui) && /t\("yours"\)/.test(ui));
check("custom phrases never reach the renderer", !("customOpeners" in render.buildRenderPayload({ script: "x".repeat(20), settings: withCustom }, "u")));

// ═════════════ Part 4: script source, saved videos, edit from the dashboard ═════════════
const sv = require(path.join(ROOT, "lib/saved-videos.ts"));
const plan = require(path.join(ROOT, "lib/video-script-plan.ts")).planScript;

// An in-memory backend (files + rows). `leaky` ignores the owner on reads, to prove the logic re-checks ownership itself.
function memBackend({ leaky = false } = {}) {
  const files = new Map(), rows = new Map(), log = [];
  return {
    files, rows, log,
    async insertRow(r) { rows.set(r.id, { ...r }); return true; },
    async listRows(u) { return [...rows.values()].filter((r) => leaky || r.userId === u).sort((a, b) => b.createdAt.localeCompare(a.createdAt)); },
    async getRow(u, id) { const r = rows.get(id); return r && (leaky || r.userId === u) ? { ...r } : null; },
    async deleteRow(u, id) { const r = rows.get(id); if (!r || (!leaky && r.userId !== u)) return false; rows.delete(id); log.push("row:" + id); return true; },
    async putFile(p, b) { files.set(p, Buffer.from(b)); return true; },
    async removeFiles(ps) { for (const p of ps) { files.delete(p); log.push("file:" + p); } },
    async getFile(p) { return files.get(p) || null; },
    async signedUrl(p, secs, as) { return files.has(p) ? `https://signed.example/${p}?e=${secs}${as ? "&dl=" + as : ""}` : null; },
  };
}
const META = (over = {}) => sv.cleanSavedMeta({
  script: "Hello Sarah, I'm Jordan Lee, a designer.\nI grew revenue 40%.\nI lead with empathy.\nThank you for your time.",
  scriptSource: "ai", toWhom: "Sarah Johnson", opener: "Hello", closer: "Thank you for your time", template: "warm",
  resumeText: "Jordan Lee — Designer. ".repeat(5),
  settings: { voice: "adam", backgroundColor: "#10223A", headshot: JPEG, headshotX: 0.3, headshotY: 0.6, everySlide: true, customOpeners: ["Yo"], customClosers: ["Bye"] },
  ...over,
});
const MP4 = new Uint8Array(Buffer.from("fake-mp4-bytes".repeat(500)));
(async () => {
  const gen4 = ui.slice(ui.indexOf("async function generateVideo"), ui.indexOf("async function copyMp4Link"));

  // ── 1. Script source: write it yourself, or AI ──
  check("the script area has two explicit choices: write it yourself, and AI script", /aria-pressed=\{scriptSource === src\}/.test(ui) && /t\("scriptWriteYourself"\)/.test(ui) && /t\("scriptAi"\)/.test(ui) && /\["written", "ai"\] as const/.test(ui));
  check("a written script is used as typed, with no AI call (and is never flagged as edited)", JSON.stringify(plan({ source: "written", typed: "my own words here", base: null, key: "k" })) === '{"useAsIs":true,"edited":false}' && JSON.stringify(plan({ source: "written", typed: "my own words here", base: { script: "ai text", key: "k" }, key: "other" })) === '{"useAsIs":true,"edited":false}');
  check("the script request is made only when the plan says the AI should write it", /if \(!useAsIs\) \{[\s\S]{0,200}\/api\/resume-video\/script/.test(gen4) && (gen4.match(/\/api\/resume-video\/script/g) || []).length === 1);
  check("an empty AI box is written by the AI; an untouched AI script with unchanged inputs is reused; changed inputs rewrite it", plan({ source: "ai", typed: "", base: null, key: "k" }).useAsIs === false && plan({ source: "ai", typed: "ai text", base: { script: "ai text", key: "k" }, key: "k" }).useAsIs === true && plan({ source: "ai", typed: "ai text", base: { script: "ai text", key: "k" }, key: "k2" }).useAsIs === false);
  const edited = plan({ source: "ai", typed: "ai text, but my edit", base: { script: "ai text", key: "k" }, key: "k2" });
  check("an edited AI script is used exactly as edited (even if the recipient changed) and recorded as edited", edited.useAsIs === true && edited.edited === true);
  check("a written script can't be empty; same for an edited one", /if \(useAsIs && typed\.length < 10\)/.test(gen4) && /errorWriteScriptFirst/.test(gen4));
  check("timestamps are mapped on a written script: four lines are the four beats", (() => { const w = "Hi, I'm Alex.\nI cut costs 30%.\nI am a strong leader.\nThanks for watching."; const r = ai.scriptSpeechWithSpans(w); return r.spans.length === 4 && r.text === "Hi, I'm Alex. I cut costs 30%. I am a strong leader. Thanks for watching." && r.spans.every((sp) => r.text.slice(sp.start, sp.end).length > 0); })());
  const long = "One. Two is here. Three is longer than the others by a fair bit. Four. Five has words. Six closes it out.";
  const lr = ai.scriptSpeechWithSpans(long);
  check("a longer written script groups into four beats and none of it is dropped", lr.spans.length === 4 && lr.text === "One. Two is here. Three is longer than the others by a fair bit. Four. Five has words. Six closes it out." && ai.splitUnlabeledBeats(long).join(" ") === lr.text);
  check("a script too short to split into four beats falls back to fixed timing (no spans), and is still narrated in full", ai.scriptSpeechWithSpans("Just two. Sentences here.").spans.length === 0 && ai.scriptToSpeech("Just two. Sentences here.") === "Just two. Sentences here.");
  check("AI scripts behave as before: labels are stripped, four labelled beats", ai.scriptSpeechWithSpans(SCRIPT).spans.length === 4 && ai.scriptToEditableText(SCRIPT).split("\n").length === 4 && !/HOOK|PROOF/.test(ai.scriptToEditableText(SCRIPT)));
  const editedSpeech = ai.scriptSpeechWithSpans(ai.scriptToEditableText(SCRIPT).replace("Hello", "Hi there"));
  check("an edited script is what is narrated, still four slide-synced beats", editedSpeech.text.startsWith("Hi there") && editedSpeech.spans.length === 4);
  check("the voiceover and the render are both fed the box's final script (edits drive them)", /script: finalScript, voice/.test(gen4) && /script: finalScript,\s*\n\s*resume: resumeText/.test(gen4));
  check("edits survive a regenerate: the box is only rewritten when the AI wrote a new script, and editing alone triggers nothing", (ui.match(/setScript\(/g) || []).length === 3 && /setScript\(scriptText\)/.test(gen4) && /onChange=\{\(e\) => setScript\(e\.target\.value\)\}/.test(ui) && !/useEffect\([^)]*generateVideo/.test(ui) && !/setMp4Url\(null\)[^;]*\n[^\n]*setScript\(e\.target/.test(ui));
  check("one button re-runs the whole pipeline from the edited text: 'Regenerate video with your edits'", /mp4Url \? t\("regenerateVideo"\) : t\("generateVideo"\)/.test(ui) && ["en", "es", "fr", "hi", "zh"].every((l) => JSON.parse(read(`messages/${l}.json`)).candidateTools.resumeVideo.regenerateVideo.length > 5) && JSON.parse(read("messages/en.json")).candidateTools.resumeVideo.regenerateVideo === "Regenerate video with your edits");
  check("the same voice, headshot, colour and one-tap pipeline apply to both sources", /settings,\n/.test(gen4) && /scriptSource,/.test(gen4) && iOrder(gen4));
  function iOrder(g) { return g.indexOf("/api/resume-video/voiceover") < g.indexOf("/api/resume-video/mp4"); }

  // ── 2. Saving: MP4 + script TXT + metadata, as new entries, capped ──
  const be = memBackend();
  const meta = META();
  check("metadata is kept: script, source, voice, colour, headshot + position, opener/closer, recipient, date", meta && meta.scriptSource === "ai" && meta.settings.voice === "adam" && meta.settings.backgroundColor === "#10223a" && meta.settings.headshot === JPEG && meta.settings.headshotX === 0.3 && meta.settings.headshotY === 0.6 && meta.settings.everySlide === true && meta.opener === "Hello" && meta.closer === "Thank you for your time" && meta.toWhom === "Sarah Johnson" && meta.template === "warm");
  check("the user's saved opener/closer lists are not stored with a video", meta.settings.customOpeners.length === 0 && meta.settings.customClosers.length === 0);
  check("a script that is too short isn't saved; bad enums fall back", sv.cleanSavedMeta({ script: "short" }) === null && sv.cleanSavedMeta({ script: "x".repeat(40), scriptSource: "weird", template: "nope" }).scriptSource === "ai" && sv.cleanSavedMeta({ script: "x".repeat(40), template: "nope" }).template === "professional");
  const saved1 = await sv.saveVideo(be, "user_A", meta, MP4, { id: "11111111-1111-4111-8111-111111111111", now: () => new Date("2026-10-01T10:00:00Z") });
  check("the MP4 and the script are stored as files in the user's own folder", saved1 && be.files.has("user_A/11111111-1111-4111-8111-111111111111.mp4") && be.files.has("user_A/11111111-1111-4111-8111-111111111111.txt") && be.files.get(saved1.videoPath).length === MP4.length);
  const txt = be.files.get(saved1.scriptPath).toString();
  check("the script file is a plain text copy of the script (no HOOK:/PROOF: labels)", txt.includes("Hello Sarah, I'm Jordan Lee") && txt.includes("Thank you for your time") && !/HOOK|PROOF|STRENGTHS|CLOSE:/.test(txt) && txt.endsWith("\n"));
  check("a row with the metadata is stored", be.rows.size === 1 && be.rows.get(saved1.id).script === meta.script && be.rows.get(saved1.id).sizeBytes === MP4.length);
  const fileForBadInsert = memBackend(); fileForBadInsert.insertRow = async () => false;
  check("if the row can't be written the files are cleaned up (no orphans)", (await sv.saveVideo(fileForBadInsert, "user_A", meta, MP4)) === null && fileForBadInsert.files.size === 0);
  check("an empty or oversized render isn't saved", (await sv.saveVideo(memBackend(), "user_A", meta, new Uint8Array(0))) === null);
  check("the MP4 route saves every successful render through saveVideo and reports savedId; a storage failure never fails the render", /saveVideo\(be, userId, meta,/.test(route) && /savedId/.test(route) && /catch \(e\) \{\s*console\.error\("\[resume-video\/mp4\] save failed"/.test(route));

  // Regenerate from an edit → a NEW entry; the original is untouched.
  const before = JSON.stringify(be.rows.get(saved1.id)), beforeBytes = Buffer.from(be.files.get(saved1.videoPath));
  const fromEdit = META({ toWhom: "Priya Patel", script: "Hello Priya, I'm Jordan Lee, a designer.\nI grew revenue 40%.\nI lead with empathy.\nThank you for your time.", scriptEdited: true });
  const saved2 = await sv.saveVideo(be, "user_A", fromEdit, MP4, { now: () => new Date("2026-10-02T10:00:00Z") });
  check("a regenerate-from-edit is saved as a NEW entry with its own id and files", saved2 && saved2.id !== saved1.id && saved2.videoPath !== saved1.videoPath && be.rows.size === 2);
  check("the original saved video (row and files) is untouched", JSON.stringify(be.rows.get(saved1.id)) === before && be.files.get(saved1.videoPath).equals(beforeBytes) && be.files.has(saved1.scriptPath));
  check("saving never updates or overwrites a row (insert only), and files are never upserted over", !/\.update\(|upsert: true/.test(read("lib/saved-videos-store.ts")) && /upsert: false/.test(read("lib/saved-videos-store.ts")));
  const list = await sv.listSavedVideos(be, "user_A");
  check("the list is newest first", list.length === 2 && list[0].id === saved2.id);

  // ── 3. Edit pre-fills the creator ──
  const detail = await sv.getSavedVideo(be, "user_A", saved1.id);
  check("a saved video returns everything the creator needs to be pre-filled exactly", detail && detail.script === meta.script && detail.scriptSource === "ai" && detail.toWhom === "Sarah Johnson" && detail.opener === "Hello" && detail.closer === "Thank you for your time" && detail.template === "warm" && detail.resumeText === meta.resumeText && detail.settings.voice === "adam" && detail.settings.backgroundColor === "#10223a" && detail.settings.headshot === JPEG && detail.settings.headshotX === 0.3 && detail.settings.headshotY === 0.6);
  const prefill = ui.slice(ui.indexOf("const v: SavedVideoDetail"), ui.indexOf("// Load the saved settings once"));
  check("the creator applies every field from the saved video", ["setResumeText(v.resumeText)", "setTemplate(v.template)", "setToWhom(v.toWhom)", "setGreeting(opener)", "setClosing(closer)", "setScriptSource(v.scriptSource)", "setScript(v.script)", "withSavedLook(st, v.settings)"].every((x) => prefill.includes(x)));
  check("the saved look (voice, colour, headshot + position) wins over the account settings that load afterwards", /lookFromSaved\.current = v\.settings/.test(prefill) && /withSavedLook\(d\.settings, lookFromSaved\.current\)/.test(ui) && /headshotX: look\.headshotX, headshotY: look\.headshotY/.test(ui));
  check("pre-filling starts nothing: the user presses the button", !/generateVideo\(/.test(prefill));
  check("Edit on a dashboard card opens the creator through the tools context (Pro only)", /openVideoEdit\(data\.video\)/.test(read("app/candidate/resumes/saved-video-card.tsx")) && /setActiveTool\("video"\)/.test(read("app/candidate/components/tools-context.tsx")) && /upgrade=pro/.test(read("app/candidate/components/tools-context.tsx").slice(read("app/candidate/components/tools-context.tsx").indexOf("const openVideoEdit"))));

  // ── 4. Owner-only ──
  const other = await sv.getSavedVideo(be, "user_B", saved1.id);
  check("another user can't read someone else's saved video", other === null && (await sv.listSavedVideos(be, "user_B")).length === 0);
  check("another user can't get its video URL or script file", (await sv.videoUrlFor(be, "user_B", saved1.id, false)) === null && (await sv.videoUrlFor(be, "user_B", saved1.id, true)) === null && (await sv.scriptFileFor(be, "user_B", saved1.id)) === null);
  check("another user can't delete it", (await sv.deleteSavedVideo(be, "user_B", saved1.id)) === false && be.rows.has(saved1.id) && be.files.has(saved1.videoPath));
  const leaky = memBackend({ leaky: true });
  const lv = await sv.saveVideo(leaky, "user_A", meta, MP4, { id: "22222222-2222-4222-8222-222222222222" });
  check("even a backend that leaks rows can't expose them: ownership is re-checked", (await sv.getSavedVideo(leaky, "user_B", lv.id)) === null && (await sv.listSavedVideos(leaky, "user_B")).length === 0 && (await sv.deleteSavedVideo(leaky, "user_B", lv.id)) === false && leaky.rows.has(lv.id));
  check("a stored path outside the owner's folder is never served", await (async () => { const b = memBackend(); await sv.saveVideo(b, "user_A", meta, MP4, { id: "33333333-3333-4333-8333-333333333333" }); const r = b.rows.get("33333333-3333-4333-8333-333333333333"); r.videoPath = "user_B/steal.mp4"; b.files.set("user_B/steal.mp4", Buffer.from("x")); return (await sv.getSavedVideo(b, "user_A", r.id)) === null; })());
  check("an id that isn't a uuid is rejected before any lookup", (await sv.getSavedVideo(be, "user_A", "../../etc/passwd")) === null && (await sv.getSavedVideo(be, "user_A", "1 or 1=1")) === null);
  check("the owner can fetch the video (play + download name) and the script file", (await sv.videoUrlFor(be, "user_A", saved1.id, false)).includes("user_A/") && (await sv.videoUrlFor(be, "user_A", saved1.id, true)).includes("dl=resume-video-for-sarah-johnson.mp4") && (await sv.scriptFileFor(be, "user_A", saved1.id)).filename === "resume-video-for-sarah-johnson-script.txt");
  const routes = ["app/api/resume-video/saved/route.ts", "app/api/resume-video/saved/[id]/route.ts", "app/api/resume-video/saved/[id]/video/route.ts", "app/api/resume-video/saved/[id]/script/route.ts"].map(read);
  check("every saved-video route needs a signed-in user and uses that user's id for the lookup", routes.every((r) => /auth\(\)/.test(r) && /not_signed_in/.test(r) && /userId/.test(r)));
  check("the database queries are scoped by user_id and the bucket is private", (read("lib/saved-videos-store.ts").match(/\.eq\("user_id", userId\)/g) || []).length >= 4 && /values \('resume-videos', 'resume-videos', false\)/.test(read("supabase/migrations/0047_saved_resume_videos.sql")) && /enable row level security/.test(read("supabase/migrations/0047_saved_resume_videos.sql")) && !/create policy/.test(read("supabase/migrations/0047_saved_resume_videos.sql")));

  // ── 5. Delete + retention ──
  check("Delete removes the stored files and the metadata", (await sv.deleteSavedVideo(be, "user_A", saved2.id)) === true && !be.rows.has(saved2.id) && !be.files.has(saved2.videoPath) && !be.files.has(saved2.scriptPath));
  const cap = memBackend();
  const ids = [];
  for (let n = 0; n < sv.MAX_SAVED_VIDEOS + 3; n++) {
    const r = await sv.saveVideo(cap, "user_A", META({ toWhom: "R" + n }), MP4, { now: () => new Date(Date.UTC(2026, 9, 1, 0, n)) });
    ids.push(r.id);
  }
  check("the cap keeps the most recent 10 per user", sv.MAX_SAVED_VIDEOS === 10 && cap.rows.size === 10 && (await sv.listSavedVideos(cap, "user_A")).length === 10);
  check("the oldest are evicted, files included (MP4 and script)", ids.slice(0, 3).every((id) => !cap.rows.has(id) && !cap.files.has(`user_A/${id}.mp4`) && !cap.files.has(`user_A/${id}.txt`)) && ids.slice(3).every((id) => cap.rows.has(id) && cap.files.has(`user_A/${id}.mp4`) && cap.files.has(`user_A/${id}.txt`)) && cap.files.size === 20);
  check("the newest video is never the one evicted", cap.rows.has(ids[ids.length - 1]));
  check("one user's cap never touches another user's videos", await (async () => { const b = memBackend(); await sv.saveVideo(b, "user_B", META(), MP4, { now: () => new Date("2026-01-01") }); for (let n = 0; n < 12; n++) await sv.saveVideo(b, "user_A", META(), MP4, { now: () => new Date(Date.UTC(2026, 9, 1, 0, n)) }); return (await sv.listSavedVideos(b, "user_B")).length === 1; })());
  check("videosToEvict returns only the oldest beyond the cap", sv.videosToEvict([{ createdAt: "2026-03" }, { createdAt: "2026-01" }, { createdAt: "2026-02" }], 2).map((r) => r.createdAt).join() === "2026-01");

  // ── 6. Dashboard: in "Resumes built", not a new nav item ──
  const mine = read("app/candidate/resumes/my-resumes.tsx"), card = read("app/candidate/resumes/saved-video-card.tsx");
  check("saved videos are listed in the existing My Resumes (Resumes built) page, alongside the resumes", /SavedVideoCard/.test(mine) && /\/api\/resume-video\/saved/.test(mine) && /\.\.\.drafts\.map[\s\S]{0,200}\.\.\.videos\.map/.test(mine));
  check("each card: Watch, Download video, Download script, Edit, Delete", ["t(\"watch\")", "t(\"downloadVideo\")", "t(\"downloadScript\")", "t(\"edit\")", "t(\"deleteVideoAria\")"].every((x) => card.includes(x)) && /video\?download=1/.test(card) && /\/script`/.test(card) && /method: "DELETE"/.test(card));
  check("no separate 'My videos' navigation item or route", !fs.existsSync(path.join(ROOT, "app/candidate/videos")) && !/my ?videos/i.test(read("messages/en.json").slice(read("messages/en.json").indexOf('"nav"'), read("messages/en.json").indexOf('"nav"') + 1500)) && !/"videos"/.test(read("app/candidate/components/tools-context.tsx")));
  check("saved videos count toward Resumes built", /countSavedVideos\(userId\)/.test(read("lib/generations.ts")) && /resumeCount \+ savedVideos/.test(read("lib/generations.ts")));
  check("the migration creates the table and the private bucket, with its numbered name", fs.existsSync(path.join(ROOT, "supabase/migrations/0047_saved_resume_videos.sql")) && /create table if not exists public\.saved_resume_videos/.test(read("supabase/migrations/0047_saved_resume_videos.sql")));
  const NEWRV = ["scriptSection", "scriptWriteYourself", "scriptAi", "scriptBox", "scriptWrittenPlaceholder", "scriptHint", "scriptEditedHint", "errorWriteScriptFirst", "savedToDashboard", "viewSaved", "notSaved", "editingSaved"];
  const NEWMR = ["videoBadge", "videoTitle", "videoTitleFor", "created", "videoSourceAi", "videoSourceWritten", "watch", "hideVideo", "downloadVideo", "downloadScript", "edit", "deleteVideoAria", "videoOpenError", "videoLimit"];
  check("every new string (script choices, Edit, Download script, video actions) exists in all five locales", ["en", "es", "fr", "hi", "zh"].every((l) => { const m = JSON.parse(read(`messages/${l}.json`)).candidateTools; return NEWRV.every((k) => typeof m.resumeVideo[k] === "string" && m.resumeVideo[k]) && NEWMR.every((k) => typeof m.myResumes[k] === "string" && m.myResumes[k]); }));
  check("untouched by this change: slide structure, voice samples, headshot, colour, animation, legacy renderer", !/saved|Saved/.test(read("remotion/../../remotion/ResumeVideo.tsx")) && ai.VIDEO_VOICES.every((v) => ai.voiceSampleUrl(v.key) === `/voice-samples/${v.key}.mp3`) && /renderOptionsFor/.test(read("lib/resume-video-render.ts")));

  // ═════════════ Part 5: monthly limits, plan copy, owner alerts ═════════════
  // In-memory stand-in for the usage_counters store, injected where lib/usage-counter.ts would be loaded.
  const counterFile = path.join(ROOT, "lib/usage-counter.ts");
  const store = new Map();
  const key = (u, k, p) => `${u}|${k}|${p}`;
  require.cache[require.resolve(counterFile)] = { id: counterFile, filename: counterFile, loaded: true, exports: {
    monthPeriod: (d = new Date()) => `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}`,
    getCounter: async (u, k, p) => store.get(key(u, k, p)) ?? 0,
    bumpCounter: async (u, k, p, by = 1) => { const n = (store.get(key(u, k, p)) ?? 0) + by; store.set(key(u, k, p), n); return n; },
  } };
  const cfg = require(path.join(ROOT, "lib/plan-config.ts"));
  const vq = require(path.join(ROOT, "lib/video-quota.ts"));
  const oa = require(path.join(ROOT, "lib/owner-alert.ts"));
  const OCT = new Date("2026-10-15T12:00:00Z"), NOV = new Date("2026-11-01T00:00:05Z");

  // ── Limits by plan, from the one constants file ──
  check("limits: Pro monthly 10, Pro Lifetime 40 — declared once in plan-config", cfg.RESUME_VIDEO_MONTHLY_LIMITS.pro === 10 && cfg.RESUME_VIDEO_MONTHLY_LIMITS.proLifetime === 40 && cfg.PRICES_USD.pro === 19 && cfg.PRICES_USD.proLifetime === 129);
  check("the plan picks the allowance: monthly → 10, lifetime → 40, admin → unlimited", vq.videoLimitFor(vq.videoPlanKind({ plan: "pro" }, false)) === 10 && vq.videoLimitFor(vq.videoPlanKind({ plan: "pro" }, true)) === 40 && vq.videoLimitFor(vq.videoPlanKind({ plan: "pro", isAdmin: true }, false)) === null);
  check("an invited employee uses the monthly allowance, never a lifetime one", vq.videoPlanKind({ plan: "employee" }, true) === "monthly");
  const qAt = (kind, n) => vq.quotaFrom(kind, n, "2026-10");
  check("monthly: videos 1–10 are allowed, the 11th is refused", [0, 5, 9].every((n) => !vq.isOverLimit(qAt("monthly", n))) && [10, 11].every((n) => vq.isOverLimit(qAt("monthly", n))));
  check("lifetime: allowed through 40, the 41st is refused (and 10 used is NOT a limit for lifetime)", !vq.isOverLimit(qAt("lifetime", 10)) && !vq.isOverLimit(qAt("lifetime", 39)) && vq.isOverLimit(qAt("lifetime", 40)));
  check("remaining is limit − used, never negative; unlimited has no limit", qAt("monthly", 3).remaining === 7 && qAt("monthly", 99).remaining === 0 && qAt("lifetime", 3).remaining === 37 && qAt("unlimited", 500).remaining === null && !vq.isOverLimit(qAt("unlimited", 500)));

  // ── Counting: only a finished render consumes quota; the month resets ──
  const U = "user_limits";
  for (let n = 0; n < 7; n++) await vq.recordVideoGenerated(U, "monthly", OCT);
  let q = await vq.videoQuota(U, "monthly", OCT);
  check("each finished video is counted (7 of 10 used → '3 left')", q.used === 7 && q.remaining === 3 && q.limit === 10);
  const attempts = 5; // 5 failed renders: the code path never calls recordVideoGenerated
  q = await vq.videoQuota(U, "monthly", OCT);
  check("failed renders cost nothing (no record call → count unchanged)", attempts === 5 && q.used === 7);
  for (let n = 0; n < 3; n++) await vq.recordVideoGenerated(U, "monthly", OCT);
  q = await vq.videoQuota(U, "monthly", OCT);
  check("the 10th finished video exhausts a monthly allowance", q.used === 10 && vq.isOverLimit(q));
  const nov = await vq.videoQuota(U, "monthly", NOV);
  check("the count resets on the 1st (a new UTC month starts at zero, last month's total is untouched)", nov.used === 0 && nov.remaining === 10 && !vq.isOverLimit(nov) && (await vq.videoQuota(U, "monthly", OCT)).used === 10 && nov.period === "2026-11" && q.period === "2026-10");
  for (let n = 0; n < 12; n++) await vq.recordVideoGenerated("user_lt", "lifetime", OCT);
  check("the same 12 videos leave a lifetime member with 28 left", (await vq.videoQuota("user_lt", "lifetime", OCT)).remaining === 28);
  await vq.recordVideoGenerated("user_admin", "unlimited", OCT);
  check("admin runs aren't counted", (await vq.videoQuota("user_admin", "unlimited", OCT)).used === 0);

  // ── The refusal message is specific to the plan ──
  const mBody = vq.limitReachedBody(qAt("monthly", 10)), lBody = vq.limitReachedBody(qAt("lifetime", 40));
  check("monthly refusal: names 10/month, says it resets, offers the Lifetime upgrade", mBody.error === "video_limit_reached" && mBody.kind === "monthly" && mBody.limit === 10 && /10/.test(mBody.message) && /resets on the 1st/.test(mBody.message) && /Lifetime/.test(mBody.message));
  check("lifetime refusal: names 40/month and the reset — no upgrade pitch", lBody.kind === "lifetime" && lBody.limit === 40 && /40/.test(lBody.message) && /resets on the 1st/.test(lBody.message) && !/upgrade/i.test(lBody.message));
  const en = JSON.parse(read("messages/en.json")).candidateTools.resumeVideo;
  check("the localized strings say the same: monthly offers Lifetime, lifetime explains the reset only", /\{limit\}/.test(en.limitReachedMonthly) && /\{lifetimeLimit\}/.test(en.limitReachedMonthly) && /resets on the 1st/.test(en.limitReachedMonthly) && /Lifetime/.test(en.limitReachedMonthly) && /\{limit\}/.test(en.limitReachedLifetime) && /resets on the 1st/.test(en.limitReachedLifetime) && !/upgrade/i.test(en.limitReachedLifetime) && /\{remaining\} of \{limit\} videos left this month/.test(en.videosLeft));

  // ── Wiring: server-side, before credits are spent, counted only after a successful render ──
  const mp4 = read("app/api/resume-video/mp4/route.ts"), voice = read("app/api/resume-video/voiceover/route.ts"), scriptRoute = read("app/api/resume-video/script/route.ts");
  check("all three generation routes refuse over-limit requests server-side (429), the voiceover before it calls ElevenLabs", [mp4, voice, scriptRoute].every((r) => /isOverLimit\(ctx\.quota\)/.test(r) && /limitReachedBody\(ctx\.quota\), \{ status: 429 \}/.test(r)) && voice.indexOf("isOverLimit(ctx.quota)") < voice.indexOf("api.elevenlabs.io"));
  check("the gate is unchanged: Pro only, free and employer tiers are still refused", [mp4, voice, scriptRoute].every((r) => /isIndividualPro\(\)/.test(r) && /pro_required/.test(r)) && /isIndividualPro/.test(read("app/api/resume-video/quota/route.ts")));
  const iFail = mp4.indexOf('error: data.error || "render_failed"'), iRecord = mp4.indexOf("recordVideoGenerated(userId, ctx.kind)");
  check("a video is counted only after the render succeeded (the failure returns come first; the count is recorded once)", iFail > 0 && iRecord > iFail && (mp4.match(/recordVideoGenerated\(/g) || []).length === 1 && !/recordVideoGenerated/.test(voice) && !/recordVideoGenerated/.test(scriptRoute));
  check("the render response returns the updated quota so the page can show what's left", /savedId, quota/.test(mp4));
  check("the page shows 'N of M videos left', stops at the limit, and offers Lifetime only to monthly members", /t\("videosLeft", \{ remaining: quota\.remaining, limit: quota\.limit \}\)/.test(ui) && /disabled=\{atLimit\}/.test(ui) && /\(limitHit\?\.kind \?\? quota\?\.kind\) === "monthly"[\s\S]{0,200}upgradeToLifetime/.test(ui) && /setLimitHit\(\w+\.data as LimitBody\)/.test(ui) && (ui.match(/status === 429/g) || []).length === 3);

  // ── One source of truth: no limit or price typed into code or any translation ──
  const walk = (o, f) => { for (const v of Object.values(o)) typeof v === "string" ? f(v) : v && typeof v === "object" && walk(v, f); };
  const LOCALES = ["en", "es", "fr", "hi", "zh"];
  let typedPrices = [];
  for (const l of LOCALES) walk(JSON.parse(read(`messages/${l}.json`)), (v) => { if (/[$＄]\s?(19|129)\b|\b(19|129)\s?[$＄]|(19|129)\s?(美元|USD|dólares)/.test(v)) typedPrices.push(l + ": " + v.slice(0, 60)); });
  check("no translation has $19 / $129 typed into it (they use {proPrice}/{lifetimePrice} from plan-config)", typedPrices.length === 0, typedPrices.join(" | "));
  let typedLimits = [];
  for (const l of LOCALES) { const m = JSON.parse(read(`messages/${l}.json`)); for (const [k, v] of Object.entries({ ...m.candidateTools.resumeVideo, inc: m.proUpgrade.included.video, note: m.proUpgrade.lifetimeNote, d: m.candidateSettings.plan.proDesc, q2: m.help.faq.q2.a, vd: m.help.tools.video.desc })) if (typeof v === "string" && /(^|[^{\d])(10|40)\s*(videos?|vidéos?|वीडियो|个视频)/i.test(v)) typedLimits.push(l + "." + k); }
  check("no video limit is typed into a translation either", typedLimits.length === 0, typedLimits.join(","));
  check("every price / limit string is fed from PLAN_COPY_PARAMS", /PLAN_COPY_PARAMS/.test(read("components/pro-upgrade-modal.tsx")) && /PLAN_COPY_PARAMS/.test(read("app/candidate/settings/settings-client.tsx")) && /PLAN_COPY_PARAMS/.test(read("app/candidate/help/page.tsx")) && /PRICES_USD\.pro/.test(read("lib/tailor-variants.ts")));
  const codeFiles = ["lib/video-quota.ts", "lib/video-quota-server.ts", "app/candidate/tools/resume-video.tsx", "app/api/resume-video/mp4/route.ts", "app/api/resume-video/voiceover/route.ts", "app/api/resume-video/quota/route.ts"].map(read).join("\n");
  check("enforcement and UI code never type the limits (10 / 40) themselves", !/(limit|LIMIT|cap)\s*[:=]\s*(10|40)\b/.test(codeFiles) && !/\b(10|40)\s*videos/.test(codeFiles));
  check("all new strings exist in all five locales with matching placeholders", LOCALES.every((l) => { const r = JSON.parse(read(`messages/${l}.json`)).candidateTools.resumeVideo; return ["videosLeft", "limitReachedMonthly", "limitReachedLifetime", "upgradeToLifetime"].every((k) => typeof r[k] === "string" && r[k].length > 8) && /\{remaining\}/.test(r.videosLeft) && /\{limit\}/.test(r.videosLeft) && /\{limit\}/.test(r.limitReachedMonthly) && /\{lifetimeLimit\}/.test(r.limitReachedMonthly) && /\{limit\}/.test(r.limitReachedLifetime) && /\{lifetimeLimit\}/.test(r.upgradeToLifetime); }));

  // ── Owner alerts ──
  check("ElevenLabs credits: 1 per character on multilingual_v2, half on Flash/Turbo", oa.elevenLabsCredits(650, "eleven_multilingual_v2") === 650 && oa.elevenLabsCredits(650, "eleven_flash_v2_5") === 325 && oa.elevenLabsCredits(0) === 0);
  const ga = oa.videoGeneratedAlert({ email: "sam@example.com", planLabel: "Pro monthly", credits: 6500, usedThisMonth: 3, limit: 10, narrated: true });
  check("the 'video generated' alert carries the user's email, plan and credits", /sam@example\.com/.test(ga.subject + ga.html) && /Pro monthly/.test(ga.html) && /6,500/.test(ga.subject + ga.html) && /3 of 10/.test(ga.html));
  check("a silent video reports 0 credits", /0 \(no narration\)/.test(oa.videoGeneratedAlert({ email: "a@b.co", planLabel: "Pro Lifetime", credits: 0, usedThisMonth: 1, limit: 40, narrated: false }).html));
  const qe = oa.classifyElevenLabsError(401, JSON.stringify({ detail: { status: "quota_exceeded", message: "This request exceeds your quota of 10000. You have 120 credits remaining, while 650 credits are required." } }));
  check("out of credits (ElevenLabs sends this as a 401 quota_exceeded) is told apart from a bad key", qe && qe.reason === "insufficient_credits" && oa.classifyElevenLabsError(401, JSON.stringify({ detail: { status: "invalid_api_key", message: "Invalid API key" } })).reason === "auth" && oa.classifyElevenLabsError(401, "nope").reason === "auth");
  check("errors that aren't about credits or the key don't raise an alert (rate limit, server error)", oa.classifyElevenLabsError(429, JSON.stringify({ detail: { status: "too_many_concurrent_requests", message: "Too many concurrent requests" } })) === null && oa.classifyElevenLabsError(500, "boom") === null);
  const fa = oa.elevenLabsFailureAlert({ email: "sam@example.com", reason: "insufficient_credits", status: 401, detail: "quota_exceeded" });
  check("the failure alert names the reason, status and user — and never a key", /insufficient_credits/.test(fa.subject) && /401/.test(fa.html) && /sam@example\.com/.test(fa.html) && !/sk_[a-z0-9]{6}|xi-api-key/i.test(fa.html + fa.subject));
  check("failure alerts are throttled per reason, so a credit outage sends one email, not one per attempt", oa.shouldSendFailureAlert("t_reason", 1_000_000) === true && oa.shouldSendFailureAlert("t_reason", 1_000_000 + 60_000) === false && oa.shouldSendFailureAlert("other_reason", 1_000_000 + 60_000) === true && oa.shouldSendFailureAlert("t_reason", 1_000_000 + oa.FAILURE_ALERT_WINDOW_MS + 1) === true);
  check("the success alert fires only after a successful render; the failure alert only from the voiceover route", iRecord > 0 && mp4.indexOf("videoGeneratedAlert(") > iRecord && !/elevenLabsFailureAlert/.test(mp4) && (voice.match(/elevenLabsFailureAlert\(/g) || []).length === 2 && /classifyElevenLabsError/.test(voice));
  check("ElevenLabs's exact reply is now logged (status + body, never the key)", /console\.error\("\[resume-video\/voiceover\] ElevenLabs HTTP", status, bodyText\.slice\(0, 400\)\)/.test(voice) && !/console\.\w+\([^)]*apiKey/.test(voice));
  check("alerts go from a distinct alerts@ sender to OWNER_EMAIL (default support@), like the legacy notifyOwner", oa.ownerAlertFrom({ RESEND_FROM: "ResumeTailored <noreply@resumetailored.com>" }).includes("alerts@resumetailored.com") && oa.ownerAlertFrom({ OWNER_ALERT_FROM: "x <a@b.co>" }) === "x <a@b.co>" && oa.ownerEmail({}) === "support@resumetailored.com" && oa.ownerEmail({ OWNER_EMAIL: "me@x.io" }) === "me@x.io");
  {
    const sent = []; const realFetch = global.fetch; process.env.RESEND_API_KEY = "re_test"; delete process.env.OWNER_ALERTS;
    global.fetch = async (url, init) => { sent.push({ url, body: JSON.parse(init.body) }); return { ok: true }; };
    const ok = await oa.notifyOwner("subject", "<p>x</p>");
    process.env.OWNER_ALERTS = "off"; const off = await oa.notifyOwner("subject2", "<p>y</p>");
    global.fetch = realFetch; delete process.env.RESEND_API_KEY; delete process.env.OWNER_ALERTS;
    check("notifyOwner sends through Resend from alerts@ to the owner, and OWNER_ALERTS=off silences it", ok === true && sent.length === 1 && /alerts@/.test(sent[0].body.from) && sent[0].body.to === "support@resumetailored.com" && off === false);
  }

  console.log(failures ? `\n${failures} FAILURE(S)` : "\nALL PASS");
  process.exit(failures ? 1 : 0);
})();
