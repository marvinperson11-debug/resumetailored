"use client";

import { useCallback, useEffect, useLayoutEffect, useRef, useState, type CSSProperties, type RefObject } from "react";
import { useTranslations } from "next-intl";
import { Settings, X } from "lucide-react";
import { VIDEO_VOICES } from "@/lib/video-ai";
import {
  MOBILE_SHEET_BREAKPOINT,
  PANEL_GUTTER,
  computePopoverPosition,
  isMobileSheetWidth,
  type PopoverPosition,
} from "./voice-settings-position";

export interface VoiceSettingsPopoverProps {
  /** An ElevenLabs voice KEY from lib/video-ai.ts VIDEO_VOICES (e.g.
   *  "rachel") — the same catalog the Resume Video feature offers, not a
   *  browser SpeechSynthesis voiceURI. Persisted in the same
   *  assistant_persona.tts_voice column either way: an old, pre-ElevenLabs
   *  value (a voiceURI) simply won't match any VIDEO_VOICES key and falls
   *  back to the default voice server-side (lib/assistant-tts.ts
   *  `generateAssistantTts`) — no migration of old values needed. */
  ttsVoice: string | null;
  ttsRate: number | null;
  onChangeVoice: (voiceKey: string | null) => void;
  onChangeRate: (rate: number) => void;
  muted: boolean;
  onToggleMute: () => void;
}

function getViewportSize(): { width: number; height: number } {
  if (typeof window === "undefined") return { width: 0, height: 0 };
  // visualViewport is the real on-screen area on mobile — window.innerWidth/
  // innerHeight (the layout viewport) can disagree with it while the
  // browser's toolbar is collapsing/expanding or the keyboard is open, which
  // is exactly the kind of real-device-only drift the previous fix never
  // accounted for.
  const vv = window.visualViewport;
  return {
    width: vv?.width ?? window.innerWidth,
    height: vv?.height ?? window.innerHeight,
  };
}

/** Single source of truth for the mobile-sheet breakpoint: one live
 *  matchMedia subscription. Round 2 split this across a `window.innerWidth`
 *  snapshot (recomputed only when the popover opened) AND a parallel
 *  Tailwind `max-[480px]:` media query (always live) — two sources that can
 *  disagree. Everything here — the sheet/popover branch, the inline styles,
 *  the debug overlay — now reads this one value instead. */
function useIsMobileSheet(): boolean {
  const [isMobile, setIsMobile] = useState(() =>
    typeof window === "undefined" ? false : isMobileSheetWidth(window.innerWidth),
  );
  useEffect(() => {
    const mq = window.matchMedia(`(max-width: ${MOBILE_SHEET_BREAKPOINT}px)`);
    const update = () => setIsMobile(mq.matches);
    update();
    mq.addEventListener("change", update);
    return () => mq.removeEventListener("change", update);
  }, []);
  return isMobile;
}

function useIsPanelDebug(): boolean {
  const [on, setOn] = useState(false);
  useEffect(() => {
    setOn(new URLSearchParams(window.location.search).get("paneldebug") === "1");
  }, []);
  return on;
}

/** The voice-picker + rate popover — per account, synced across devices
 *  (app/api/employer/assistant/persona/route.ts). Taylor's name is
 *  immutable (Combined Build v5, Section A), so this no longer offers a
 *  rename field — voice preferences only.
 *
 *  Positioning (Round 3): computed fresh on every open, resize,
 *  orientationchange and scroll from the trigger's real
 *  `getBoundingClientRect()` and the real viewport size — flip + shift +
 *  clamp, floating-ui-shaped but dependency-free (see
 *  voice-settings-position.ts for why Round 2's CSS-only `right-0` anchor
 *  broke). Anchored with `position: fixed` (viewport-relative coordinates),
 *  not `absolute` off an in-flow wrapper, so no ancestor's layout can
 *  silently offset it. */
