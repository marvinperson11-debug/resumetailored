/**
 * Resume Video — script generation + voice catalog. Adapted from the old site's
 * Remotion resume-video pipeline (remotion/narration.js voice catalog,
 * parseResume → narration script). The AI turns a resume into a short,
 * first-person spoken script; ElevenLabs (server owner's key) voices it.
 */

export interface VideoTemplateMeta {
  id: string;
  label: string;
  desc: string;
  accent: string; // hex, drives the preview
}

export const VIDEO_TEMPLATES: VideoTemplateMeta[] = [
  { id: "professional", label: "Professional", desc: "Clean, corporate, confident", accent: "#1e3a8a" },
  { id: "creative", label: "Creative", desc: "Bold color, energetic pace", accent: "#7c3aed" },
  { id: "minimal", label: "Minimal", desc: "Quiet, typographic, calm", accent: "#111827" },
  { id: "warm", label: "Warm", desc: "Friendly, approachable, human", accent: "#b45309" },
];

/** ElevenLabs premade voices (ported from the old VOICE_CATALOG). */
export const VIDEO_VOICES: { key: string; id: string; label: string; gender: "female" | "male" }[] = [
  { key: "rachel", id: "21m00Tcm4TlvDq8ikWAM", label: "Rachel — calm & professional", gender: "female" },
  { key: "bella", id: "EXAVITQu4vr4xnSDxMaL", label: "Bella — soft & warm", gender: "female" },
  { key: "matilda", id: "XrExE9yKIg1WjnnlVkGX", label: "Matilda — friendly & upbeat", gender: "female" },
  { key: "charlotte", id: "XB0fDUnXU5powFXDhCwa", label: "Charlotte — warm, gentle accent", gender: "female" },
  { key: "adam", id: "pNInz6obpgDQGcFmaJgB", label: "Adam — deep & warm", gender: "male" },
  { key: "antoni", id: "ErXwobaYiN019PkySvjV", label: "Antoni — warm & well-rounded", gender: "male" },
  { key: "josh", id: "TxGEqnHWrfWFTfGW9XjX", label: "Josh — young & energetic", gender: "male" },
  { key: "daniel", id: "onwK4e9ZLuTAKqWW03F9", label: "Daniel — deep, British newsreader", gender: "male" },
];

export function voiceIdForKey(key: string | undefined): string {
  return VIDEO_VOICES.find((v) => v.key === key)?.id || VIDEO_VOICES[0].id;
}

/**
 * The ElevenLabs request settings, in ONE place. The voiceover route AND the one-off voice-sample
 * generator (scripts/generate-voice-samples.cjs) both read these, so a sample is rendered with exactly
 * the voice id, model and voice settings that "Generate voiceover" uses — what you audition is what you get.
 */
export const DEFAULT_ELEVENLABS_MODEL = "eleven_multilingual_v2";
export const ELEVENLABS_VOICE_SETTINGS = { stability: 0.5, similarity_boost: 0.75 } as const;

export function elevenLabsRequestBody(text: string, modelId?: string) {
  return { text, model_id: modelId || DEFAULT_ELEVENLABS_MODEL, voice_settings: { ...ELEVENLABS_VOICE_SETTINGS } };
}

/** The short line each voice sample speaks ("Hi, I'm Rachel, and this is how I'll sound in your video."). */
export function voiceSampleText(label: string): string {
  const first = label.split("—")[0].trim();
  return `Hi, I'm ${first}, and this is how I'll sound in your video.`;
}

/** Where a committed voice sample lives (static asset, served from /public). */
export function voiceSampleUrl(key: string): string {
  return `/voice-samples/${key}.mp3`;
}

/** Preset greeting openers offered in the Personalize section (custom text allowed too). */
export const GREETING_OPTIONS = [
  "Hello",
  "Hi",
  "Dear",
  "Good morning",
  "Good afternoon",
  "Greetings",
  "Hey",
  "To whom it may concern",
];

/** Preset closings offered in the Personalize section (custom text allowed too). */
export const CLOSING_OPTIONS = [
  "Thank you for your time",
  "Have a great day",
  "Best regards",
  "Looking forward to hearing from you",
  "Sincerely",
  "Talk soon",
  "Cheers",
  "Thanks for watching",
  "I look forward to speaking with you",
  "Let's connect soon",
];

