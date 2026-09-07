"use client";

import { useState } from "react";
import { Compass, Check, X, ArrowRight } from "lucide-react";
import { ToolModal } from "../components/tool-modal";
import { Label, TextInput, PrimaryButton, UpgradeNote } from "../components/ui";
import type { CareerRoadmap } from "@/lib/tools-ai";

export function CareerHubTool({ onClose, isPro }: { onClose: () => void; isPro: boolean }) {
  const [currentRole, setCurrentRole] = useState("");
  const [years, setYears] = useState("");
  const [targetRole, setTargetRole] = useState("");
  const [data, setData] = useState<CareerRoadmap | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function run() {
    if (!currentRole.trim()) {
      setError("Tell us your current role.");
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/career-hub", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ currentRole, years, targetRole }),
      });
      const d = (await res.json().catch(() => ({}))) as { roadmap?: CareerRoadmap; error?: string; message?: string };
      if (!res.ok || !d.roadmap) throw new Error(d.message || d.error || "Could not build your roadmap.");
      setData(d.roadmap);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Something went wrong.");
    } finally {
      setLoading(false);
    }
  }

  const footer = (
    <>
      <span className="mr-auto hidden text-xs text-white/45 sm:block">Career paths + skill roadmap</span>
      <PrimaryButton onClick={run} loading={loading}>
        <Compass className="h-4 w-4" /> {data ? "Rebuild roadmap" : "Explore paths"}
      </PrimaryButton>
    </>
  );

  return (
    <ToolModal title="Career Hub" icon={Compass} onClose={onClose} footer={footer}>
      <div className="grid h-full grid-cols-1 lg:grid-cols-2">
        <div className="min-h-0 space-y-4 overflow-y-auto border-b border-border-gold p-4 lg:border-b-0 lg:border-r">
          <div>
            <Label>Your current role</Label>
            <TextInput value={currentRole} onChange={(e) => setCurrentRole(e.target.value)} placeholder="e.g. Marketing Coordinator" />
          </div>
          <div>
            <Label>Years of experience</Label>
            <TextInput value={years} onChange={(e) => setYears(e.target.value)} placeholder="e.g. 4" />
          </div>
          <div>
            <Label>Target role (optional)</Label>
            <TextInput value={targetRole} onChange={(e) => setTargetRole(e.target.value)} placeholder="e.g. Head of Growth — or leave blank" />
          </div>
          {!isPro && <UpgradeNote>Pro adds a detailed skill gap + curated learning resources.</UpgradeNote>}
          {error && <p className="rounded-lg border border-red-500/40 bg-red-500/10 px-3 py-2 text-xs text-red-300">{error}</p>}
        </div>

        <div className="min-h-0 overflow-y-auto bg-navy/40 p-5">
          {data ? (
            <div className="space-y-6">
              <Section title="Career paths">
                <div className="space-y-2.5">
                  {data.paths?.map((p, i) => (
                    <div key={i} className="rounded-xl border border-border-gold bg-white/5 p-3.5">
                      <div className="flex items-center justify-between gap-2">
                        <span className="font-medium text-white">{p.title}</span>
                        <span className="shrink-0 text-xs font-semibold text-teal">{p.timeline}</span>
                      </div>
                      <p className="mt-1 text-sm text-white/70">{p.why}</p>
                    </div>
                  ))}
                </div>
              </Section>

              <Section title="Skills to build">
                <div className="flex flex-wrap gap-1.5">
                  {data.skillsToLearn?.map((s, i) => (
                    <span key={i} className="rounded-full bg-violet/15 px-2.5 py-1 text-xs text-violet">{s}</span>
                  ))}
                </div>
              </Section>

              {data.skillGap?.length > 0 && (
                <Section title="Skill gap">
                  <div className="flex flex-wrap gap-1.5">
                    {data.skillGap.map((g, i) => (
                      <span key={i} className={`inline-flex items-center gap-1 rounded-full px-2.5 py-1 text-xs ${g.have ? "bg-teal/15 text-teal" : "bg-red-500/12 text-red-300"}`}>
                        {g.have ? <Check className="h-3 w-3" /> : <X className="h-3 w-3" />}
                        {g.skill}
                      </span>
                    ))}
                  </div>
                </Section>
              )}

              <Section title="Roadmap">
                <ol className="space-y-2">
                  {data.roadmap?.map((r, i) => (
                    <li key={i} className="flex gap-3">
                      <span className="mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-violet/20 text-xs font-bold text-violet">{i + 1}</span>
                      <div>
                        <div className="text-sm font-semibold text-cream">{r.phase}</div>
                        <div className="text-sm text-white/70">{r.focus}</div>
                      </div>
                    </li>
                  ))}
                </ol>
              </Section>

              {isPro ? (
                data.resources?.length > 0 && (
                  <Section title="Resources">
                    <ul className="space-y-1.5">
                      {data.resources.map((r, i) => (
                        <li key={i} className="flex gap-2 text-sm text-white/80">
                          <ArrowRight className="mt-0.5 h-4 w-4 shrink-0 text-gold" />
                          {r}
                        </li>
                      ))}
                    </ul>
                  </Section>
                )
              ) : (
                <UpgradeNote>Unlock curated courses, certs &amp; communities for this path.</UpgradeNote>
              )}
            </div>
          ) : (
            <div className="flex h-full min-h-[300px] items-center justify-center rounded-xl border border-dashed border-border-gold p-8 text-center text-sm text-white/45">
              Your career paths, skill gap, and a phase-by-phase roadmap will appear here.
            </div>
          )}
        </div>
      </div>
    </ToolModal>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div>
      <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted-cream">{title}</h3>
      {children}
    </div>
  );
}
