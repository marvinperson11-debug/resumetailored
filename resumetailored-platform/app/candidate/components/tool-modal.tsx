"use client";

import { X, type LucideIcon } from "lucide-react";
import type { ReactNode } from "react";

/**
 * Centered tool modal shell — dark backdrop, glass card. Header with tool name
 * + close, a scrollable body, and an optional sticky footer for actions.
 * Full-screen on mobile, centered with rounded corners on desktop.
 */
export function ToolModal({
  title,
  icon: Icon,
  onClose,
  footer,
  children,
}: {
  title: string;
  icon?: LucideIcon;
  onClose: () => void;
  footer?: ReactNode;
  children: ReactNode;
}) {
  return (
    <div className="fixed inset-0 z-[80] flex items-stretch justify-center sm:items-center sm:p-4" role="dialog" aria-modal="true" aria-label={title}>
      <div className="absolute inset-0 bg-navy/80 backdrop-blur-sm" onClick={onClose} aria-hidden="true" />
      <div className="relative flex h-full w-full flex-col overflow-hidden border-border-gold bg-navy shadow-2xl sm:h-[min(88vh,900px)] sm:max-w-6xl sm:rounded-2xl sm:border">
        {/* Header */}
        <header className="flex h-14 shrink-0 items-center justify-between border-b border-border-gold bg-white/5 px-4 sm:px-6">
          <div className="flex items-center gap-2.5">
            {Icon && <Icon className="h-5 w-5 text-violet" />}
            <h2 className="font-serif text-lg font-medium text-cream">{title}</h2>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            className="flex h-9 w-9 items-center justify-center rounded-lg text-muted-cream transition-colors hover:bg-white/10 hover:text-cream"
          >
            <X className="h-5 w-5" />
          </button>
        </header>

        {/* Body */}
        <div className="min-h-0 flex-1 overflow-y-auto">{children}</div>

        {/* Footer */}
        {footer && (
          <footer className="flex shrink-0 flex-wrap items-center justify-end gap-3 border-t border-border-gold bg-white/5 px-4 py-3 sm:px-6">
            {footer}
          </footer>
        )}
      </div>
    </div>
  );
}
