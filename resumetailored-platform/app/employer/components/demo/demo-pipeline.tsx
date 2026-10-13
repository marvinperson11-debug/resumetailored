"use client";

import { useState } from "react";
import dynamic from "next/dynamic";
import { useTranslations } from "next-intl";
import { Plus, Mail, CalendarClock, FileText } from "lucide-react";
import { DEMO_STAGES, type DemoCandidateView } from "@/lib/employer-demo";
import type { ApplicantStatus } from "@/lib/employer-ai";
import { Panel, PageHeader, Btn, ScoreChip, Modal } from "../ui";
import { useEmployerDemo } from "./demo-provider";

// Loaded on demand, like the real drawer — the demo shares the same viewer, in read-only mode.
const ResumeSection = dynamic(() => import("../resume-viewer/resume-section"), { ssr: false });

const TONE: Record<string, string> = {
  new: "border-sky-400/40",
  reviewed: "border-white/25",
  shortlisted: "border-violet/50",
  interviewed: "border-gold/50",
  "offer extended": "border-gold/50",
  hired: "border-teal/50",
};

/**
 * The anonymous employer taste of the candidate pipeline: Kanban columns of sample candidates.
 * Pure display of the fixtures it is given (lib/employer-demo.ts) — it fetches nothing, and every
 * action on a card (message, schedule, add, move) opens the "create a free employer account"
 * modal rather than doing anything.
 */
export function DemoPipeline({ candidates, jobTitle, resumeViewer = false }: { candidates: DemoCandidateView[]; jobTitle: string; resumeViewer?: boolean }) {
  const t = useTranslations("employerCandidates");
  const td = useTranslations("employerDemo");
  const demo = useEmployerDemo();
  const tv = useTranslations("resumeViewer");
  const urge = () => demo?.openUrge();
  const [viewing, setViewing] = useState<DemoCandidateView | null>(null);

  return (
    <div data-employer-pipeline>
      <PageHeader
        title={t("title")}
        subtitle={td("pipelineSubtitle", { job: jobTitle })}
        action={
          <Btn onClick={urge}>
            <Plus className="h-4 w-4" /> {t("addApplicant")}
          </Btn>
        }
      />
      <div className="-mx-1 flex gap-3 overflow-x-auto px-1 pb-3">
        {DEMO_STAGES.map((stage) => {
          const list = candidates.filter((c) => c.status === stage);
          return (
            <section key={stage} data-stage={stage} className="w-[250px] shrink-0">
              <div className="mb-2 flex items-center justify-between px-1">
                <h2 className="text-xs font-semibold uppercase tracking-wide text-white/60">{t(`applicantStatus.${stage as ApplicantStatus}`)}</h2>
                <span className="rounded-full bg-white/10 px-2 py-0.5 text-[11px] font-semibold text-white/70">{list.length}</span>
              </div>
              <div className="space-y-2.5">
                {list.map((c) => (
                  <Panel key={c.id} className={`border-l-2 p-3.5 ${TONE[stage] ?? ""}`}>
                    <div data-candidate-id={c.id}>
                      <div className="flex items-start justify-between gap-2">
                        <div className="min-w-0">
                          <div className="truncate text-sm font-semibold text-cream">{c.name}</div>
                          <div className="truncate text-xs text-white/45">{c.email}</div>
                        </div>
                        <ScoreChip score={c.matchScore} />
                      </div>
                      <p className="mt-2 text-xs leading-snug text-white/65">{c.headline}</p>
                      <div className="mt-3 flex gap-1.5">
                        <button type="button" onClick={urge} className="inline-flex flex-1 items-center justify-center gap-1 rounded-md border border-border-gold px-2 py-1.5 text-[11px] font-medium text-cream transition-colors hover:bg-white/8">
                          <Mail className="h-3.5 w-3.5" /> {td("actionMessage")}
                        </button>
                        <button type="button" onClick={urge} className="inline-flex flex-1 items-center justify-center gap-1 rounded-md border border-border-gold px-2 py-1.5 text-[11px] font-medium text-cream transition-colors hover:bg-white/8">
                          <CalendarClock className="h-3.5 w-3.5" /> {td("actionSchedule")}
                        </button>
                      </div>
                      {resumeViewer && (
                        <button type="button" onClick={() => setViewing(c)} className="mt-1.5 inline-flex w-full items-center justify-center gap-1 rounded-md border border-border-gold px-2 py-1.5 text-[11px] font-medium text-cream transition-colors hover:bg-white/8">
                          <FileText className="h-3.5 w-3.5" /> {tv("viewResume")}
                        </button>
                      )}
                    </div>
                  </Panel>
                ))}
              </div>
            </section>
          );
        })}
      </div>
      {viewing && (
        <Modal wide title={tv("demoTitle", { name: viewing.name })} onClose={() => setViewing(null)}>
          <ResumeSection source={{ mode: "demo", candidateId: viewing.id }} />
        </Modal>
      )}
    </div>
  );
}