export function VoiceSettingsPopover(props: VoiceSettingsPopoverProps) {
  const t = useTranslations("employerAssistant");
  const [open, setOpen] = useState(false);
  const [position, setPosition] = useState<PopoverPosition | null>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const isMobileSheet = useIsMobileSheet();
  const panelDebug = useIsPanelDebug();

  const recompute = useCallback(() => {
    if (isMobileSheet) {
      // The mobile sheet is positioned entirely by CSS (fixed to the
      // viewport edges), so there's nothing to compute here.
      setPosition(null);
      return;
    }
    const trigger = triggerRef.current;
    const panel = panelRef.current;
    if (!trigger || !panel) return;
    const triggerRect = trigger.getBoundingClientRect();
    const panelRect = panel.getBoundingClientRect();
    const { width: viewportWidth, height: viewportHeight } = getViewportSize();
    setPosition(
      computePopoverPosition(triggerRect, panelRect.width, panelRect.height, viewportWidth, viewportHeight, PANEL_GUTTER),
    );
  }, [isMobileSheet]);

  // Re-measure synchronously before paint whenever the panel opens, the
  // breakpoint flips, or its content changes height (voice list, mute row).
  useLayoutEffect(() => {
    if (!open) return;
    recompute();
  }, [open, recompute]);

  // autoUpdate-equivalent: keep the position correct for as long as the
  // panel stays open, instead of computing it once on open and leaving it
  // stale (Round 2's bug) through a resize, a rotation, or a scroll.
  useEffect(() => {
    if (!open) return;
    const onChange = () => recompute();
    window.addEventListener("resize", onChange);
    window.addEventListener("orientationchange", onChange);
    window.addEventListener("scroll", onChange, { passive: true, capture: true });
    window.visualViewport?.addEventListener("resize", onChange);
    window.visualViewport?.addEventListener("scroll", onChange);
    return () => {
      window.removeEventListener("resize", onChange);
      window.removeEventListener("orientationchange", onChange);
      window.removeEventListener("scroll", onChange, { capture: true });
      window.visualViewport?.removeEventListener("resize", onChange);
      window.visualViewport?.removeEventListener("scroll", onChange);
    };
  }, [open, recompute]);

  const mobileSheetStyle: CSSProperties = {
    position: "fixed",
    left: "max(8px, env(safe-area-inset-left))",
    right: "max(8px, env(safe-area-inset-right))",
    bottom: "calc(8px + env(safe-area-inset-bottom))",
    top: "auto",
    width: "auto",
    maxWidth: "calc(100vw - 16px)",
    maxHeight: "calc(100dvh - 16px - env(safe-area-inset-top))",
    overflowY: "auto",
  };

  const popoverStyle: CSSProperties = position
    ? {
        position: "fixed",
        top: `${position.top}px`,
        left: `${position.left}px`,
        right: "auto",
        bottom: "auto",
        width: "18rem",
        maxWidth: `min(18rem, calc(100vw - ${PANEL_GUTTER * 2}px))`,
        maxHeight: `calc(100dvh - ${PANEL_GUTTER * 2}px)`,
        overflowY: "auto",
        visibility: "visible",
      }
    : {
        // First paint before the layout effect measures the real rect —
        // invisible rather than flashing at the browser's default (0,0).
        position: "fixed",
        top: 0,
        left: 0,
        visibility: "hidden",
      };

  return (
    <div className="relative">
      <button
        ref={triggerRef}
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-label={t("voiceSettingsLabel")}
        aria-expanded={open}
        className="flex h-9 w-9 items-center justify-center rounded-lg border border-border-gold bg-white/[0.03] text-white/70 transition-colors hover:bg-white/[0.08]"
      >
        <Settings className="h-4 w-4" aria-hidden="true" />
      </button>
      {open && (
        <>
          {/* Mobile-only backdrop so a tap outside the bottom sheet closes it,
              same as every other overlay in this app (Modal/Drawer). Absent
              above the breakpoint, where the panel is a plain anchored
              popover and closing-on-outside-click isn't this component's
              job (it never was before this fix). */}
          {isMobileSheet && (
            <div className="fixed inset-0 z-20" onClick={() => setOpen(false)} aria-hidden="true" />
          )}
          <div
            ref={panelRef}
            style={isMobileSheet ? mobileSheetStyle : popoverStyle}
            className="z-30 w-72 space-y-4 rounded-xl border border-border-gold bg-[#15131c] p-4 shadow-xl"
          >
            <div className="flex items-center justify-between">
              <h3 className="text-sm font-semibold text-cream">{t("voiceSettingsLabel")}</h3>
              <button type="button" onClick={() => setOpen(false)} aria-label={t("close")} className="text-white/50 hover:text-white">
                <X className="h-4 w-4" aria-hidden="true" />
              </button>
            </div>

            <div className="space-y-1.5">
              <label className="text-xs font-medium text-white/60">{t("voicePickerLabel")}</label>
              <select
                value={props.ttsVoice || ""}
                onChange={(e) => props.onChangeVoice(e.target.value || null)}
                className="w-full rounded-lg border border-border-gold bg-white/5 px-3 py-2 text-sm text-cream outline-none focus:border-violet"
              >
                <option value="">{t("voiceDefault")}</option>
                {VIDEO_VOICES.map((v) => (
                  <option key={v.key} value={v.key}>
                    {v.label}
                  </option>
                ))}
              </select>
            </div>

            <div className="space-y-1.5">
              <label className="text-xs font-medium text-white/60">
                {t("rateLabel")} — {(props.ttsRate ?? 1).toFixed(2)}x
              </label>
              <input
                type="range"
                min={0.5}
                max={2}
                step={0.05}
                value={props.ttsRate ?? 1}
                onChange={(e) => props.onChangeRate(Number(e.target.value))}
                className="w-full accent-violet"
              />
            </div>

            <label className="flex items-center justify-between text-sm text-cream">
              {t("muteLabel")}
              <input type="checkbox" checked={props.muted} onChange={props.onToggleMute} className="h-4 w-4" />
            </label>
          </div>
          {panelDebug && <PanelDebugOverlay panelRef={panelRef} isMobileSheet={isMobileSheet} />}
        </>
      )}
    </div>
  );
}