export const DEFAULT_GREETING = "Hello";
export const DEFAULT_CLOSING = "Thank you for your time";

/** Optional personalization the Pro user sets in the modal. */
export interface VideoScriptOptions {
  /** Who the video is addressed to, e.g. "Sarah Johnson" or "Team at Google". Empty ⇒ generic opener. */
  to?: string;
  /** Greeting word/phrase, e.g. "Hello". */
  greeting?: string;
  /** Closing line, e.g. "Thank you for your time". */
  closing?: string;
}

export function buildVideoScriptPrompt(
  resume: string,
  template: string,
  opts: VideoScriptOptions = {}
): { system: string; user: string } {
  const tone =
    template === "creative"
      ? "energetic and bold"
      : template === "minimal"
      ? "calm, spare, and understated"
      : template === "warm"
      ? "warm, friendly, and human"
      : "polished and professional";

  const greeting = (opts.greeting || DEFAULT_GREETING).trim().slice(0, 60) || DEFAULT_GREETING;
  const to = (opts.to || "").trim().slice(0, 80);
  const closing = (opts.closing || DEFAULT_CLOSING).trim().slice(0, 140) || DEFAULT_CLOSING;
  // "Hello Sarah," when addressed, otherwise just "Hello,".
  const opener = to ? `${greeting} ${to},` : `${greeting},`;

  return {
    system:
      "You write short spoken scripts for 30–45 second first-person video resumes. The script is read aloud by one voice, so write natural, punchy spoken English — no headers, no stage directions, no markdown. It must sound like a confident person introducing themselves, not a document read aloud.",
    user: `Write a ${tone} first-person video-resume script (~90–120 words, ~35 seconds spoken) from the resume below.

Structure it as 4 short spoken beats, one per line, in this exact labeled form (keep the labels — the app splits on them):
HOOK: begin the sentence EXACTLY with "${opener}" then the person's name and a confident one-line hook — for example "${opener} I'm Jordan Lee, a ..."
PROOF: one or two sentences — the single most impressive, quantified achievement
STRENGTHS: one sentence — the skills/qualities that make them a strong hire
CLOSE: one sentence — what they're looking for — and END it with EXACTLY this sign-off: "${closing}."

Rules: first person ("I"), spoken cadence, real specifics from the resume (never invented), no buzzword soup, no "I am a results-driven professional". Do not repeat the greeting or the closing anywhere except where instructed above.

RESUME:
${resume.slice(0, 6000)}`,
  };
}

/** Group consecutive units into exactly 4 beats of roughly equal length (needs at least 4 units). */
function groupIntoFour(units: string[]): string[] {
  const total = units.reduce((n, u) => n + u.length, 0);
  const out: string[] = [];
  let i = 0;
  let spent = 0;
  for (let g = 0; g < 4; g++) {
    if (g === 3) { out.push(units.slice(i).join(" ")); break; }
    const items: string[] = [];
    // Leave at least one unit for every beat still to come.
    do {
      items.push(units[i]);
      spent += units[i].length;
      i++;
    } while (i < units.length - (3 - g) && spent < ((g + 1) * total) / 4);
    out.push(items.join(" "));
  }
  return out;
}

/**
 * Split a script that carries no HOOK/PROOF/STRENGTHS/CLOSE labels (one the user wrote, or edited) into
 * beats — nothing is dropped. Four lines are four beats; more lines (or, with fewer than four lines, four
 * or more sentences) are grouped into four balanced beats; anything shorter stays one beat per unit.
 */
export function splitUnlabeledBeats(script: string): string[] {
  const lines = script.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
  if (lines.length === 4) return lines;
  if (lines.length > 4) return groupIntoFour(lines);
  const sentences = lines.flatMap((l) => l.split(/(?<=[.!?。！？])\s+/)).map((x) => x.trim()).filter(Boolean);
  if (sentences.length >= 4) return groupIntoFour(sentences);
  return sentences;
}

