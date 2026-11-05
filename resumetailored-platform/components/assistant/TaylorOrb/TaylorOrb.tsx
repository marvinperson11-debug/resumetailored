"use client";

import { useEffect, useRef, useState } from "react";
import {
  TAYLOR_ORB_COLORS,
  TAYLOR_ORB_SIZES,
  TAYLOR_ORB_TIMINGS,
  getOrbMotionParams,
  type TaylorOrbPlacement,
  type TaylorOrbState,
} from "./tokens";

export interface TaylorOrbProps {
  state: TaylorOrbState;
  placement: TaylorOrbPlacement;
  /** px; defaults: 24 for 'header', 32 for 'message-avatar' (and anything
   *  else not yet given its own default). */
  size?: number;
  className?: string;
  "aria-label"?: string;
}

const VERTEX_COUNT = 40;
const HARMONIC_A = 5;
const HARMONIC_B = 9;

const STATE_LABEL: Record<TaylorOrbState, string> = {
  idle: "idle",
  listening: "listening",
  speaking: "speaking",
  thinking: "thinking",
  "has-update": "has new information",
};

function defaultSizeFor(placement: TaylorOrbPlacement): number {
  if (placement === "message-avatar") return TAYLOR_ORB_SIZES.messageAvatar;
  return TAYLOR_ORB_SIZES.header;
}

function easeInOutCubic(x: number): number {
  return x < 0.5 ? 4 * x * x * x : 1 - Math.pow(-2 * x + 2, 3) / 2;
}

function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}

/** Reads `prefers-reduced-motion` defensively — jsdom and some older
 *  browsers either lack `matchMedia` or throw calling it; either way this
 *  logs rather than failing silently, and falls back to "no preference". */
function detectReducedMotion(): boolean {
  if (typeof window === "undefined" || typeof window.matchMedia !== "function") return false;
  try {
    return window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  } catch (err) {
    console.error("[TaylorOrb] prefers-reduced-motion query failed", err);
    return false;
  }
}

function subscribeReducedMotion(onChange: (reduced: boolean) => void): () => void {
  if (typeof window === "undefined" || typeof window.matchMedia !== "function") return () => {};
  try {
    const mq = window.matchMedia("(prefers-reduced-motion: reduce)");
    const handler = () => onChange(mq.matches);
    mq.addEventListener("change", handler);
    return () => mq.removeEventListener("change", handler);
  } catch (err) {
    console.error("[TaylorOrb] prefers-reduced-motion subscription failed", err);
    return () => {};
  }
}

interface BlendSnapshot {
  period: number;
  amplitudeScale: number;
  rotationSpeed: number;
  bobPx: number;
}

/**
 * Draws one frame of the living gold waveform: a closed, many-vertex ring
 * (never a flat circle) whose radius is the sum of two sine harmonics, so it
 * reads as a connected, flowing wave rather than a static ball. `elapsedMs`
 * is time since mount (continuous phase accumulator); `envelope` is
 * `speaking`'s within-cycle amplitude pulse.
 */
function drawOrbFrame(
  ctx: CanvasRenderingContext2D,
  opts: {
    size: number;
    elapsedMs: number;
    snapshot: BlendSnapshot;
    envelope: "none" | "peak-mid";
    pulsePeriod: number | null;
  }
) {
  const { size, elapsedMs, snapshot, envelope, pulsePeriod } = opts;
  const cx = size / 2;
  const cy = size / 2;
  const baseRadius = size * 0.3;
  const baseAmplitude = size * 0.045 * snapshot.amplitudeScale;

  let amplitude = baseAmplitude;
  if (envelope === "peak-mid" && snapshot.period > 0) {
    const phase = (elapsedMs % snapshot.period) / snapshot.period;
    amplitude = baseAmplitude * Math.abs(Math.sin(Math.PI * phase));
  }

  let glowBoost = 1;
  if (pulsePeriod) {
    const pulsePhase = (elapsedMs % pulsePeriod) / pulsePeriod;
    glowBoost = 1 + 0.35 * Math.max(0, Math.sin(Math.PI * 2 * pulsePhase));
  }

  const rotation = snapshot.rotationSpeed * elapsedMs * Math.PI * 2;
  const bobY = snapshot.bobPx * Math.sin((elapsedMs / Math.max(1, snapshot.period)) * Math.PI * 2);

  ctx.clearRect(0, 0, size, size);
  ctx.save();
  ctx.translate(0, bobY);

  ctx.beginPath();
  for (let i = 0; i <= VERTEX_COUNT; i++) {
    const angle = (i / VERTEX_COUNT) * Math.PI * 2 + rotation;
    const wave =
      Math.sin(angle * HARMONIC_A + elapsedMs * 0.0022) * 0.6 + Math.sin(angle * HARMONIC_B + elapsedMs * 0.0013) * 0.4;
    const r = baseRadius + amplitude * wave;
    const x = cx + r * Math.cos(angle);
    const y = cy + r * Math.sin(angle);
    if (i === 0) ctx.moveTo(x, y);
    else ctx.lineTo(x, y);
  }
  ctx.closePath();

  const gradient = ctx.createRadialGradient(cx, cy, baseRadius * 0.1, cx, cy, baseRadius + amplitude);
  gradient.addColorStop(0, TAYLOR_ORB_COLORS.highlight);
  gradient.addColorStop(1, TAYLOR_ORB_COLORS.shadow);
  ctx.fillStyle = gradient;
  ctx.shadowColor = TAYLOR_ORB_COLORS.glow;
  ctx.shadowBlur = size * 0.3 * glowBoost;
  ctx.fill();

  ctx.shadowBlur = 0;
  ctx.lineWidth = Math.max(1, size * 0.04);
  ctx.strokeStyle = TAYLOR_ORB_COLORS.highlight;
  ctx.stroke();

  ctx.restore();
}

