"use client";

import { useState } from "react";
import { useTranslations } from "next-intl";
import { Settings, X } from "lucide-react";
import { Btn, Input } from "@/app/employer/components/ui";

export interface VoiceSettingsPopoverProps {
  assistantName: string;
  onRenameAssistant: (name: string) => void;
  voices: SpeechSynthesisVoice[];
  ttsVoice: string | null;
  ttsRate: number | null;
  onChangeVoice: (voiceURI: string | null) => void;
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
        <div className="absolute right-0 top-11 z-20 w-72 space-y-4 rounded-xl border border-border-gold bg-[#15131c] p-4 shadow-xl">
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

          {props.voices.length > 0 && (
            <div className="space-y-1.5">
              <label className="text-xs font-medium text-white/60">{t("voicePickerLabel")}</label>
              <select
                value={props.ttsVoice || ""}
                onChange={(e) => props.onChangeVoice(e.target.value || null)}
                className="w-full rounded-lg border border-border-gold bg-white/5 px-3 py-2 text-sm text-cream outline-none focus:border-violet"
              >
                <option value="">{t("voiceDefault")}</option>
                {props.voices.map((v) => (
                  <option key={v.voiceURI} value={v.voiceURI}>
                    {v.name} ({v.lang})
                  </option>
                ))}
              </select>
            </div>
          )}

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
      )}
    </div>
  );
}
