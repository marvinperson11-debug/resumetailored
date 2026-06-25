// Optional quiet background music bed for the resume video.
//
// Priority:
//   1. BACKGROUND_MUSIC=off                  → no music.
//   2. BACKGROUND_MUSIC_URL=<http/data url>  → use that track (drop in your own
//      royalty-free jingle without touching code).
//   3. otherwise                              → a soft, generated ambient pad so
//      there's a pleasant bed out of the box. It's intentionally minimal and
//      low — meant to sit *under* the voice, not compete with it.
//
// Returns { src } (data/HTTP URL) or null. Cached: the generated bed is built
// once per process.

let cached;

// Minimal 16-bit PCM mono WAV encoder.
function encodeWav(samples, sampleRate) {
  const dataLen = samples.length * 2;
  const buf = Buffer.alloc(44 + dataLen);
  buf.write('RIFF', 0);
  buf.writeUInt32LE(36 + dataLen, 4);
  buf.write('WAVE', 8);
  buf.write('fmt ', 12);
  buf.writeUInt32LE(16, 16);
  buf.writeUInt16LE(1, 20); // PCM
  buf.writeUInt16LE(1, 22); // mono
  buf.writeUInt32LE(sampleRate, 24);
  buf.writeUInt32LE(sampleRate * 2, 28);
  buf.writeUInt16LE(2, 32);
  buf.writeUInt16LE(16, 34);
  buf.write('data', 36);
  buf.writeUInt32LE(dataLen, 40);
  for (let i = 0; i < samples.length; i++) {
    let s = Math.max(-1, Math.min(1, samples[i]));
    buf.writeInt16LE(Math.round(s * 32767), 44 + i * 2);
  }
  return buf;
}

// Gentle, consonant ambient pad (A major-ish) with a slow swell. Soft attack on
// each note so it breathes rather than buzzes; overall level kept low.
function generatePad() {
  const sr = 22050;
  const seconds = 24;
  const n = sr * seconds;
  const out = new Float32Array(n);
  // A soft, warm chord with a low sub for warmth and a gently rolled-off top so
  // it sits calmly under the voice (A1 sub, A2, E3, A3, C#4, soft E4).
  const voices = [
    { f: 55.0, a: 0.28 }, // warm sub-octave
    { f: 110.0, a: 0.5 },
    { f: 164.81, a: 0.38 },
    { f: 220.0, a: 0.3 },
    { f: 277.18, a: 0.2 },
    { f: 329.63, a: 0.1 }, // softer, less bright top
  ];
  for (let i = 0; i < n; i++) {
    const t = i / sr;
    // Slow tremolo so the pad gently breathes (~0.08 Hz).
    const swell = 0.6 + 0.4 * Math.sin(2 * Math.PI * 0.08 * t - Math.PI / 2);
    let s = 0;
    for (const v of voices) {
      // Two slightly detuned sines per voice for a softer, chorused tone.
      s += v.a * Math.sin(2 * Math.PI * v.f * t);
      s += v.a * 0.5 * Math.sin(2 * Math.PI * (v.f * 1.003) * t);
    }
    out[i] = s * swell;
  }
  // Normalize, then scale down so it's a quiet bed.
  let peak = 0;
  for (let i = 0; i < n; i++) peak = Math.max(peak, Math.abs(out[i]));
  const norm = peak > 0 ? 0.5 / peak : 0;
  // Short fades at both ends to avoid clicks when the track loops.
  const fade = sr * 1.2;
  for (let i = 0; i < n; i++) {
    let g = norm;
    if (i < fade) g *= i / fade;
    else if (i > n - fade) g *= (n - i) / fade;
    out[i] *= g;
  }
  return encodeWav(out, sr);
}

function backgroundMusic() {
  if (cached !== undefined) return cached;
  if (process.env.BACKGROUND_MUSIC === 'off') return (cached = null);
  if (process.env.BACKGROUND_MUSIC_URL) return (cached = { src: process.env.BACKGROUND_MUSIC_URL });
  try {
    const wav = generatePad();
    cached = { src: `data:audio/wav;base64,${wav.toString('base64')}` };
  } catch (_) {
    cached = null;
  }
  return cached;
}

module.exports = { backgroundMusic };
