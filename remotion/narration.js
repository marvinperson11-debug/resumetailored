// Free, self-hosted text-to-speech for the resume video voiceover. Produces a
// WAV and returns it as a data: URL that the Remotion composition muxes into
// the MP4 via <Audio>. No cloud account or API key required.
//
// Engine selection (first available wins):
//   1. Piper — natural neural voice. Used automatically when a Piper binary
//      (PIPER_BIN, `piper` on PATH, or the `python3 -m piper` pip CLI) AND a
//      voice model are available. The model is resolved from PIPER_VOICE, then
//      common dirs, then best-effort downloaded (see resolvePiperVoice).
//      nixpacks.toml installs Piper + the default voice on Railway.
//   2. espeak-ng / espeak on PATH — free, lightweight, robotic fallback.
// If none is available, returns null and the video renders silently.
//
// Disable entirely with RESUME_VIDEO_VOICE=off.
const fs = require('fs');
const os = require('os');
const path = require('path');
const crypto = require('crypto');
const { spawnSync, execSync } = require('child_process');
const { narrationScript } = require('./data');

function onPath(bin) {
  try {
    execSync(`command -v ${bin}`, { stdio: ['ignore', 'ignore', 'ignore'] });
    return true;
  } catch (_) {
    return false;
  }
}

function hasPiperModule() {
  try {
    execSync('python3 -c "import piper"', { stdio: ['ignore', 'ignore', 'ignore'] });
    return true;
  } catch (_) {
    return false;
  }
}

const PIPER_VOICE_ID = process.env.PIPER_VOICE_ID || 'en_US-lessac-medium';

// Candidate directories where a Piper .onnx voice model may live.
function piperVoiceDirs() {
  return [
    process.env.PIPER_DATA_DIR,
    path.join(process.cwd(), 'piper-voices'),
    path.join(process.env.DATA_DIR || './data', 'piper'),
  ].filter(Boolean);
}

// Locate the Piper voice model, downloading it once (best-effort) if absent.
function resolvePiperVoice() {
  if (process.env.PIPER_VOICE && fs.existsSync(process.env.PIPER_VOICE)) {
    return process.env.PIPER_VOICE;
  }
  for (const dir of piperVoiceDirs()) {
    const p = path.join(dir, `${PIPER_VOICE_ID}.onnx`);
    if (fs.existsSync(p)) return p;
  }
  // Backstop: download into a writable dir (normally pre-fetched at build time).
  if (process.env.PIPER_AUTODOWNLOAD !== 'off' && hasPiperModule()) {
    const target = process.env.PIPER_DATA_DIR || path.join(process.env.DATA_DIR || './data', 'piper');
    try {
      fs.mkdirSync(target, { recursive: true });
      const r = spawnSync('python3', ['-m', 'piper.download_voices', PIPER_VOICE_ID, '--data-dir', target], {
        stdio: ['ignore', 'ignore', 'ignore'],
        timeout: 180000,
      });
      const p = path.join(target, `${PIPER_VOICE_ID}.onnx`);
      if (r.status === 0 && fs.existsSync(p)) return p;
    } catch (_) {
      /* fall through to espeak */
    }
  }
  return null;
}

// Build a Piper engine descriptor if a binary + model are available.
function piperEngine() {
  const voice = resolvePiperVoice();
  if (!voice) return null;
  if (process.env.PIPER_BIN) {
    return { name: 'piper', bin: process.env.PIPER_BIN, args: (wav) => ['--model', voice, '--output_file', wav] };
  }
  if (onPath('piper')) {
    return { name: 'piper', bin: 'piper', args: (wav) => ['--model', voice, '--output_file', wav] };
  }
  if (hasPiperModule()) {
    return { name: 'piper-py', bin: 'python3', args: (wav) => ['-m', 'piper', '-m', voice, '-f', wav] };
  }
  return null;
}

// Returns { name, bin, args(wavPath) } for the first available engine, or null.
function pickEngine() {
  if (process.env.RESUME_VIDEO_VOICE === 'off') return null;

  const piper = piperEngine();
  if (piper) return piper;

  const voice = process.env.ESPEAK_VOICE || 'en-us';
  if (onPath('espeak-ng')) {
    return { name: 'espeak-ng', bin: 'espeak-ng', args: (wav) => ['-v', voice, '-s', '165', '-w', wav] };
  }
  if (onPath('espeak')) {
    return { name: 'espeak', bin: 'espeak', args: (wav) => ['-v', voice, '-s', '165', '-w', wav] };
  }
  return null;
}

// Duration in seconds of a standard PCM WAV buffer (locates the `data` chunk).
function wavSeconds(buf) {
  try {
    const sampleRate = buf.readUInt32LE(24);
    const channels = buf.readUInt16LE(22) || 1;
    const bitsPerSample = buf.readUInt16LE(34) || 16;
    const bytesPerSec = sampleRate * channels * (bitsPerSample / 8);
    let off = 12;
    while (off + 8 <= buf.length) {
      const id = buf.toString('ascii', off, off + 4);
      const size = buf.readUInt32LE(off + 4);
      if (id === 'data') return size / bytesPerSec;
      off += 8 + size + (size % 2);
    }
    return (buf.length - 44) / bytesPerSec;
  } catch (_) {
    return 0;
  }
}

// Generate a voiceover for the given video props. Returns { src, seconds }
// (src is a data: URL), or null when no engine is available / disabled / on any
// failure — the caller then renders a silent video.
function generateNarration(props) {
  const script = narrationScript(props);
  if (!script) return null;

  const engine = pickEngine();
  if (!engine) return null;

  const wavPath = path.join(os.tmpdir(), `vo-${crypto.randomUUID()}.wav`);
  try {
    const res = spawnSync(engine.bin, engine.args(wavPath), {
      input: script,
      maxBuffer: 64 * 1024 * 1024,
    });
    if (res.status !== 0 || !fs.existsSync(wavPath)) {
      console.error(`Narration (${engine.name}) failed:`, res.stderr ? res.stderr.toString().slice(0, 300) : res.status);
      return null;
    }
    const wav = fs.readFileSync(wavPath);
    if (!wav.length) return null;
    return { src: `data:audio/wav;base64,${wav.toString('base64')}`, seconds: wavSeconds(wav) };
  } catch (err) {
    console.error('Narration error:', err.message);
    return null;
  } finally {
    fs.unlink(wavPath, () => {});
  }
}

module.exports = { generateNarration, pickEngine };
