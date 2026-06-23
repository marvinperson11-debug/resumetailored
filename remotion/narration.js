// Free, self-hosted text-to-speech for the resume video voiceover. Produces a
// WAV and returns it as a data: URL that the Remotion composition muxes into
// the MP4 via <Audio>. No cloud account or API key required.
//
// Engine selection (first available wins):
//   1. Piper  — if PIPER_BIN + PIPER_VOICE are set (free, neural, best quality)
//   2. espeak-ng / espeak on PATH — free, lightweight, robotic (installed via
//      nixpacks.toml on Railway)
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

// Returns { bin, args(wavPath) } for the first available engine, or null.
function pickEngine() {
  if (process.env.RESUME_VIDEO_VOICE === 'off') return null;

  const piperBin = process.env.PIPER_BIN;
  const piperVoice = process.env.PIPER_VOICE;
  if (piperBin && piperVoice) {
    return { name: 'piper', bin: piperBin, args: (wav) => ['--model', piperVoice, '--output_file', wav] };
  }

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
