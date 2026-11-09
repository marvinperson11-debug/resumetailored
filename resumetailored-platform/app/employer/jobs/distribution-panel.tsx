"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useTranslations } from "next-intl";
import { Loader2 } from "lucide-react";
import type { DistributionChannels } from "@/lib/job-distribution";

const CHANNELS = ["indeedFeed", "zipRecruiter", "linkedin"] as const;
type ChannelKey = (typeof CHANNELS)[number];

interface ChannelsResponse {
  allowed?: boolean;
  channels?: DistributionChannels;
  indeedFeedUrl?: string | null;
  zipRecruiterFeedUrl?: string | null;
  indeedInstructions?: string | null;
  zipRecruiterInstructions?: string | null;
}

/**
 * Per-job distribution channel toggles (Combined Build, Section 5) — the
 * employer's own hands on their own dashboard, distinct from the assistant
 * chat's distribute_job tool (which always goes through a confirmation
 * card). Mounted inside the job edit modal (jobs-client.tsx), only for an
 * EXISTING job (a brand-new, unsaved draft has no job id to attach
 * distribution to yet). Open on every plan (Nov 9 ruling) — the Scale+ gate
 * that used to live here (and in the channels route) is gone, so `allowed`
 * now only ever turns false on a real fetch failure, not a tier lock.
 */
export function DistributionPanel({ jobId }: { jobId: number }) {
  const t = useTranslations("employerJobs");
  const [channels, setChannels] = useState<DistributionChannels | null>(null);
  const [feed, setFeed] = useState<ChannelsResponse | null>(null);
  const [allowed, setAllowed] = useState<boolean | null>(null);
  const [busy, setBusy] = useState<ChannelKey | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    fetch(`/api/employer/jobs/${jobId}/channels`, { cache: "no-store" })
      .then((r) => r.json())
      .then((d: ChannelsResponse) => {
        setAllowed(!!d.allowed);
        setChannels(d.channels || {});
        setFeed(d);
      })
      .catch(() => setAllowed(false));
  }, [jobId]);

  async function toggle(channel: ChannelKey, enabled: boolean) {
    setBusy(channel);
    setError(null);
    try {
      const res = await fetch(`/api/employer/jobs/${jobId}/channels`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ channel, enabled }) });
      const data = (await res.json().catch(() => ({}))) as ChannelsResponse & { error?: string };
      if (!res.ok) throw new Error(data.error || t("distribution.errorGeneric"));
      setChannels(data.channels || {});
      setFeed(data);
    } catch (e) {
      setError(e instanceof Error ? e.message : t("distribution.errorGeneric"));
    } finally {
      setBusy(null);
    }
  }

  if (allowed === null) {
    return (
      <div className="flex items-center gap-2 rounded-lg border border-border-gold bg-white/[0.03] p-3 text-xs text-white/50">
        <Loader2 className="h-3.5 w-3.5 animate-spin" /> {t("distribution.loading")}
      </div>
    );
  }
  if (!allowed) {
    return <p className="rounded-lg border border-border-gold bg-white/[0.03] p-3 text-xs text-white/50">{t("distribution.loadError")}</p>;
  }

  const hasFeed = !!(feed?.indeedFeedUrl || feed?.zipRecruiterFeedUrl);

  return (
    <div className="rounded-lg border border-border-gold bg-white/[0.03] p-3">
      <div className="mb-2 text-xs font-semibold uppercase tracking-wide text-white/60">{t("distribution.title")}</div>
      <div className="space-y-2">
        {CHANNELS.map((channel) => {
          const enabled = !!channels?.[channel]?.enabled;
          return (
            <div key={channel} className="flex items-center justify-between gap-3">
              <span className="text-sm text-cream">{t(`distribution.channel.${channel}`)}</span>
              <button
                type="button"
                role="switch"
                aria-checked={enabled}
                disabled={busy === channel}
                onClick={() => toggle(channel, !enabled)}
                className={`relative h-5 w-9 shrink-0 rounded-full transition-colors ${enabled ? "bg-violet" : "bg-white/15"} disabled:opacity-50`}
              >
                <span className={`absolute top-0.5 h-4 w-4 rounded-full bg-white transition-transform ${enabled ? "translate-x-4" : "translate-x-0.5"}`} />
              </button>
            </div>
          );
        })}
      </div>
      {error && <p className="mt-2 text-xs text-red-300">{error}</p>}

      {hasFeed && (
        <div className="mt-3 space-y-2 rounded-md border border-border-gold bg-white/[0.02] p-3">
          <p className="text-xs text-white/70">{t("distribution.autoNote")}</p>
          {feed?.indeedFeedUrl && (
            <div className="space-y-1">
              <div className="text-xs font-semibold text-white/50">{t("distribution.indeedFeedLabel")}</div>
              <a href={feed.indeedFeedUrl} target="_blank" rel="noopener noreferrer" className="block break-all text-xs text-violet hover:underline">
                {feed.indeedFeedUrl}
              </a>
              {feed.indeedInstructions && <pre className="whitespace-pre-wrap break-words text-xs text-white/50">{feed.indeedInstructions}</pre>}
            </div>
          )}
          {feed?.zipRecruiterFeedUrl && (
            <div className="space-y-1">
              <div className="text-xs font-semibold text-white/50">{t("distribution.zipRecruiterFeedLabel")}</div>
              <a href={feed.zipRecruiterFeedUrl} target="_blank" rel="noopener noreferrer" className="block break-all text-xs text-violet hover:underline">
                {feed.zipRecruiterFeedUrl}
              </a>
              {feed.zipRecruiterInstructions && <pre className="whitespace-pre-wrap break-words text-xs text-white/50">{feed.zipRecruiterInstructions}</pre>}
            </div>
          )}
        </div>
      )}

      <Link href={`/employer/attribution?jobId=${jobId}`} className="mt-3 inline-block text-xs text-violet hover:underline">
        {t("distribution.viewAttribution")}
      </Link>
    </div>
  );
}
