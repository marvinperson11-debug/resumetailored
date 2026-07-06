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
const { narrationScript, narrationTimeline } = require('./data');

// Parse an env override to a number, falling back to `dflt` and clamping to a
// safe range. Keeps voice settings tunable from Railway without code changes.
function clampNum(v, dflt, lo, hi) {
  const n = v == null || v === '' ? dflt : Number(v);
  if (!Number.isFinite(n)) return dflt;
  return Math.min(hi, Math.max(lo, n));
}

// Spread the total spoken duration across segments in proportion to their text
// length. Used when the engine gives no per-character timings (Piper/espeak):
// it's an estimate, but it still keeps each scene on screen for roughly as long
// as its line is spoken.
function estimateSegmentTimes(segments, seconds) {
  const total = segments.reduce((n, s) => n + s.text.length, 0) || 1;
  let t = 0;
  return segments.map((s) => {
    const start = t;
    t += seconds * (s.text.length / total);
    return { kind: s.kind, index: s.index, text: s.text, start, end: t };
  });
}

// Map each segment's character span to start/end seconds using ElevenLabs'
// per-character timing arrays (exact sync, no drift).
function segmentTimesFromChars(segments, starts, ends) {
  const last = ends.length - 1;
  return segments.map((s) => {
    const si = Math.max(0, Math.min(s.charStart, starts.length - 1));
    const ei = Math.max(0, Math.min(s.charEnd - 1, last));
    return { kind: s.kind, index: s.index, text: s.text, start: starts[si] || 0, end: ends[ei] || 0 };
  });
}

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

// Default Piper voice models per gender. lessac (female) was the original single
// voice; ryan (male) is added so a "male" pick is never silently rendered in the
// female voice. Both are standard en_US Piper voices; all env-overridable.
// Chinese narration uses huayan — the one widely-distributed zh_CN Piper voice
// (female); there is no standard male zh_CN model, so both genders speak it
// unless PIPER_VOICE_ID_ZH_MALE points at a custom one.
const PIPER_VOICE_FEMALE  = process.env.PIPER_VOICE_ID_FEMALE || process.env.PIPER_VOICE_ID || 'en_US-lessac-medium';
const PIPER_VOICE_MALE    = process.env.PIPER_VOICE_ID_MALE   || 'en_US-ryan-high';
const PIPER_VOICE_ZH      = process.env.PIPER_VOICE_ID_ZH      || 'zh_CN-huayan-medium';
const PIPER_VOICE_ZH_MALE = process.env.PIPER_VOICE_ID_ZH_MALE || PIPER_VOICE_ZH;
function piperVoiceIdFor(gender, lang) {
  if (lang === 'zh') return gender === 'male' ? PIPER_VOICE_ZH_MALE : PIPER_VOICE_ZH;
  return gender === 'male' ? PIPER_VOICE_MALE : PIPER_VOICE_FEMALE;
}

// Decide which gender of voice to render locally. An explicit voiceGender wins;
// otherwise infer it from the catalog key the user picked (e.g. "adam" -> male);
// default female to preserve the original behavior when nothing is specified.
function desiredGender(opts = {}) {
  if (opts.voiceGender === 'male' || opts.voiceGender === 'female') return opts.voiceGender;
  const key = String((opts && (opts.voice || opts.voiceKey)) || '').toLowerCase();
  if (key && VOICE_CATALOG[key]) return VOICE_CATALOG[key].gender;
  return 'female';
}

// Candidate directories where a Piper .onnx voice model may live.
function piperVoiceDirs() {
  return [
    process.env.PIPER_DATA_DIR,
    path.join(process.cwd(), 'piper-voices'),
    path.join(process.env.DATA_DIR || './data', 'piper'),
  ].filter(Boolean);
}

// Locate a Piper voice model by id, downloading it once (best-effort) if absent.
// `PIPER_VOICE` (an explicit file path) still wins as a global override, but only
// for the female/default English request — a male request must not be forced to
// a single female file, and a Chinese request must not be forced to an English
// model, so those fall through to per-gender/per-language id resolution.
function resolvePiperVoice(voiceId, gender, lang) {
  if (gender !== 'male' && lang !== 'zh' && process.env.PIPER_VOICE && fs.existsSync(process.env.PIPER_VOICE)) {
    return process.env.PIPER_VOICE;
  }
  for (const dir of piperVoiceDirs()) {
    const p = path.join(dir, `${voiceId}.onnx`);
    if (fs.existsSync(p)) return p;
  }
  // Backstop: download into a writable dir (normally pre-fetched at build time).
  if (process.env.PIPER_AUTODOWNLOAD !== 'off' && hasPiperModule()) {
    const target = process.env.PIPER_DATA_DIR || path.join(process.env.DATA_DIR || './data', 'piper');
    try {
      fs.mkdirSync(target, { recursive: true });
      const r = spawnSync('python3', ['-m', 'piper.download_voices', voiceId, '--data-dir', target], {
        stdio: ['ignore', 'ignore', 'ignore'],
        timeout: 180000,
      });
      const p = path.join(target, `${voiceId}.onnx`);
      if (r.status === 0 && fs.existsSync(p)) return p;
    } catch (_) {
      /* fall through to espeak */
    }
  }
  return null;
}

