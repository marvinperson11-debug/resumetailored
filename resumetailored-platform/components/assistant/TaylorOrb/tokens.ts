/**
 * TaylorOrb design tokens (Phase 1, Nov 2026). Exported verbatim so any
 * future reuse of the orb (sidebar badge, dynamic-bar icon) matches this
 * build pixel-for-pixel instead of re-deriving its own values.
 *
 * Core gold = tailwind.config.ts's `violet` (#C2870B, commented "primary
 * accent (gold rebrand)") — the SAME token already used for Taylor's Bot
 * avatar icon (`text-violet` in assistant-client.tsx) and the panel's
 * `border-gold`/`bg-gold` chrome. `gold` (#F59E0B) is the OTHER accent in
 * that file ("amber, part of the living gradient") — a different, unrelated
 * token, not Taylor's — so it is deliberately not used here.
 */

export type TaylorOrbState = "idle" | "listening" | "speaking" | "thinking" | "has-update";

export type TaylorOrbPlacement = "header" | "message-avatar" | "sidebar-badge" | "dynamic-bar-icon";

export const TAYLOR_ORB_COLORS = {
  /** = tailwind `violet` (#C2870B). */
  core: "#C2870B",
  /** core, 15% channel-mixed toward white. */
  highlight: "#CB9930",
  /** core, 20% channel-scaled toward black. */
  shadow: "#9B6C09",
  /** core at 40% opacity (canvas glow / shadow-blur colour). */
  glow: "rgba(194, 135, 11, 0.4)",
} as const;

export const TAYLOR_ORB_SIZES = {
  /** Documented spec default. The real header slot this build wires into —
   *  VoiceSettingsPopover's trigger icon (components/assistant/
   *  VoiceSettingsPopover.tsx) — measures 16px (`h-4 w-4`), not 24; every
   *  call site in this codebase passes `size={16}` explicitly so swapping
   *  in the orb causes zero layout shift. 24 remains the exported default
   *  for a future placement that actually has a 24px slot. */
  header: 24,
  messageAvatar: 32,
} as const;

export const TAYLOR_ORB_TIMINGS = {
  idle: 4000,
  listening: 2000,
  speaking: 800,
  thinking: 2400,
  hasUpdatePulse: 3000,
  transition: 300,
} as const;

/** Per-state motion parameters — pure data, consumed by TaylorOrb.tsx's
 *  render loop AND asserted on directly by scripts/test-taylor-orb.cjs, so
 *  "every state is visibly distinguishable" is a checkable fact about this
 *  table, not just a claim about pixels. `amplitudeScale` is relative to
 *  idle's own base amplitude; `rotationSpeed` is revolutions per ms (0 =
 *  none); `bobPx` is a vertical offset in raw (unscaled) pixels;
 *  `pulsePeriod` is ms or null; `envelope` is "peak-mid" only for
 *  `speaking`, where amplitude itself follows |sin| within each cycle. */
export interface TaylorOrbMotionParams {
  period: number;
  amplitudeScale: number;
  rotationSpeed: number;
  bobPx: number;
  pulsePeriod: number | null;
  envelope: "none" | "peak-mid";
}

export const TAYLOR_ORB_MOTION: Record<TaylorOrbState, TaylorOrbMotionParams> = {
  idle: { period: TAYLOR_ORB_TIMINGS.idle, amplitudeScale: 1, rotationSpeed: 0, bobPx: 0, pulsePeriod: null, envelope: "none" },
  listening: { period: TAYLOR_ORB_TIMINGS.listening, amplitudeScale: 1.4, rotationSpeed: 0, bobPx: 0, pulsePeriod: null, envelope: "none" },
  speaking: { period: TAYLOR_ORB_TIMINGS.speaking, amplitudeScale: 2, rotationSpeed: 0, bobPx: 0, pulsePeriod: null, envelope: "peak-mid" },
  thinking: { period: TAYLOR_ORB_TIMINGS.thinking, amplitudeScale: 0.55, rotationSpeed: 1 / TAYLOR_ORB_TIMINGS.thinking, bobPx: 1, pulsePeriod: null, envelope: "none" },
  "has-update": { period: TAYLOR_ORB_TIMINGS.idle, amplitudeScale: 1.1, rotationSpeed: 0, bobPx: 0, pulsePeriod: TAYLOR_ORB_TIMINGS.hasUpdatePulse, envelope: "none" },
};

export function getOrbMotionParams(state: TaylorOrbState): TaylorOrbMotionParams {
  return TAYLOR_ORB_MOTION[state];
}