/**
 * Taylor's living gold orb — a flowing, high-polygon waveform ring, never a
 * static circle. Purely presentational: no network calls, no audio of any
 * kind. See tokens.ts for the exact colour/size/timing spec this matches.
 */
export function TaylorOrb({ state, placement, size, className, "aria-label": ariaLabel }: TaylorOrbProps) {
  const resolvedSize = size ?? defaultSizeFor(placement);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const [reducedMotion, setReducedMotion] = useState<boolean>(() => detectReducedMotion());

  const mountTimeRef = useRef<number | null>(null);
  const snapshotRef = useRef<BlendSnapshot>({
    period: getOrbMotionParams(state).period,
    amplitudeScale: getOrbMotionParams(state).amplitudeScale,
    rotationSpeed: getOrbMotionParams(state).rotationSpeed,
    bobPx: getOrbMotionParams(state).bobPx,
  });
  const fromSnapshotRef = useRef<BlendSnapshot>({ ...snapshotRef.current });
  const transitionStartRef = useRef<number>(0);
  const stateRef = useRef<TaylorOrbState>(state);
  const rafRef = useRef<number | null>(null);

  useEffect(() => {
    return subscribeReducedMotion(setReducedMotion);
  }, []);

  // On every state change, snapshot where the animation currently is and
  // start a TAYLOR_ORB_TIMINGS.transition ms ease-in-out crossfade toward
  // the new state's parameters, instead of jumping instantly.
  useEffect(() => {
    if (stateRef.current === state) return;
    fromSnapshotRef.current = { ...snapshotRef.current };
    transitionStartRef.current = performance.now();
    stateRef.current = state;
  }, [state]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) {
      console.error("[TaylorOrb] 2D canvas context unavailable; rendering nothing for this frame", {
        placement,
        state,
      });
      return;
    }

    const dpr = Math.min(2, typeof window !== "undefined" ? window.devicePixelRatio || 1 : 1);
    canvas.width = resolvedSize * dpr;
    canvas.height = resolvedSize * dpr;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

    if (mountTimeRef.current === null) mountTimeRef.current = performance.now();

    const renderFrame = (now: number) => {
      const elapsedMs = now - (mountTimeRef.current ?? now);
      const target = getOrbMotionParams(stateRef.current);
      const sinceTransition = now - transitionStartRef.current;
      const t = Math.min(1, sinceTransition / TAYLOR_ORB_TIMINGS.transition);
      const eased = easeInOutCubic(t);
      const blended: BlendSnapshot = {
        period: lerp(fromSnapshotRef.current.period, target.period, eased),
        amplitudeScale: lerp(fromSnapshotRef.current.amplitudeScale, target.amplitudeScale, eased),
        rotationSpeed: lerp(fromSnapshotRef.current.rotationSpeed, target.rotationSpeed, eased),
        bobPx: lerp(fromSnapshotRef.current.bobPx, target.bobPx, eased),
      };
      snapshotRef.current = blended;
      drawOrbFrame(ctx, { size: resolvedSize, elapsedMs, snapshot: blended, envelope: target.envelope, pulsePeriod: target.pulsePeriod });
    };

    if (reducedMotion) {
      // Legal reduced-motion fallback: one static frame per state, states
      // distinguished by waveform shape/opacity only — no continuous loop.
      const staticParams = getOrbMotionParams(state);
      const staticSnapshot: BlendSnapshot = {
        period: staticParams.period,
        amplitudeScale: staticParams.amplitudeScale,
        rotationSpeed: 0,
        bobPx: 0,
      };
      const frozenPhase = staticParams.envelope === "peak-mid" ? staticParams.period / 2 : staticParams.period * 0.25;
      drawOrbFrame(ctx, {
        size: resolvedSize,
        elapsedMs: frozenPhase,
        snapshot: staticSnapshot,
        envelope: staticParams.envelope,
        pulsePeriod: null,
      });
      return;
    }

    const loop = (now: number) => {
      renderFrame(now);
      rafRef.current = requestAnimationFrame(loop);
    };
    rafRef.current = requestAnimationFrame(loop);

    return () => {
      if (rafRef.current !== null) cancelAnimationFrame(rafRef.current);
      rafRef.current = null;
    };
    // Re-run when the size or reduced-motion preference changes; `state`
    // changes are handled by the transition effect above so this loop keeps
    // running continuously through a state change rather than restarting.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [resolvedSize, reducedMotion, placement]);

  const label = ariaLabel ?? `Taylor — ${STATE_LABEL[state]}`;

  return (
    <span
      role="img"
      aria-label={label}
      className={className}
      data-taylor-orb=""
      data-state={state}
      data-placement={placement}
      data-reduced-motion={reducedMotion ? "true" : "false"}
      style={{ display: "inline-block", width: resolvedSize, height: resolvedSize, lineHeight: 0 }}
    >
      <canvas ref={canvasRef} width={resolvedSize} height={resolvedSize} aria-hidden="true" style={{ width: resolvedSize, height: resolvedSize, display: "block" }} />
    </span>
  );
}
