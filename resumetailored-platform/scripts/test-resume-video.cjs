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
check("the voiceover uses the voice chosen in Video settings and its script comes from step one", /\/api\/resume-video\/voiceover"[\s\S]{0,40}\{\s*script, voice,/.test(gen) && /const script = sc\.data\.script/.test(gen));
check("the render gets the voiceover audio, its slide starts and the settings", /audioUrl: audio,[\s\S]{0,120}sceneStarts: audio && starts \? starts : undefined,[\s\S]{0,40}settings,/.test(gen));
check("a voiceover that can't be made still renders the video (without narration), and says so", /setNote\(t\("voiceoverSkipped"\)\)/.test(gen) && /audio = vo\.data\.audio/.test(gen));
check("a new generation clears the previous render first", /setMp4Url\(null\);[\s\S]{0,60}setSynced\(null\);[\s\S]{0,40}setStep\("script"\)/.test(gen));
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
check("custom openers/closers persist inside the same video_settings object (no new migration)", JSON.stringify(withCustom.customOpeners) === '["Yo"]' && withCustom.customClosers[0] === "Onward!" && !require("fs").readdirSync(path.join(ROOT, "supabase/migrations")).some((f) => /^0047/.test(f)));
check("the flow saves what was typed, and the dropdowns list the user's own first, tagged", /rememberPhrase\(st\.customOpeners, greeting, GREETING_OPTIONS/.test(gen) && /rememberPhrase\(st\.customClosers, closing, CLOSING_OPTIONS/.test(gen) && /settings\.customOpeners\.map[\s\S]{0,160}GREETING_OPTIONS\.map/.test(ui) && /settings\.customClosers\.map[\s\S]{0,160}CLOSING_OPTIONS\.map/.test(ui) && /t\("yours"\)/.test(ui));
check("custom phrases never reach the renderer", !("customOpeners" in render.buildRenderPayload({ script: "x".repeat(20), settings: withCustom }, "u")));

console.log(failures ? `\n${failures} FAILURE(S)` : "\nALL PASS");
process.exit(failures ? 1 : 0);
