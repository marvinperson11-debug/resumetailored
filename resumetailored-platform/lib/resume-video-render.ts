/**
 * What the Next app sends to the legacy renderer (POST /api/resume-video-render) for the MP4.
 * Kept pure so the one rule that matters — the generated voiceover MP3 travels to the renderer intact, as
 * a data:audio URL, so it can be muxed in as the MP4's audio track — is unit-tested.
 */
import { cleanVideoSettings, renderOptionsFor } from "./video-settings";

export const MAX_AUDIO_DATA_URL_CHARS = 20 * 1024 * 1024;

export interface RenderInput {
  script?: unknown;
  resume?: unknown;
  style?: unknown;
  photoUrl?: unknown;
  audioUrl?: unknown;
  title?: unknown;
  /** The Video settings the user chose (validated here — never trusted as sent). */
  settings?: unknown;
  /** Slide start times (seconds) from the voiceover's ElevenLabs timestamps; only meaningful with audioUrl. */
  sceneStarts?: unknown;
}

/** The voiceover as the renderer accepts it (data:audio/…;base64,…), or undefined. Never mangled or re-encoded. */
export function cleanAudioDataUrl(v: unknown): string | undefined {
  if (typeof v !== "string") return undefined;
  if (!/^data:audio\/[a-z0-9.+-]+;base64,/i.test(v)) return undefined;
  if (v.length > MAX_AUDIO_DATA_URL_CHARS) return undefined;
  return v;
}

export function buildRenderPayload(body: RenderInput, userId: string) {
  const audioUrl = cleanAudioDataUrl(body.audioUrl);
  const settings = cleanVideoSettings(body.settings);
  // Slide starts describe THIS voiceover's timing: without the audio they would pace a silent video wrongly.
  const opts = renderOptionsFor(settings, audioUrl ? body.sceneStarts : undefined);
  return {
    script: typeof body.script === "string" ? body.script : "",
    resume: typeof body.resume === "string" ? body.resume : "",
    style: body.style,
    // The headshot comes from the validated settings only (jpeg/png), not from a free-form photoUrl.
    ...opts,
    audioUrl,
    title: typeof body.title === "string" && body.title ? body.title : "Resume video",
    userId,
  };
}
