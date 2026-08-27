"use client";

import { useEffect, useState } from "react";
import { Dialog } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import type { SuggestedAnswer } from "@/lib/types";

interface FullJob {
  id: string;
  companyName: string;
  roleTitle: string;
  matchScore: number | null;
  matchSummary: string | null;
  coverLetter: string | null;
  suggestedAnswers: SuggestedAnswer[] | null;
}

export function PrepareDrawer({
  jobId,
  onClose,
}: {
  jobId: string;
  onClose: () => void;
  onChanged: () => void;
}) {
  const [job, setJob] = useState<FullJob | null>(null);
  const [tab, setTab] = useState<"cover" | "answers" | "match">("cover");

  useEffect(() => {
    fetch(`/api/jobs/${jobId}`)
      .then((r) => r.json())
      .then((d) => setJob(d.job));
  }, [jobId]);

  function copy(text: string) {
    navigator.clipboard.writeText(text);
  }

  return (
    <Dialog open onClose={onClose} className="max-w-2xl">
      {!job ? (
        <p className="py-10 text-center text-muted-foreground">Loading…</p>
      ) : (
        <div>
          <div className="flex items-start justify-between">
            <div>
              <h2 className="text-lg font-semibold">{job.roleTitle}</h2>
              <p className="text-sm text-muted-foreground">{job.companyName}</p>
            </div>
            {job.matchScore != null && (
              <div className="text-right">
                <div className="text-2xl font-bold text-primary">{job.matchScore}</div>
                <div className="text-xs text-muted-foreground">match</div>
              </div>
            )}
          </div>

          <div className="mt-4 flex gap-1 border-b text-sm">
            {(["cover", "answers", "match"] as const).map((t) => (
              <button
                key={t}
                onClick={() => setTab(t)}
                className={`px-3 py-2 -mb-px border-b-2 ${tab === t ? "border-primary text-foreground" : "border-transparent text-muted-foreground"}`}
              >
                {t === "cover" ? "Cover letter" : t === "answers" ? "Suggested answers" : "Match"}
              </button>
            ))}
          </div>

          <div className="mt-4 max-h-[50vh] overflow-y-auto">
            {tab === "cover" && (
              <div>
                {job.coverLetter ? (
                  <>
                    <Button variant="outline" size="sm" className="mb-2" onClick={() => copy(job.coverLetter!)}>Copy</Button>
                    <pre className="whitespace-pre-wrap font-sans text-sm leading-relaxed">{job.coverLetter}</pre>
                  </>
                ) : (
                  <p className="text-sm text-muted-foreground">No cover letter yet — run Prepare.</p>
                )}
              </div>
            )}
            {tab === "answers" && (
              <div className="space-y-4">
                {(job.suggestedAnswers ?? []).map((qa, i) => (
                  <div key={i}>
                    <div className="flex items-center justify-between">
                      <p className="text-sm font-medium">{qa.question}</p>
                      <Button variant="ghost" size="sm" onClick={() => copy(qa.answer)}>Copy</Button>
                    </div>
                    <p className="text-sm text-muted-foreground mt-1">{qa.answer}</p>
                  </div>
                ))}
                {(!job.suggestedAnswers || job.suggestedAnswers.length === 0) && (
                  <p className="text-sm text-muted-foreground">No answers yet — run Prepare.</p>
                )}
              </div>
            )}
            {tab === "match" && (
              <p className="text-sm leading-relaxed">{job.matchSummary ?? "Not scored yet."}</p>
            )}
          </div>

          <div className="mt-5 flex justify-end">
            <Button variant="ghost" onClick={onClose}>Close</Button>
          </div>
        </div>
      )}
    </Dialog>
  );
}
