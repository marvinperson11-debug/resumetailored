#!/usr/bin/env node
/**
 * Render ONE short sample per Resume Video narrator voice with the app's real ElevenLabs flow and write them to
 * public/voice-samples/<key>.mp3 (committed static assets, so auditioning a voice costs nothing at runtime).
 *
 *   ELEVENLABS_API_KEY=... npm run voice-samples            # only voices that have no sample yet
 *   ELEVENLABS_API_KEY=... npm run voice-samples -- --force # re-render every sample
 *
 * Uses the SAME voice ids, model and voice settings as POST /api/resume-video/voiceover (both read
 * lib/video-ai.ts), so a sample sounds exactly like the generated voiceover for that voice. ~3 seconds each.
 * ELEVENLABS_MODEL_ID is honoured exactly like the route does. No other network access.
 */
const fs = require("fs");
const path = require("path");
const ts = require("typescript");
const ROOT = path.resolve(__dirname, "..");
require.extensions[".ts"] = (module, filename) => {
  const out = ts.transpileModule(fs.readFileSync(filename, "utf8"), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020, esModuleInterop: true } });
  module._compile(out.outputText, filename);
};
const { VIDEO_VOICES, voiceSampleText, elevenLabsRequestBody } = require(path.join(ROOT, "lib/video-ai.ts"));

const force = process.argv.includes("--force");
const apiKey = process.env.ELEVENLABS_API_KEY;
const outDir = path.join(ROOT, "public", "voice-samples");
fs.mkdirSync(outDir, { recursive: true });

(async () => {
  const todo = VIDEO_VOICES.filter((v) => force || !fs.existsSync(path.join(outDir, `${v.key}.mp3`)));
  if (!todo.length) return console.log("All voice samples already exist. Use --force to re-render.");
  if (!apiKey) {
    console.error("ELEVENLABS_API_KEY is not set — cannot render: " + todo.map((v) => v.key).join(", "));
    process.exit(1);
  }
  let failed = 0;
  for (const v of todo) {
    const text = voiceSampleText(v.label);
    const res = await fetch(`https://api.elevenlabs.io/v1/text-to-speech/${v.id}`, {
      method: "POST",
      headers: { "xi-api-key": apiKey, "Content-Type": "application/json", Accept: "audio/mpeg" },
      body: JSON.stringify(elevenLabsRequestBody(text, process.env.ELEVENLABS_MODEL_ID)),
      signal: AbortSignal.timeout(45000),
    }).catch((e) => ({ ok: false, status: String(e && e.message) }));
    if (!res.ok) {
      failed++;
      console.error(`FAIL ${v.key}: HTTP ${res.status}`);
      continue;
    }
    const buf = Buffer.from(await res.arrayBuffer());
    fs.writeFileSync(path.join(outDir, `${v.key}.mp3`), buf);
    console.log(`ok   ${v.key}  (${(buf.length / 1024).toFixed(0)} KB)  "${text}"`);
  }
  process.exit(failed ? 1 : 0);
})();
