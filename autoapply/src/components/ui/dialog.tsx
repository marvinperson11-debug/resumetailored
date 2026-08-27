"use client";

import * as React from "react";
import { cn } from "@/lib/utils";

// Lightweight modal (no Radix dependency) — enough for the Add Job / Prepare
// drawers. Closes on backdrop click and Escape.
export function Dialog({
  open,
  onClose,
  children,
  className,
}: {
  open: boolean;
  onClose: () => void;
  children: React.ReactNode;
  className?: string;
}) {
  React.useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    document.addEventListener("keydown", onKey);
    document.body.style.overflow = "hidden";
    return () => {
      document.removeEventListener("keydown", onKey);
      document.body.style.overflow = "";
    };
  }, [open, onClose]);

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-black/50 p-4 sm:p-8">
      <div className="absolute inset-0" onClick={onClose} aria-hidden />
      <div
        role="dialog"
        aria-modal="true"
        className={cn("relative z-10 w-full max-w-lg rounded-xl border bg-card p-6 shadow-xl", className)}
      >
        {children}
      </div>
    </div>
  );
}
