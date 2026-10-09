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

console.log(failures ? `\n${failures} FAILURE(S)` : "\nALL PASS");
process.exit(failures ? 1 : 0);
