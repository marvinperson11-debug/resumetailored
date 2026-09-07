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

export function buildVideoScriptPrompt(resume: string, template: string): { system: string; user: string } {
  const tone =
    template === "creative"
      ? "energetic and bold"
      : template === "minimal"
      ? "calm, spare, and understated"
      : template === "warm"
      ? "warm, friendly, and human"
      : "polished and professional";
  return {
    system:
      "You write short spoken scripts for 30–45 second first-person video resumes. The script is read aloud by one voice, so write natural, punchy spoken English — no headers, no stage directions, no markdown. It must sound like a confident person introducing themselves, not a document read aloud.",
    user: `Write a ${tone} first-person video-resume script (~90–120 words, ~35 seconds spoken) from the resume below.

Structure it as 4 short spoken beats, one per line, in this exact labeled form (keep the labels — the app splits on them):
HOOK: one sentence — name + who they are + a confident hook
PROOF: one or two sentences — the single most impressive, quantified achievement
STRENGTHS: one sentence — the skills/qualities that make them a strong hire
CLOSE: one sentence — what they're looking for + a warm sign-off

Rules: first person ("I"), spoken cadence, real specifics from the resume (never invented), no buzzword soup, no "I am a results-driven professional".

RESUME:
${resume.slice(0, 6000)}`,
  };
}

/** Split the labeled script into ordered scene lines for the preview + captions. */
export function parseScriptScenes(script: string): { label: string; text: string }[] {
  const labels = ["HOOK", "PROOF", "STRENGTHS", "CLOSE"];
  const out: { label: string; text: string }[] = [];
  for (const line of script.split("\n")) {
    const m = line.match(/^\s*(HOOK|PROOF|STRENGTHS|CLOSE)\s*:\s*(.+)$/i);
    if (m) out.push({ label: m[1].toUpperCase(), text: m[2].trim() });
  }
  // Fallback: if the model didn't label, split into sentences.
  if (!out.length && script.trim()) {
    script
      .split(/(?<=[.!?])\s+/)
      .filter(Boolean)
      .slice(0, 4)
      .forEach((t, i) => out.push({ label: labels[i] || "SCENE", text: t.trim() }));
  }
  return out;
}

/** The plain spoken text (labels stripped) that gets sent to TTS. */
export function scriptToSpeech(script: string): string {
  const scenes = parseScriptScenes(script);
  if (scenes.length) return scenes.map((s) => s.text).join(" ");
  return script.replace(/^\s*(HOOK|PROOF|STRENGTHS|CLOSE)\s*:/gim, "").trim();
}
