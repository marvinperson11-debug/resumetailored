"use client";

import { useState } from "react";
import { FileSearch, Sparkles, AlertTriangle, Check, Plus, Eye, KeyRound } from "lucide-react";
import { ToolModal } from "../components/tool-modal";
import { Label, TextArea, PrimaryButton } from "../components/ui";
import { useTools } from "../components/tools-context";
import { JdImport } from "./jd-import";
import { emptyDraftContent } from "@/lib/draft-types";
import type { JobDecode } from "@/lib/tools-ai";

export function DecoderKeyTool({ onClose }: { onClose: () => void }) {
  const { openResume } = useTools();
  const [jobText, setJobText] = useState("");
  const [data, setData] = useState<JobDecode | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function run() {
    if (jobText.trim().length < 40) {
      setError("Paste the job posting first (a few sentences at least).");
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/decoder-key", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ jobText }),
      });
      const d = (await res.json().catch(() => ({}))) as { result?: JobDecode; error?: string; message?: string };
      if (!res.ok || !d.result) throw new Error(d.message || d.error || "Could not decode that posting.");
      setData(d.result);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Something went wrong.");
    } finally {
      setLoading(false);
    }
  }

  const footer = (
    <>
      <span className="mr-auto hidden text-xs text-white/45 sm:block">Always free · no Pro gate</span>
      {data && (
        <button
          type="button"
          onClick={() => openResume({ ...emptyDraftContent(), jobText })}
          className="inline-flex items-center gap-1.5 rounded-xl border border-border-gold px-4 py-2.5 text-sm font-medium text-cream transition-colors hover:bg-white/8"
        >
          <Sparkles className="h-4 w-4" /> Build my resume for this
        </button>
      )}
      <PrimaryButton onClick={run} loading={loading}>
        <KeyRound className="h-4 w-4" /> {data ? "Decode again" : "Decode"}
      </PrimaryButton>
    </>
  );

  return (
    <ToolModal title="Decoder Key" icon={FileSearch} onClose={onClose} footer={footer}>
      <div className="grid h-full grid-cols-1 lg:grid-cols-2">
        <div className="min-h-0 space-y-4 overflow-y-auto border-b border-border-gold p-4 lg:border-b-0 lg:border-r">
          <JdImport onImport={setJobText} label="Import posting from URL" />
          <div>
            <Label>Job posting</Label>
            <TextArea rows={13} value={jobText} onChange={(e) => setJobText(e.target.value)} placeholder="Paste the full job posting, or import it from a URL above…" />
          </div>
          {error && <p className="rounded-lg border border-red-500/40 bg-red-500/10 px-3 py-2 text-xs text-red-300">{error}</p>}
        </div>

        <div className="min-h-0 overflow-y-auto bg-navy/40 p-5">
          {data ? (
            <div className="space-y-5">
              {data.summary && (
                <div className="rounded-xl border border-border-gold bg-white/5 p-3.5">
                  <p className="text-sm text-white/85">{data.summary}</p>
                  {data.seniority && <p className="mt-1.5 text-xs uppercase tracking-wide text-white/45">Seniority: <span className="text-cream">{data.seniority}</span></p>}
                </div>
              )}
              <Chips title="Must-have" icon={<Check className="h-3 w-3" />} tone="bg-teal/15 text-teal" items={data.mustHave} />
              <Chips title="Nice-to-have" icon={<Plus className="h-3 w-3" />} tone="bg-violet/15 text-violet" items={data.niceToHave} />
              <Chips title="Red flags" icon={<AlertTriangle className="h-3 w-3" />} tone="bg-red-500/12 text-red-300" items={data.redFlags} />
              <Chips title="Hidden requirements" icon={<Eye className="h-3 w-3" />} tone="bg-gold/15 text-gold" items={data.hiddenRequirements} />
              <Chips title="Culture signals" tone="bg-white/8 text-white/75" items={data.cultureSignals} />
              <Chips title="Keywords to mirror" tone="bg-white/8 text-cream" items={data.keywords} />
            </div>
          ) : (
            <div className="flex h-full min-h-[300px] items-center justify-center rounded-xl border border-dashed border-border-gold p-8 text-center text-sm text-white/45">
              A decoded breakdown — must-haves, nice-to-haves, red flags, hidden requirements, and culture signals — will appear here.
            </div>
          )}
        </div>
      </div>
    </ToolModal>
  );
}

function Chips({ title, tone, items, icon }: { title: string; tone: string; items?: string[]; icon?: React.ReactNode }) {
  if (!items?.length) return null;
  return (
    <div>
      <h4 className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted-cream">{title}</h4>
      <div className="flex flex-wrap gap-1.5">
        {items.map((it, i) => (
          <span key={i} className={`inline-flex items-center gap-1 rounded-full px-2.5 py-1 text-xs ${tone}`}>
            {icon}
            {it}
          </span>
        ))}
      </div>
    </div>
  );
}
