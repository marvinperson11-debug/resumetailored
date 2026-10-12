"use client";

import { useTranslations } from "next-intl";
import { X } from "lucide-react";

/**
 * The subtle "Draft restored" strip shown above a form that was just refilled from its autosaved
 * draft (lib/draft-stash.ts). Dismissible; "Discard draft" is the explicit way to throw it away —
 * the caller clears the form and the stash.
 */
export function DraftRestoredNotice({ onDiscard, onDismiss }: { onDiscard: () => void; onDismiss: () => void }) {
  const t = useTranslations("draftRestore");
  return (
    <div role="status" data-draft-restored className="mb-3 flex flex-wrap items-center gap-x-3 gap-y-1 rounded-lg border border-white/10 bg-white/5 px-3 py-2 text-xs text-white/70">
      <span className="min-w-0 flex-1">{t("restored")}</span>
      <button type="button" data-draft-discard onClick={onDiscard} className="font-medium text-white/80 underline underline-offset-2 hover:text-white">
        {t("discard")}
      </button>
      <button type="button" aria-label={t("dismiss")} data-draft-dismiss onClick={onDismiss} className="rounded p-0.5 text-white/50 hover:text-white">
        <X className="h-3.5 w-3.5" />
      </button>
    </div>
  );
}
