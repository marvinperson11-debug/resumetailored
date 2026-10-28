/**
 * Voice Mode (Prompt 7) capability detection — pure functions, no React, so
 * they're directly testable from scripts/test-employer-assistant.cjs (which
 * runs in plain Node, not a browser/jsdom). Every function takes its
 * "window-like" input as an optional argument that defaults to the real
 * global when one exists, so a browser component can call them with no
 * arguments while a test can pass a fake shape.
 *
 * The mic button in the chat input renders ONLY where
 * `isVoiceInputSupported()` is true (Marvin's locked decision) — there is
 * no "mic button that shows an error on tap"; unsupported browsers (notably
 * iOS Safari, which has no SpeechRecognition) get the keyboard-mic-dictation
 * hint instead (see assistant-client.tsx), never a broken button.
 */

export interface VoiceWindowLike {
  isSecureContext?: boolean;
  SpeechRecognition?: unknown;
  webkitSpeechRecognition?: unknown;
  speechSynthesis?: unknown;
  matchMedia?: (query: string) => { matches: boolean };
}

function realWindow(): VoiceWindowLike | undefined {
  return typeof window !== "undefined" ? (window as unknown as VoiceWindowLike) : undefined;
}

/** Web Speech API SpeechRecognition, over HTTPS (or localhost, which the
 *  browser also treats as a secure context) — Safari/iOS has no
 *  SpeechRecognition at all, which is exactly the case the keyboard-mic
 *  fallback hint exists for. */
export function isVoiceInputSupported(win: VoiceWindowLike | undefined = realWindow()): boolean {
  if (!win) return false;
  if (win.isSecureContext === false) return false;
  return !!(win.SpeechRecognition || win.webkitSpeechRecognition);
}

/** speechSynthesis — separately checked from input support, since a browser
 *  can in principle have one without the other. */
export function isVoiceOutputSupported(win: VoiceWindowLike | undefined = realWindow()): boolean {
  if (!win) return false;
  return !!win.speechSynthesis;
}

/** Touch/coarse-pointer devices get tap-to-start/tap-to-stop instead of
 *  press-and-hold — holding a button down is a two-handed gesture on a
 *  phone (one hand holding the phone, one holding the button), which is
 *  unusable one-handed. Desktop (fine pointer, mouse/trackpad) keeps
 *  press-and-hold. */
export function isCoarsePointer(win: VoiceWindowLike | undefined = realWindow()): boolean {
  if (!win || typeof win.matchMedia !== "function") return false;
  try {
    return !!win.matchMedia("(pointer: coarse)").matches;
  } catch {
    return false;
  }
}
