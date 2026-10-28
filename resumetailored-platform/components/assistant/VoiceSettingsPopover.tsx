"use client";

import { useLayoutEffect, useRef, useState } from "react";
import { useTranslations } from "next-intl";
import { Settings, X } from "lucide-react";
import { Btn, Input } from "@/app/employer/components/ui";
import { VIDEO_VOICES } from "@/lib/video-ai";

/** Below this width the popover gives up anchoring near the trigger
 *  entirely and becomes a fixed bottom sheet (inset-x-4, resting on the
 *  viewport's bottom edge) — the trigger can sit anywhere in the header, so
 *  no anchored position is reliably on-screen at phone widths. Matches the
 *  `max-[…]` arbitrary Tailwind breakpoint used below; keep the two in sync. */
const MOBILE_SHEET_BREAKPOINT = 480;

export interface VoiceSettingsPopoverProps {
  assistantName: string;
  onRenameAssistant: (name: string) => void;
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

/** The voice-picker + rate + assistant-rename popover — per account, synced
 *  across devices (app/api/employer/assistant/persona/route.ts). One popover
 *  for both the "Settings field" rename path and the voice preferences,
 *  rather than two separate surfaces. */
export function VoiceSettingsPopover(props: VoiceSettingsPopoverProps) {
  const t = useTranslations("employerAssistant");
  const [open, setOpen] = useState(false);
  const [nameDraft, setNameDraft] = useState(props.assistantName);
  const [openUpward, setOpenUpward] = useState(false);
  const panelRef = useRef<HTMLDivElement>(null);

  // Flip to opening upward when the panel would clip the viewport bottom —
  // only matters above the mobile-sheet breakpoint, where the panel is still
  // anchored near the trigger rather than pinned to the viewport edge.
  // Re-measured on every open (window height / trigger position can change
  // between opens) rather than cached.
  useLayoutEffect(() => {
    if (!open) return;
    if (typeof window === "undefined" || window.innerWidth <= MOBILE_SHEET_BREAKPOINT) {
      setOpenUpward(false);
      return;
    }
    const el = panelRef.current;
    if (!el) return;
    const rect = el.getBoundingClientRect();
    setOpenUpward(rect.bottom > window.innerHeight);
  }, [open]);

  return (
    <div className="relative">
      <button
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
              dropdown and closing-on-outside-click isn't this component's
              job (it never was before this fix). */}
          <div
            className="fixed inset-0 z-20 hidden max-[480px]:block"
            onClick={() => setOpen(false)}
            aria-hidden="true"
          />
          <div
            ref={panelRef}
            className={[
              "z-30 w-72 space-y-4 rounded-xl border border-border-gold bg-[#15131c] p-4 shadow-xl",
              // Desktop/tablet: anchored dropdown under (or, if it would clip
              // the viewport bottom, above) the trigger — never left of it.
              "absolute right-0",
              openUpward ? "bottom-11" : "top-11",
              // ≤480px: give up anchoring near the trigger — it can sit
              // anywhere in the header — and pin a full-width sheet to the
              // viewport's bottom edge instead, so it's on-screen regardless
              // of where the trigger is.
              "max-[480px]:fixed max-[480px]:inset-x-4 max-[480px]:bottom-4 max-[480px]:top-auto max-[480px]:right-auto max-[480px]:w-auto max-[480px]:max-h-[70vh] max-[480px]:overflow-y-auto",
            ].join(" ")}
          >
            <div className="flex items-center justify-between">
              <h3 className="text-sm font-semibold text-cream">{t("voiceSettingsLabel")}</h3>
              <button type="button" onClick={() => setOpen(false)} aria-label={t("close")} className="text-white/50 hover:text-white">
                <X className="h-4 w-4" aria-hidden="true" />
              </button>
            </div>

            <div className="space-y-1.5">
              <label className="text-xs font-medium text-white/60">{t("assistantNameLabel")}</label>
              <div className="flex gap-2">
                <Input
                  value={nameDraft}
                  onChange={(e) => setNameDraft(e.target.value)}
                  maxLength={40}
                  placeholder={t("assistantNamePlaceholder")}
                />
                <Btn
                  variant="ghost"
                  onClick={() => {
                    const trimmed = nameDraft.trim();
                    if (trimmed) props.onRenameAssistant(trimmed);
                  }}
                  disabled={!nameDraft.trim() || nameDraft.trim() === props.assistantName}
                >
                  {t("save")}
                </Btn>
              </div>
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
        </>
      )}
    </div>
  );
}
