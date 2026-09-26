"use client";

import { useState } from "react";
import { Download, X, Share, Plus } from "lucide-react";
import { usePWA } from "./pwa-context";

/**
 * The one "Install app" affordance, reused everywhere (sign-in/up, and the
 * candidate/employer/employee shells via ProfileButton). Renders nothing once
 * already installed. On Chrome/Android it fires the captured native prompt;
 * on iOS Safari (no programmatic prompt exists) or any other browser without
 * a captured prompt yet, it shows a one-time-per-open instructional card
 * instead of failing silently.
 */
export function InstallAppButton({ className, label = "Install app" }: { className?: string; label?: string }) {
  const { canInstall, isIOS, isStandalone, promptInstall } = usePWA();
  const [showHelp, setShowHelp] = useState(false);

  if (isStandalone) return null;

  async function handleClick() {
    if (canInstall) {
      await promptInstall();
      return;
    }
    setShowHelp(true);
  }

  return (
    <>
      <button type="button" onClick={handleClick} className={className}>
        <Download className="h-4 w-4" /> {label}
      </button>
      {showHelp && <InstallHelpCard isIOS={isIOS} onClose={() => setShowHelp(false)} />}
    </>
  );
}

export function InstallHelpCard({ isIOS, onClose }: { isIOS: boolean; onClose: () => void }) {
  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center bg-navy/70 p-4 backdrop-blur-sm" onClick={onClose}>
      <div
        onClick={(e) => e.stopPropagation()}
        className="w-full max-w-sm rounded-2xl border border-border-gold bg-navy p-6 text-center shadow-2xl"
      >
        <div className="mb-3 flex justify-end">
          <button type="button" onClick={onClose} aria-label="Close" className="text-muted-cream hover:text-cream">
            <X className="h-5 w-5" />
          </button>
        </div>
        <div className="mx-auto mb-4 flex h-14 w-14 items-center justify-center rounded-2xl bg-gold/15">
          <Download className="h-7 w-7 text-gold" />
        </div>
        {isIOS ? (
          <>
            <h3 className="font-serif text-lg font-medium text-cream">Add to Home Screen</h3>
            <p className="mt-2 text-sm text-white/65">
              Tap <Share className="mb-0.5 inline h-4 w-4" /> <strong>Share</strong> in Safari&rsquo;s toolbar, then scroll down and choose{" "}
              <strong>Add to Home Screen</strong>.
            </p>
          </>
        ) : (
          <>
            <h3 className="font-serif text-lg font-medium text-cream">Install ResumeTailored</h3>
            <p className="mt-2 text-sm text-white/65">
              Open your browser&rsquo;s menu and look for <strong>Install app</strong> or <Plus className="mb-0.5 inline h-4 w-4" />{" "}
              <strong>Add to Home Screen</strong>.
            </p>
          </>
        )}
        <button
          type="button"
          onClick={onClose}
          className="mt-5 inline-flex items-center justify-center rounded-lg bg-violet px-4 py-2 text-sm font-semibold text-white transition hover:bg-violet/90"
        >
          Got it
        </button>
      </div>
    </div>
  );
}
