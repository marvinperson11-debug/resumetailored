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

/** Silence-after-speech-started auto-stop window, ms — env-overridable
 *  (`NEXT_PUBLIC_ASSISTANT_VOICE_SILENCE_MS`, a build-time Next.js env var)
 *  since this value is read in client code. Generous by design: it only
 *  starts counting once the recognizer has actually produced a result (see
 *  `armSilenceTimer`'s call site), never from the moment the mic opens, so
 *  a pause BEFORE speaking (normal for press-and-hold) never gets cut off. */
const DEFAULT_SILENCE_MS = Number(process.env.NEXT_PUBLIC_ASSISTANT_VOICE_SILENCE_MS) || 2000;

export interface UseVoiceInputOptions {
  lang?: string;
  /** Called with the FULL concatenated final transcript for the whole
   *  listening session, once — on stop() (an explicit release/toggle-off)
   *  or on the silence auto-stop, never mid-session and never on every
   *  final segment. Never auto-sent anywhere by this hook — the caller
   *  decides what to do (this product's rule: drop it into the input box
   *  for the employer to review/edit, same as a typed message, never
   *  auto-submit). */
  onFinalTranscript: (text: string) => void;
  /** Override for DEFAULT_SILENCE_MS — exposed so a test can use a tiny
   *  value instead of waiting out the real default. */
  silenceMs?: number;
}

/** Push-to-talk wrapper around SpeechRecognition. The caller decides HOW
 *  it's triggered (press-and-hold on desktop via onMouseDown/onMouseUp, or
 *  tap-to-start/tap-to-stop on touch via onClick calling start() then
 *  stop()) — this hook only exposes start/stop/status, not an input
 *  modality.
 *
 *  `continuous = true`: the recognizer keeps listening across brief pauses
 *  within one session instead of ending itself at the first one — a spoken
 *  message with a natural mid-pause ("Move Joseph to interviews, and also
 *  message Maria about Thursday") used to get cut off there when
 *  `continuous` was false, because the BROWSER's own end-of-speech
 *  detection (not this silence timer) treated that pause as the end of the
 *  utterance. All final segments are accumulated in `finalChunksRef` across
 *  the whole session and delivered as ONE joined string from `onend` — not
 *  per-segment from `onresult` — so a multi-clause message always arrives
 *  as a single complete message, never split into several early sends.
 *
 *  Because `continuous = true` recognizers don't reliably stop themselves,
 *  this hook runs its OWN "N ms of silence after speech has started" timer
 *  (`silenceMs`) as a backstop for tap-to-toggle mode; press-and-hold still
 *  normally ends via the caller's own stop() on release, well before the
 *  timer would fire. */
export function useVoiceInput({ lang, onFinalTranscript, silenceMs = DEFAULT_SILENCE_MS }: UseVoiceInputOptions) {
  const [status, setStatus] = useState<VoiceInputStatus>("idle");
  const [interimTranscript, setInterimTranscript] = useState("");
  const recRef = useRef<SpeechRecognitionLike | null>(null);
  const onFinalRef = useRef(onFinalTranscript);
  onFinalRef.current = onFinalTranscript;
  const finalChunksRef = useRef<string[]>([]);
  const silenceTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const clearSilenceTimer = useCallback(() => {
    if (silenceTimerRef.current) {
      clearTimeout(silenceTimerRef.current);
      silenceTimerRef.current = null;
    }
  }, []);

  const armSilenceTimer = useCallback(() => {
    clearSilenceTimer();
    silenceTimerRef.current = setTimeout(() => {
      recRef.current?.stop();
    }, silenceMs);
  }, [clearSilenceTimer, silenceMs]);

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
    rec.continuous = true;
    rec.interimResults = true;
    finalChunksRef.current = [];
    rec.onresult = (e) => {
      let interimText = "";
      for (let i = e.resultIndex; i < e.results.length; i++) {
        const r = e.results[i] as ArrayLike<{ transcript: string }> & { isFinal: boolean };
        const transcript = r[0]?.transcript || "";
        if (r.isFinal) {
          if (transcript.trim()) finalChunksRef.current.push(transcript.trim());
        } else {
          interimText += transcript;
        }
      }
      setInterimTranscript(interimText);
      // (Re)start the silence window on every result — final or interim —
      // so it always measures silence since the LAST thing the employer
      // said, not since the mic opened.
      armSilenceTimer();
    };
    rec.onerror = (e) => {
      setStatus(e?.error === "not-allowed" || e?.error === "service-not-allowed" ? "denied" : "error");
    };
    rec.onend = () => {
      clearSilenceTimer();
      setStatus((s) => (s === "denied" ? s : "idle"));
      setInterimTranscript("");
      const full = finalChunksRef.current.join(" ").trim();
      finalChunksRef.current = [];
      if (full) onFinalRef.current(full);
    };
    recRef.current = rec;
    try {
      rec.start();
      setStatus("listening");
    } catch {
      setStatus("error");
    }
  }, [status, lang, armSilenceTimer, clearSilenceTimer]);

  const stop = useCallback(() => {
    clearSilenceTimer();
    recRef.current?.stop();
  }, [clearSilenceTimer]);

  useEffect(
    () => () => {
      clearSilenceTimer();
      recRef.current?.stop();
    },
    [clearSilenceTimer]
  );

  return { status, interimTranscript, start, stop };
}
