"use client";

import { useEffect, useState } from "react";
import { useTranslations } from "next-intl";
import { Loader2 } from "lucide-react";
import { Panel, PageHeader } from "../components/ui";
import { ATTRIBUTION_CHANNELS, type AttributionReport } from "@/lib/attribution-report";

/**
 * "Applicants by channel" (Combined Build, Section 3) — the distribution
 * reporting piece deliberately deferred when Job Distribution itself
 * shipped. Scale+ and behind ATTRIBUTION_REPORT_ENABLED
 * (lib/employer-plan.ts `canUseAttributionReport`); the route answers
 * `{ allowed: false }` for anyone below the gate, rendered here as a
 * graduation-shaped locked state rather than an error page, same
 * "every page stays reachable" convention as the Free-tier gates.
 */
export function AttributionClient({ jobId }: { jobId?: number }) {
  const t = useTranslations("employerAttribution");
  const [state, setState] = useState<{ loading: boolean; allowed: boolean; report: AttributionReport | null }>({ loading: true, allowed: false, report: null });

  useEffect(() => {
    const url = jobId ? `/api/employer/attribution?jobId=${jobId}` : "/api/employer/attribution";
    fetch(url, { cache: "no-store" })
      .then((r) => r.json())
      .then((d: { allowed?: boolean; report?: AttributionReport }) => setState({ loading: false, allowed: !!d.allowed, report: d.report || null }))
      .catch(() => setState({ loading: false, allowed: false, report: null }));
  }, [jobId]);

  return (
    <div className="space-y-5">
      <PageHeader title={t("title")} subtitle={t("subtitle")} />
      {state.loading ? (
        <Panel className="flex items-center gap-2 text-sm text-white/50"><Loader2 className="h-4 w-4 animate-spin" /> {t("loading")}</Panel>
      ) : !state.allowed ? (
        <Panel className="text-sm text-white/60">{t("locked")}</Panel>
      ) : (
        <>
          <Panel>
            <div className="mb-3 text-xs font-semibold uppercase tracking-wide text-white/60">{t("aggregateTitle")}</div>
            <ChannelCounts counts={state.report!.aggregate} t={t} />
          </Panel>
          {state.report!.byJob.map((job) => (
            <Panel key={job.jobId}>
              <div className="mb-3 text-sm font-semibold text-cream">{job.jobTitle}</div>
              <ChannelCounts counts={job.counts} t={t} />
            </Panel>
          ))}
        </>
      )}
    </div>
  );
}

function ChannelCounts({ counts, t }: { counts: AttributionReport["aggregate"]; t: ReturnType<typeof useTranslations> }) {
  return (
    <div className="grid grid-cols-2 gap-3 sm:grid-cols-5">
      {ATTRIBUTION_CHANNELS.map((channel) => (
        <div key={channel} className="rounded-lg border border-border-gold bg-white/[0.03] p-3 text-center">
          <div className="text-lg font-semibold text-cream">{counts.byChannel[channel]}</div>
          <div className="mt-0.5 text-[11px] text-white/50">{t(`channel.${channel}`)}</div>
        </div>
      ))}
      <div className="rounded-lg border border-border-gold bg-white/[0.03] p-3 text-center">
        <div className="text-lg font-semibold text-cream">{counts.direct}</div>
        <div className="mt-0.5 text-[11px] text-white/50">{t("channel.direct")}</div>
      </div>
    </div>
  );
}