/** Split the script into ordered scene lines for the preview + captions. */
export function parseScriptScenes(script: string): { label: string; text: string }[] {
  const labels = ["HOOK", "PROOF", "STRENGTHS", "CLOSE"];
  const out: { label: string; text: string }[] = [];
  for (const line of script.split("\n")) {
    const m = line.match(/^\s*(HOOK|PROOF|STRENGTHS|CLOSE)\s*:\s*(.+)$/i);
    if (m) out.push({ label: m[1].toUpperCase(), text: m[2].trim() });
  }
  // Unlabeled (written by the user, or hand-edited): split into beats without losing any of it.
  if (!out.length && script.trim()) {
    splitUnlabeledBeats(script).forEach((t, i) => out.push({ label: labels[i] || "SCENE", text: t }));
  }
  return out;
}

/** The plain spoken text (labels stripped) that gets sent to TTS. */
export function scriptToSpeech(script: string): string {
  const scenes = parseScriptScenes(script);
  if (scenes.length) return scenes.map((s) => s.text).join(" ");
  return script.replace(/^\s*(HOOK|PROOF|STRENGTHS|CLOSE)\s*:/gim, "").trim();
}

/**
 * Slide ↔ narration sync. The four script beats map one-to-one onto the four slides (title, highlights,
 * skills, close), and `scriptToSpeech` joins the beats with a single space. So each beat owns a character
 * range of the text sent to ElevenLabs, and ElevenLabs' character-level alignment tells us when each one
 * is actually spoken. Nothing here estimates a time.
 */
export interface BeatSpan {
  label: string;
  /** Inclusive start / exclusive end character offsets within `text`. */
  start: number;
  end: number;
}

export function scriptSpeechWithSpans(script: string): { text: string; spans: BeatSpan[] } {
  const scenes = parseScriptScenes(script);
  const text = scriptToSpeech(script);
  if (scenes.length !== 4) return { text, spans: [] };
  const spans: BeatSpan[] = [];
  let at = 0;
  for (const s of scenes) {
    spans.push({ label: s.label, start: at, end: at + s.text.length });
    at += s.text.length + 1; // the joining space
  }
  return { text, spans };
}

/** ElevenLabs character alignment (the `alignment` object of /with-timestamps). */
export interface CharAlignment {
  characters: string[];
  character_start_times_seconds: number[];
  character_end_times_seconds: number[];
}

/** Seconds a slide flips BEFORE its beat's first word, so the new slide is already settling as it is spoken. */
export const SLIDE_LEAD_SECONDS = 0.15;

/**
 * The four slide start times (seconds), taken from the real spoken timing of each beat — or null when the
 * alignment can't be trusted (missing, different length from the text we sent, or non-monotonic), in which
 * case the caller keeps the fixed timing. Never guesses.
 */
export function buildSceneStarts(
  alignment: unknown,
  text: string,
  spans: BeatSpan[]
): { sceneStarts: number[]; durationSeconds: number } | null {
  if (spans.length !== 4 || !alignment || typeof alignment !== "object") return null;
  const a = alignment as Partial<CharAlignment>;
  const chars = a.characters, starts = a.character_start_times_seconds, ends = a.character_end_times_seconds;
  if (!Array.isArray(chars) || !Array.isArray(starts) || !Array.isArray(ends)) return null;
  if (chars.length !== text.length || starts.length !== chars.length || ends.length !== chars.length) return null;
  if (chars.join("") !== text) return null;
  const out: number[] = [0];
  for (let i = 1; i < 4; i++) {
    const t = starts[spans[i].start];
    if (typeof t !== "number" || !Number.isFinite(t) || t < 0) return null;
    out.push(Math.max(out[i - 1], Math.round((t - SLIDE_LEAD_SECONDS) * 1000) / 1000));
  }
  const last = ends[ends.length - 1];
  if (typeof last !== "number" || !Number.isFinite(last) || last <= out[3]) return null;
  return { sceneStarts: out, durationSeconds: last };
}

/**
 * The script as the editable box shows it: just the words, one beat per line, no HOOK:/PROOF: labels.
 * Four lines are exactly the four slides' beats, so an edit that keeps four lines stays slide-synced.
 */
export function scriptToEditableText(script: string): string {
  const scenes = parseScriptScenes(script);
  return scenes.length ? scenes.map((s) => s.text).join("\n") : script.trim();
}

/** The script as a downloadable .txt: the words with a blank line between beats. */
export function scriptToDownloadText(script: string): string {
  const scenes = parseScriptScenes(script);
  const body = scenes.length ? scenes.map((s) => s.text).join("\n\n") : script.trim();
  return body + "\n";
}
