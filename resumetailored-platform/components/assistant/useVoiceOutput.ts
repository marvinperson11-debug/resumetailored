"use client";

import { useCallback, useEffect, useState } from "react";

export interface VoiceOutputSettings {
  ttsVoice: string | null;
  ttsRate: number | null;
}

/** speechSynthesis wrapper. Deliberately dumb: `speak()` takes the settings
 *  explicitly on every call rather than holding its own copy, so the caller
 *  (assistant-client.tsx) is the one source of truth for the per-account
 *  settings fetched from /api/employer/assistant/persona — this hook never
 *  persists anything itself.
 *
 *  HARD RULE this hook has no part in: nothing here ever triggers an
 *  approval. It only ever reads `spoken` text back to the employer; see
 *  lib/assistant-voice.ts for where that rule actually lives (there is no
 *  code path from this hook to any approval endpoint — it doesn't import
 *  one). */
export function useVoiceOutput() {
  const [muted, setMuted] = useState(false);
  const [voices, setVoices] = useState<SpeechSynthesisVoice[]>([]);

  useEffect(() => {
    if (typeof window === "undefined" || !window.speechSynthesis) return;
    const load = () => setVoices(window.speechSynthesis.getVoices());
    load();
    window.speechSynthesis.onvoiceschanged = load;
    return () => {
      window.speechSynthesis.onvoiceschanged = null;
    };
  }, []);

  const speak = useCallback(
    (text: string, settings: VoiceOutputSettings) => {
      if (muted || !text || typeof window === "undefined" || !window.speechSynthesis) return;
      window.speechSynthesis.cancel();
      const utter = new SpeechSynthesisUtterance(text);
      if (settings.ttsRate) utter.rate = settings.ttsRate;
      if (settings.ttsVoice) {
        const v = voices.find((x) => x.voiceURI === settings.ttsVoice || x.name === settings.ttsVoice);
        if (v) utter.voice = v;
      }
      window.speechSynthesis.speak(utter);
    },
    [muted, voices]
  );

  const stop = useCallback(() => {
    if (typeof window !== "undefined" && window.speechSynthesis) window.speechSynthesis.cancel();
  }, []);

  return { voices, muted, setMuted, speak, stop };
}
