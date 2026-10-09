/**
 * Resume Video settings — the look of the video, chosen BEFORE generating (voice, background colour,
 * headshot + where it sits). Pure and dependency-free so the one validator is shared by the settings
 * route, the render route and the tests. Stored per user in user_prefs.video_settings (migration 0046).
 */
import { VIDEO_VOICES } from "./video-ai";

export const MAX_HEADSHOT_DATA_URL_CHARS = 600_000; // ~450 KB of image; the client downsizes to ~50 KB
export const HEADSHOT_MAX_DIMENSION = 512;

export interface VideoSettings {
  voice: string;
  /** #rrggbb, or null for the default look. */
  backgroundColor: string | null;
  /** A jpeg/png data URL, or null for no headshot. */
  headshot: string | null;
  /** Centre of the headshot as fractions (0–1) of the frame width / height. */
  headshotX: number;
  headshotY: number;
  /** false ⇒ title slide only (the default); true ⇒ every slide. */
  everySlide: boolean;
}

export const DEFAULT_VIDEO_SETTINGS: VideoSettings = {
  voice: VIDEO_VOICES[0].key,
  backgroundColor: null,
  headshot: null,
  headshotX: 0.85,
  headshotY: 0.1,
  everySlide: false,
};

export function cleanHexColor(v: unknown): string | null {
  return typeof v === "string" && /^#[0-9a-fA-F]{6}$/.test(v.trim()) ? v.trim().toLowerCase() : null;
}

const clamp01 = (n: unknown, d: number) => (typeof n === "number" && Number.isFinite(n) ? Math.min(1, Math.max(0, n)) : d);

/** Only a real jpeg or png passes: the declared type AND the file's own first bytes must agree. */
export function cleanHeadshot(v: unknown): string | null {
  if (typeof v !== "string" || v.length > MAX_HEADSHOT_DATA_URL_CHARS) return null;
  const m = /^data:image\/(jpeg|png);base64,([A-Za-z0-9+/]+={0,2})$/.exec(v);
  if (!m) return null;
  const head = Array.from(atob(m[2].slice(0, 16)), (c) => c.charCodeAt(0)); // first 12 bytes; no Buffer so this also runs in the browser
  const isJpeg = head[0] === 0xff && head[1] === 0xd8 && head[2] === 0xff;
  const isPng = head[0] === 0x89 && head[1] === 0x50 && head[2] === 0x4e && head[3] === 0x47;
  if (m[1] === "jpeg" ? !isJpeg : !isPng) return null;
  return v;
}

export function cleanVideoSettings(raw: unknown): VideoSettings {
  const r = (raw && typeof raw === "object" ? raw : {}) as Record<string, unknown>;
  const voice = typeof r.voice === "string" && VIDEO_VOICES.some((x) => x.key === r.voice) ? r.voice : DEFAULT_VIDEO_SETTINGS.voice;
  return {
    voice,
    backgroundColor: cleanHexColor(r.backgroundColor),
    headshot: cleanHeadshot(r.headshot),
    headshotX: clamp01(r.headshotX, DEFAULT_VIDEO_SETTINGS.headshotX),
    headshotY: clamp01(r.headshotY, DEFAULT_VIDEO_SETTINGS.headshotY),
    everySlide: r.everySlide === true,
  };
}

/** The render options the legacy renderer accepts, from validated settings + the voiceover's slide starts. */
export function renderOptionsFor(s: VideoSettings, sceneStarts?: unknown) {
  const out: Record<string, unknown> = { quick: true };
  if (s.backgroundColor) out.backgroundColor = s.backgroundColor;
  if (s.headshot) {
    out.photoUrl = s.headshot;
    out.photoOverlay = { x: s.headshotX, y: s.headshotY, everySlide: s.everySlide };
  }
  if (
    Array.isArray(sceneStarts) && sceneStarts.length === 4 &&
    sceneStarts.every((n, i) => typeof n === "number" && Number.isFinite(n) && n >= 0 && n <= 600 && (i === 0 ? n === 0 : n >= sceneStarts[i - 1]))
  ) out.sceneStarts = sceneStarts;
  return out;
}
