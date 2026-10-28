"use client";

import { useCallback, useEffect, useRef, useState } from "react";

export type VoiceInputStatus = "idle" | "listening" | "denied" | "error";

/** Minimal shape of the Web Speech API's SpeechRecognition — not in
 *  lib.dom.d.ts in every TS config this repo targets, so declared locally
 *  rather than widening a global. */
interface SpeechRecognitionLike {
  lang: string;
  continuous: boolean;
  interimResults: boolean;
  start(): void;
  stop(): void;
  onresult: ((e: SpeechRecognitionEventLike) => void) | null;
  onerror: ((e: { error?: string }) => void) | null;
  onend: (() => void) | null;
}
interface SpeechRecognitionEventLike {
  resultIndex: number;
  results: ArrayLike<ArrayLike<{ transcript: string }> & { isFinal: boolean }>;
}

export interface UseVoiceInputOptions {
  lang?: string;
  /** Called with the FINAL transcript segment once recognition settles on
   *  it. Never auto-sent anywhere by this hook — the caller decides what to
   *  do (this product's rule: drop it into the input box for the employer
   *  to review/edit, same as a typed message, never auto-submit — "low-
   *  confidence transcript shown for edit before sending" generalizes
   *  cleanly to "every transcript is reviewable before sending", since
   *  confidence scores aren't reliably available across browsers). */
  onFinalTranscript: (text: string) => void;
}

/** Push-to-talk wrapper around SpeechRecognition. The caller decides HOW it's
 *  triggered (press-and-hold on desktop via onMouseDown/onMouseUp, or
 *  tap-to-start/tap-to-stop on touch via onClick calling start() then
 *  stop()) — this hook only exposes start/stop/status, not an input
 *  modality. Auto-stops on silence: `continuous = false` makes the browser
 *  end recognition itself once it detects the end of speech, which is the
 *  "auto-stop on silence" behavior — no custom VAD needed. */
export function useVoiceInput({ lang, onFinalTranscript }: UseVoiceInputOptions) {
  const [status, setStatus] = useState<VoiceInputStatus>("idle");
  const [interimTranscript, setInterimTranscript] = useState("");
  const recRef = useRef<SpeechRecognitionLike | null>(null);
  const onFinalRef = useRef(onFinalTranscript);
  onFinalRef.current = onFinalTranscript;

  const start = useCallback(() => {
    if (status === "listening") return;
    const w = window as unknown as {
      SpeechRecognition?: new () => SpeechRecognitionLike;
      webkitSpeechRecognition?: new () => SpeechRecognitionLike;
    };
    const Ctor = w.SpeechRecognition || w.webkitSpeechRecognition;
    if (!Ctor) {
      setStatus("error");
      return;
    }
    const rec = new Ctor();
    // No hard-coded locale fallback: `lang` is the caller's own locale
    // (app locale -> BCP-47 speech tag, resolved via useLocale()), and
    // `navigator.language` is the browser's own — if neither is available
    // the browser picks its own default rather than this hook assuming
    // English.
    if (lang) rec.lang = lang;
    else if (navigator.language) rec.lang = navigator.language;
    rec.continuous = false;
    rec.interimResults = true;
    rec.onresult = (e) => {
      let finalText = "";
      let interimText = "";
      for (let i = e.resultIndex; i < e.results.length; i++) {
        const r = e.results[i] as ArrayLike<{ transcript: string }> & { isFinal: boolean };
        const transcript = r[0]?.transcript || "";
        if (r.isFinal) finalText += transcript;
        else interimText += transcript;
      }
      if (interimText) setInterimTranscript(interimText);
      if (finalText.trim()) onFinalRef.current(finalText.trim());
    };
    rec.onerror = (e) => {
      setStatus(e?.error === "not-allowed" || e?.error === "service-not-allowed" ? "denied" : "error");
    };
    rec.onend = () => {
      setStatus((s) => (s === "denied" ? s : "idle"));
      setInterimTranscript("");
    };
    recRef.current = rec;
    try {
      rec.start();
      setStatus("listening");
    } catch {
      setStatus("error");
    }
  }, [status, lang]);

  const stop = useCallback(() => {
    recRef.current?.stop();
  }, []);

  useEffect(
    () => () => {
      recRef.current?.stop();
    },
    []
  );

  return { status, interimTranscript, start, stop };
}
