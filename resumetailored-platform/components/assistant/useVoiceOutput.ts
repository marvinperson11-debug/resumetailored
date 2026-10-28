"use client";

import { useCallback, useEffect, useRef, useState } from "react";

export interface VoiceOutputSettings {
  /** An ElevenLabs voice key (lib/video-ai.ts VIDEO_VOICES), or an old
   *  pre-ElevenLabs SpeechSynthesis voiceURI persisted before this feature
   *  — either way this hook never tries to resolve it against the
   *  browser's own voice list; the device-voice fallback below always uses
   *  whatever the browser considers its default voice, since the two
   *  catalogs don't correspond to each other. */
  ttsVoice: string | null;
  ttsRate: number | null;
}

/**
 * Spoken-reply playback for the Employer Assistant (Voice Fix Round 2,
 * Section B). Tries ElevenLabs first (POST /api/employer/assistant/tts,
 * server-owned key, Scale tier — same gate as this hook's only caller) and
 * falls back to the browser's own `speechSynthesis` — INVISIBLY, with no
 * error surfaced to the employer — whenever ElevenLabs isn't configured,
 * errors, or the account is over its monthly character cap. The rate
 * slider applies as `audio.playbackRate` for ElevenLabs audio (ElevenLabs
 * itself has no rate parameter) and as `utterance.rate` for the
 * speechSynthesis fallback.
 *
 * HARD RULE this hook has no part in: nothing here ever triggers an
 * approval. It only ever reads `spoken` text back to the employer; see
 * lib/assistant-voice.ts for where that rule actually lives (there is no
 * code path from this hook to any approval endpoint — it doesn't import
 * one).
 */
export function useVoiceOutput() {
  const [muted, setMuted] = useState(false);
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const currentUrlRef = useRef<string | null>(null);
  const requestIdRef = useRef(0);

  useEffect(() => {
    if (typeof window === "undefined") return;
    audioRef.current = new Audio();
    return () => {
      audioRef.current?.pause();
      if (currentUrlRef.current) URL.revokeObjectURL(currentUrlRef.current);
    };
  }, []);

  const speakWithDeviceVoice = useCallback((text: string, rate: number | null) => {
    if (typeof window === "undefined" || !window.speechSynthesis) return;
    window.speechSynthesis.cancel();
    const utter = new SpeechSynthesisUtterance(text);
    if (rate) utter.rate = rate;
    window.speechSynthesis.speak(utter);
  }, []);

  const speak = useCallback(
    (text: string, settings: VoiceOutputSettings) => {
      if (muted || !text || typeof window === "undefined") return;
      window.speechSynthesis?.cancel();
      if (audioRef.current) {
        audioRef.current.pause();
        audioRef.current.src = "";
      }
      if (currentUrlRef.current) {
        URL.revokeObjectURL(currentUrlRef.current);
        currentUrlRef.current = null;
      }

      // Guards against an in-flight request's response landing after a
      // newer `speak()` call (or a `stop()`) — only the LATEST request may
      // still act once its fetch resolves.
      const requestId = ++requestIdRef.current;

      void (async () => {
        try {
          const res = await fetch("/api/employer/assistant/tts", {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({ text, voice: settings.ttsVoice }),
          });
          if (requestId !== requestIdRef.current) return; // superseded while in flight
          if (!res.ok) {
            speakWithDeviceVoice(text, settings.ttsRate);
            return;
          }
          const buf = await res.arrayBuffer();
          if (requestId !== requestIdRef.current) return;
          const url = URL.createObjectURL(new Blob([buf], { type: "audio/mpeg" }));
          currentUrlRef.current = url;
          const audio = audioRef.current;
          if (!audio) return;
          audio.src = url;
          audio.playbackRate = settings.ttsRate || 1;
          await audio.play().catch(() => {
            if (requestId === requestIdRef.current) speakWithDeviceVoice(text, settings.ttsRate);
          });
        } catch {
          if (requestId === requestIdRef.current) speakWithDeviceVoice(text, settings.ttsRate);
        }
      })();
    },
    [muted, speakWithDeviceVoice]
  );

  const stop = useCallback(() => {
    requestIdRef.current++; // invalidate any in-flight fetch's response
    if (typeof window !== "undefined") window.speechSynthesis?.cancel();
    audioRef.current?.pause();
  }, []);

  return { muted, setMuted, speak, stop };
}
