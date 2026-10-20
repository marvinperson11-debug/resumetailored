"use client";

import { useTranslations } from "next-intl";
import { AlertTriangle, CheckCircle2, XCircle } from "lucide-react";
import { cn } from "@/lib/utils";

/**
 * The ONE confirmation card every mutating Assistant tool will reuse — see
 * docs/assistant-confirmation-card.md for the full spec this implements.
 * Ships unused by any tool in this phase (there are no mutating tools yet);
 * see app/employer/assistant/card-demo/page.tsx for a dev-only render of
 * sample data.
 */
export type ActionCardState = "pending" | "approved-executed" | "failed";

export interface ResolvedSpecific {
  /** e.g. "Job", "From", "To", "Ranked by". */
  label: string;
  value: string;
}

export interface ActionCardItem {
  id: string;
  /** Short per-item label inside a batch (e.g. a candidate's name). Omit for
   *  a single-item card. */
  label?: string;
  /** The real final artifact — actual job post text, actual message body,
   *  actual candidate name/stage change. Never a paraphrase. */
  artifact: string;
}

export interface ActionCardProps {
  title: string;
  irreversible: boolean;
  /** Tool-specific wording for the irreversible warning; falls back to a
   *  generic label when omitted. */
  irreversibleLabel?: string;
  resolvedSpecifics?: ResolvedSpecific[];
  items: ActionCardItem[];
  state: ActionCardState;
  /** Required (and shown) only when state === "failed". */
  failureReason?: string;
  onApprove?: () => void;
  onCancel?: () => void;
  className?: string;
}

export function ActionCard({
  title,
  irreversible,
  irreversibleLabel,
  resolvedSpecifics = [],
  items,
  state,
  failureReason,
  onApprove,
  onCancel,
  className,
}: ActionCardProps) {
  const t = useTranslations("assistantActionCard");
  return (
    <div className={cn("rounded-xl border border-border-gold bg-white/[0.04] p-4", className)}>
      <div className="flex items-start justify-between gap-3">
        <h3 className="font-serif text-base font-medium text-cream">{title}</h3>
        <StateBadge state={state} />
      </div>

      {resolvedSpecifics.length > 0 && (
        <dl className="mt-3 flex flex-wrap gap-x-5 gap-y-1.5 text-xs">
          {resolvedSpecifics.map((r, i) => (
            <div key={i} className="flex items-baseline gap-1.5">
              <dt className="font-semibold uppercase tracking-wide text-white/45">{r.label}</dt>
              <dd className="text-cream">{r.value}</dd>
            </div>
          ))}
        </dl>
      )}

      <div className="mt-3 space-y-2">
        {items.map((item) => (
          <div key={item.id} className="rounded-lg border border-border-gold/60 bg-navy/40 p-3">
            {item.label && <p className="mb-1 text-xs font-semibold text-white/55">{item.label}</p>}
            <p className="whitespace-pre-wrap text-sm text-cream">{item.artifact}</p>
          </div>
        ))}
      </div>

      {state === "pending" && (
        <div className="mt-3 flex flex-wrap items-center justify-between gap-3 border-t border-border-gold/50 pt-3">
          <p className={cn("flex items-center gap-1.5 text-xs", irreversible ? "text-amber-300" : "text-white/45")}>
            {irreversible && <AlertTriangle className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />}
            {irreversible ? irreversibleLabel || t("irreversibleDefault") : t("undoableNote")}
          </p>
          <div className="flex gap-2">
            <button
              type="button"
              onClick={onCancel}
              className="rounded-lg border border-border-gold bg-white/[0.03] px-3.5 py-1.5 text-xs font-semibold text-cream transition-colors hover:bg-white/[0.08]"
            >
              {t("cancel")}
            </button>
            <button
              type="button"
              onClick={onApprove}
              className="rounded-lg bg-violet px-3.5 py-1.5 text-xs font-semibold text-white transition-colors hover:bg-violet/90"
            >
              {t("approve")}
            </button>
          </div>
        </div>
      )}

      {state === "failed" && (
        <div className="mt-3 flex items-start gap-2 rounded-lg border border-red-500/40 bg-red-500/10 px-3 py-2.5 text-xs text-red-200">
          <XCircle className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden="true" />
          <span>{failureReason || t("genericFailure")}</span>
        </div>
      )}

      {state === "approved-executed" && (
        <div className="mt-3 flex items-center gap-2 rounded-lg border border-emerald-500/30 bg-emerald-500/10 px-3 py-2.5 text-xs text-emerald-200">
          <CheckCircle2 className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
          <span>{t("executed")}</span>
        </div>
      )}
    </div>
  );
}

function StateBadge({ state }: { state: ActionCardState }) {
  const t = useTranslations("assistantActionCard");
  const styles: Record<ActionCardState, string> = {
    pending: "bg-gold/15 text-gold",
    "approved-executed": "bg-emerald-500/15 text-emerald-300",
    failed: "bg-red-500/15 text-red-300",
  };
  const labels: Record<ActionCardState, string> = {
    pending: t("statePending"),
    "approved-executed": t("stateExecuted"),
    failed: t("stateFailed"),
  };
  return <span className={cn("shrink-0 rounded px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide", styles[state])}>{labels[state]}</span>;
}