// Build a Piper engine descriptor if a binary + model are available.
function piperEngine(gender, lang) {
  const voice = resolvePiperVoice(piperVoiceIdFor(gender, lang), gender, lang);
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
// `gender` ('male'|'female') selects a matching local voice so the rendered
// fallback voiceover matches the gender the user picked; `lang` ('en'|'zh')
// selects a voice that can actually speak the script's language.
function pickEngine(gender, lang) {
  if (process.env.RESUME_VIDEO_VOICE === 'off') return null;

  const piper = piperEngine(gender, lang);
  if (piper) return piper;

  // espeak voice variants: en-us+m1..m7 (male) / en-us+f1..f5 (female); Mandarin
  // is 'cmn' with the same +m/+f variants. A global ESPEAK_VOICE override still
  // wins for back-compat; otherwise pick per language + gender.
  const voice = process.env.ESPEAK_VOICE
    || (lang === 'zh'
        ? (gender === 'male'
            ? (process.env.ESPEAK_VOICE_ZH_MALE || 'cmn+m3')
            : (process.env.ESPEAK_VOICE_ZH || 'cmn+f3'))
        : (gender === 'male'
            ? (process.env.ESPEAK_VOICE_MALE || 'en-us+m3')
            : (process.env.ESPEAK_VOICE_FEMALE || 'en-us+f3')));
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
function generateNarration(props, opts = {}) {
  const { script, segments } = narrationTimeline(props);
  if (!script) return null;

  const engine = pickEngine(desiredGender(opts), props && props.lang === 'zh' ? 'zh' : 'en');
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
    const seconds = wavSeconds(wav);
    return {
      src: `data:audio/wav;base64,${wav.toString('base64')}`,
      seconds,
      segments: estimateSegmentTimes(segments, seconds),
    };
  } catch (err) {
    console.error('Narration error:', err.message);
    return null;
  } finally {
    fs.unlink(wavPath, () => {});
  }
}

// ── ElevenLabs (studio-quality cloud voice) ────────────────────────────────
// Used for the downloadable MP4 when ELEVENLABS_API_KEY is set. Uses the server
// owner's key (one account), so the caller gates it (e.g. subscribers only) to
// control credit spend. Falls back to the local engine on any failure.
function elevenConfig() {
  const key = process.env.ELEVENLABS_API_KEY;
  if (!key) return null;
  return {
    key,
    // multilingual_v2 is ElevenLabs' most natural/expressive model — worth the
    // few extra seconds for a polished, human-sounding subscriber video. Set
    // ELEVENLABS_MODEL_ID=eleven_turbo_v2_5 to trade a little warmth for speed.
    model: process.env.ELEVENLABS_MODEL_ID || 'eleven_multilingual_v2',
  };
}

// Curated set of well-known, stable ElevenLabs premade voices the user can pick
// from for the resume video. Single source of truth: the front-end fetches this
// list (labels only) from /api/video-voices so the picker can't drift from what
// the server actually renders. Keys are what the client sends back as `voice`.
const VOICE_CATALOG = {
  // Female
  rachel:    { id: '21m00Tcm4TlvDq8ikWAM', label: 'Rachel — calm & professional',    gender: 'female' },
  bella:     { id: 'EXAVITQu4vr4xnSDxMaL', label: 'Bella — soft & warm',              gender: 'female' },
  matilda:   { id: 'XrExE9yKIg1WjnnlVkGX', label: 'Matilda — friendly & upbeat',      gender: 'female' },
  charlotte: { id: 'XB0fDUnXU5powFXDhCwa', label: 'Charlotte — warm, gentle accent',  gender: 'female' },
  // Male
  adam:      { id: 'pNInz6obpgDQGcFmaJgB', label: 'Adam — deep & warm',               gender: 'male' },
  antoni:    { id: 'ErXwobaYiN019PkySvjV', label: 'Antoni — warm & well-rounded',     gender: 'male' },
  josh:      { id: 'TxGEqnHWrfWFTfGW9XjX', label: 'Josh — young & energetic',         gender: 'male' },
  daniel:    { id: 'onwK4e9ZLuTAKqWW03F9', label: 'Daniel — deep, British newsreader', gender: 'male' },
};

// Public option list for the picker — keys + labels + gender, never the raw IDs.
function videoVoiceOptions() {
  return Object.entries(VOICE_CATALOG).map(([key, v]) => ({ key, label: v.label, gender: v.gender }));
}

// Resolve the ElevenLabs voice for a render. An explicit pick from the catalog
// (`opts.voice`, validated) wins; otherwise fall back to a per-gender default.
// The video is first-person ("My name is …"), so it sounds most human when the
// voice matches the candidate. Defaults/IDs are env-overridable per gender
// (ELEVENLABS_VOICE_ID_MALE/_FEMALE) or globally (ELEVENLABS_VOICE_ID).
function resolveVoiceId(opts = {}) {
  const key = String((opts && (opts.voice || opts.voiceKey)) || '').toLowerCase();
  if (key && VOICE_CATALOG[key]) return VOICE_CATALOG[key].id;
  const female = process.env.ELEVENLABS_VOICE_ID_FEMALE || process.env.ELEVENLABS_VOICE_ID || VOICE_CATALOG.bella.id;
  const male = process.env.ELEVENLABS_VOICE_ID_MALE || VOICE_CATALOG.adam.id;
  const gender = opts && opts.voiceGender;
  if (gender === 'male') return male;
  if (gender === 'female') return female;
  return process.env.ELEVENLABS_VOICE_ID || female;
}

async function elevenNarration(props, opts = {}) {
  const cfg = elevenConfig();
  if (!cfg) return null;
  const { script: text, segments } = narrationTimeline(props);
  if (!text) return null;

  const voiceId = resolveVoiceId(opts);
  // with-timestamps returns the audio AND per-character timings, so we get an
  // exact duration to extend the video by, plus exact per-segment start/end
  // times to drive the reveal sync. mp3 works on every ElevenLabs tier.
  const url = `https://api.elevenlabs.io/v1/text-to-speech/${voiceId}/with-timestamps?output_format=mp3_44100_128`;
  const vs = {
    // Lower stability + more style = warmer, more expressive and less monotone
    // (the "robotic" feel comes from flat, over-stable delivery); higher
    // similarity hews closer to the real human recording; speed < 1 relaxes the
    // pace. All env-tunable so the voice can be dialled in without a code change.
    stability: clampNum(process.env.ELEVENLABS_STABILITY, 0.3, 0, 1),
    similarity_boost: clampNum(process.env.ELEVENLABS_SIMILARITY, 0.85, 0, 1),
    style: clampNum(process.env.ELEVENLABS_STYLE, 0.55, 0, 1),
    use_speaker_boost: true,
    // A subscriber-chosen pace (opts.speed) wins over the env default. 1.0 is
    // natural; lower is slower/calmer, higher is faster. Clamped to a safe range.
    speed: clampNum(opts.speed != null ? opts.speed : process.env.ELEVENLABS_SPEED, 0.9, 0.7, 1.2),
  };
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'xi-api-key': cfg.key, 'Content-Type': 'application/json' },
    body: JSON.stringify({ text, model_id: cfg.model, voice_settings: vs }),
  });
  if (!res.ok) {
    console.error('ElevenLabs TTS failed:', res.status, (await res.text().catch(() => '')).slice(0, 200));
    return null;
  }
  const data = await res.json();
  if (!data || !data.audio_base64) return null;
  const align = data.alignment || data.normalized_alignment || {};
  const ends = align.character_end_times_seconds || [];
  const starts = align.character_start_times_seconds || ends.map((_, i) => (i ? ends[i - 1] : 0));
  const seconds = ends.length ? ends[ends.length - 1] : Math.max(4, text.length / 14);
  const segTimes = ends.length
    ? segmentTimesFromChars(segments, starts, ends)
    : estimateSegmentTimes(segments, seconds);
  return { src: `data:audio/mpeg;base64,${data.audio_base64}`, seconds, segments: segTimes };
}

// Preferred entry point for the server. Tries ElevenLabs first (when allowed and
// configured), else the local engine (Piper/espeak), else null (silent video).
async function generateNarrationAsync(props, opts = {}) {
  if (opts.allowEleven !== false && process.env.RESUME_VIDEO_VOICE !== 'off') {
    try {
      const el = await elevenNarration(props, opts);
      if (el) return el;
    } catch (err) {
      console.error('ElevenLabs narration error:', err.message);
    }
  }
  return generateNarration(props, opts);
}

module.exports = { generateNarration, generateNarrationAsync, pickEngine, desiredGender, piperVoiceIdFor, VOICE_CATALOG, videoVoiceOptions };