/** Real-device verification aid, behind `?paneldebug=1` (inert otherwise —
 *  safe to ship). Shows the exact numbers a bug report needs: the layout
 *  vs. visual viewport width (the two can disagree on a real phone even
 *  though they never do in a desktop devtools emulator), orientation, and
 *  the panel's live bounding rect. */
function PanelDebugOverlay({ panelRef, isMobileSheet }: { panelRef: RefObject<HTMLDivElement>; isMobileSheet: boolean }) {
  const [snapshot, setSnapshot] = useState(() => readDebugSnapshot(panelRef.current));

  useEffect(() => {
    let raf = 0;
    const tick = () => {
      setSnapshot(readDebugSnapshot(panelRef.current));
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [panelRef]);

  return (
    <div className="fixed left-2 top-2 z-[9999] space-y-0.5 rounded-md bg-black/80 p-2 font-mono text-[10px] leading-tight text-lime-300">
      <div>mode: {isMobileSheet ? "sheet" : "popover"}</div>
      <div>innerWidth: {snapshot.innerWidth}</div>
      <div>visualViewport.width: {snapshot.vvWidth ?? "n/a"}</div>
      <div>orientation: {snapshot.orientation}</div>
      <div>panel rect: {snapshot.rect}</div>
    </div>
  );
}

function readDebugSnapshot(panel: HTMLDivElement | null) {
  const rect = panel?.getBoundingClientRect();
  return {
    innerWidth: window.innerWidth,
    vvWidth: window.visualViewport?.width,
    orientation: window.screen?.orientation?.type ?? (window.innerWidth > window.innerHeight ? "landscape" : "portrait"),
    rect: rect ? `L${Math.round(rect.left)} T${Math.round(rect.top)} W${Math.round(rect.width)} H${Math.round(rect.height)}` : "n/a",
  };
}
