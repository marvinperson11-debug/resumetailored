#!/usr/bin/env node
/** Fails (exit 1) if any narrator voice is missing its committed sample in public/voice-samples. */
const fs = require("fs");
const path = require("path");
const ts = require("typescript");
const ROOT = path.resolve(__dirname, "..");
require.extensions[".ts"] = (module, filename) => {
  const out = ts.transpileModule(fs.readFileSync(filename, "utf8"), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020, esModuleInterop: true } });
  module._compile(out.outputText, filename);
};
const { VIDEO_VOICES } = require(path.join(ROOT, "lib/video-ai.ts"));
const missing = VIDEO_VOICES.filter((v) => !fs.existsSync(path.join(ROOT, "public", "voice-samples", `${v.key}.mp3`)));
if (missing.length) {
  console.error("Missing voice samples: " + missing.map((v) => v.key).join(", ") + "\nRun: ELEVENLABS_API_KEY=… npm run voice-samples");
  process.exit(1);
}
console.log(`All ${VIDEO_VOICES.length} voice samples present.`);
