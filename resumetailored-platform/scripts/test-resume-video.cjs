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
check("Generate voiceover sends the selected voice", /\/api\/resume-video\/voiceover[\s\S]{0,300}JSON\.stringify\(\{ script, voice,/.test(ui));
check("the voiceover route maps that voice to the ElevenLabs voice id", /voiceIdForKey\(body\.voice\)/.test(vo));
check("the voiceover route and the sample generator share one set of ElevenLabs settings", /elevenLabsRequestBody\(text, process\.env\.ELEVENLABS_MODEL_ID\)/.test(vo) && /elevenLabsRequestBody\(text, process\.env\.ELEVENLABS_MODEL_ID\)/.test(read("scripts/generate-voice-samples.cjs")));
const body = ai.elevenLabsRequestBody("hi");
check("settings are the ones generation always used", body.model_id === "eleven_multilingual_v2" && body.voice_settings.stability === 0.5 && body.voice_settings.similarity_boost === 0.75);
check("sample line names the voice", ai.voiceSampleText("Rachel — calm & professional") === "Hi, I'm Rachel, and this is how I'll sound in your video.");
check("every voice has a sample url", ai.VIDEO_VOICES.every((v) => ai.voiceSampleUrl(v.key) === `/voice-samples/${v.key}.mp3`));
check("changing the voice discards the previous voiceover and render", /function chooseVoice[\s\S]{0,300}setAudio\(null\)[\s\S]{0,60}setMp4Url\(null\)/.test(ui));
check("a new voiceover discards any earlier (silent/stale) render", /setAudio\(data\.audio\);[\s\S]{0,260}setMp4Url\(null\)/.test(ui));

// ── Page simplification ──
const whole = ui + read("lib/video-ai.ts");
check("no browser text-to-speech anywhere", !/speechSynthesis|SpeechSynthesisUtterance|browserPreview/.test(whole));
check("exactly one video player", (ui.match(/<video\b/g) || []).length === 1);
check("no <audio controls> second player (voiceover is driven by one Play button)", !/<audio[^>]*controls/.test(ui));
check("the blue script-preview box is gone", !/linear-gradient\(135deg, \$\{tpl\.accent\}/.test(ui) && !/aspect-video flex-col items-center justify-center gap-3 p-6 text-center/.test(ui));
check("one Play voiceover button", (ui.match(/t\("playVoiceover"\)/g) || []).length === 1);
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
check("Video settings (voice, colour, headshot) sit in the left column with the script controls", /<VideoSettingsPanel/.test(left) && /voicePicker=\{<VoicePicker/.test(left) && left.indexOf("<VideoSettingsPanel") < left.indexOf("{t(\"scriptEditable\")}"));
check("the footer's Generate script button is on that same screen", /onClick=\{genScript\}/.test(ui) && !/<VoicePicker/.test(ui.slice(ui.indexOf("{/* Right: voiceover"))));
const panel = read("app/candidate/tools/resume-video-settings.tsx");
check("headshot upload accepts only jpeg/png, is size-limited, and the preview is draggable", /accept="image\/jpeg,image\/png"/.test(panel) && /MAX_UPLOAD_BYTES/.test(panel) && /onPointerMove/.test(panel) && /everySlide/.test(panel) && /type="color"/.test(panel));
check("the MP4 request sends the settings and the voiceover's slide starts", /settings, \/\/ background/.test(ui) && /sceneStarts: audio && sceneStarts/.test(ui));
check("a new/edited script or voice discards the slide timing with the voiceover", /useEffect\(\(\) => \{ if \(!audio\) setSceneStarts\(null\)/.test(ui));
check("settings persist per user: route + store + migration", /video_settings/.test(read("lib/video-settings-store.ts")) && /add column if not exists video_settings jsonb/.test(read("supabase/migrations/0046_resume_video_settings.sql")) && /cleanVideoSettings/.test(read("app/api/resume-video/settings/route.ts")));
const KEYS = ["videoSettings", "backgroundColor", "headshotUpload", "headshotEverySlide", "slidesSynced", "slidesFixedTiming", "voiceUsed", "errorHeadshotType"];
check("every new string exists in all five locales", ["en", "es", "fr", "hi", "zh"].every((l) => { const rv = JSON.parse(read(`messages/${l}.json`)).candidateTools.resumeVideo; return KEYS.every((k) => typeof rv[k] === "string" && rv[k]); }));

console.log(failures ? `\n${failures} FAILURE(S)` : "\nALL PASS");
process.exit(failures ? 1 : 0);
