"use client";

import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from "react";

/** The non-standard event Chrome/Android fire instead of installing
 *  immediately — TypeScript's DOM lib doesn't define it. */
interface BeforeInstallPromptEvent extends Event {
  prompt(): Promise<void>;
  userChoice: Promise<{ outcome: "accepted" | "dismissed" }>;
}

interface PWAContextValue {
  /** Chrome/Android has a captured native prompt ready to fire. */
  canInstall: boolean;
  /** iOS Safari — no programmatic prompt exists; the caller should show the
   *  "Tap Share → Add to Home Screen" helper instead. */
  isIOS: boolean;
  /** Already running as an installed app (standalone display mode). */
  isStandalone: boolean;
  /** Fire the captured native prompt. No-ops (returns false) when there's
   *  nothing captured — callers should check `canInstall` first, or fall
   *  back to the iOS helper. */
  promptInstall: () => Promise<boolean>;
}

const PWAContext = createContext<PWAContextValue>({
  canInstall: false,
  isIOS: false,
  isStandalone: false,
  promptInstall: async () => false,
});

export function usePWA(): PWAContextValue {
  return useContext(PWAContext);
}

function detectIOS(): boolean {
  if (typeof navigator === "undefined") return false;
  const ua = navigator.userAgent;
  const isIOSDevice = /iPad|iPhone|iPod/.test(ua) || (ua.includes("Macintosh") && navigator.maxTouchPoints > 1);
  const isSafari = /Safari/.test(ua) && !/CriOS|FxiOS|EdgiOS/.test(ua);
  return isIOSDevice && isSafari;
}

function detectStandalone(): boolean {
  if (typeof window === "undefined") return false;
  return window.matchMedia?.("(display-mode: standalone)").matches || (navigator as unknown as { standalone?: boolean }).standalone === true;
}

/**
 * Mounted once in the root layout. Registers the service worker, captures
 * Chrome/Android's `beforeinstallprompt` (which fires at most once per page
 * load and must be preventDefault()'d immediately or the native mini-infobar
 * takes over), and reports a real install via `appinstalled` to the admin
 * telemetry endpoint (feature 4 — best-effort, never blocks anything).
 */
export function PWAProvider({ children }: { children: ReactNode }) {
  const [deferredPrompt, setDeferredPrompt] = useState<BeforeInstallPromptEvent | null>(null);
  const [isIOS, setIsIOS] = useState(false);
  const [isStandalone, setIsStandalone] = useState(false);

  useEffect(() => {
    setIsIOS(detectIOS());
    setIsStandalone(detectStandalone());

    if ("serviceWorker" in navigator) {
      navigator.serviceWorker.register("/sw.js").catch(() => {
        /* best-effort — installability degrades gracefully without it */
      });
    }

    function onBeforeInstallPrompt(e: Event) {
      e.preventDefault();
      setDeferredPrompt(e as BeforeInstallPromptEvent);
    }
    function onAppInstalled() {
      setDeferredPrompt(null);
      setIsStandalone(true);
      fetch("/api/telemetry/install", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ platform: isIOS ? "ios" : "android_or_desktop" }),
      }).catch(() => {
        /* best-effort telemetry — never surfaced to the user */
      });
    }

    window.addEventListener("beforeinstallprompt", onBeforeInstallPrompt);
    window.addEventListener("appinstalled", onAppInstalled);
    return () => {
      window.removeEventListener("beforeinstallprompt", onBeforeInstallPrompt);
      window.removeEventListener("appinstalled", onAppInstalled);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const promptInstall = useCallback(async () => {
    if (!deferredPrompt) return false;
    await deferredPrompt.prompt();
    const { outcome } = await deferredPrompt.userChoice;
    setDeferredPrompt(null);
    return outcome === "accepted";
  }, [deferredPrompt]);

  return (
    <PWAContext.Provider value={{ canInstall: !!deferredPrompt, isIOS, isStandalone, promptInstall }}>{children}</PWAContext.Provider>
  );
}
