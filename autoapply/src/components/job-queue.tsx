"use client";

import { useEffect, useState, useCallback } from "react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card } from "@/components/ui/card";
import { AddJobDialog } from "@/components/add-job-dialog";
import { PrepareDrawer } from "@/components/prepare-drawer";
import { triggerExtensionApply, isExtensionInstalled } from "@/lib/extension-bridge";

export interface JobRow {
  id: string;
  companyName: string;
  roleTitle: string;
  jobUrl: string;
  status: "NEW" | "PREPARED" | "APPLIED";
  matchScore: number | null;
  matchSummary: string | null;
  coverLetter: string | null;
  appliedAt: string | null;
  createdAt: string;
}

const statusBadge: Record<JobRow["status"], { label: string; variant: "secondary" | "warning" | "success" }> = {
  NEW: { label: "New", variant: "secondary" },
  PREPARED: { label: "Prepared", variant: "warning" },
  APPLIED: { label: "Applied", variant: "success" },
};

function scoreColor(score: number | null) {
  if (score == null) return "text-muted-foreground";
  if (score >= 80) return "text-emerald-600";
  if (score >= 60) return "text-amber-600";
  return "text-red-600";
}

export function JobQueue() {
  const [jobs, setJobs] = useState<JobRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState<Record<string, string>>({}); // jobId -> action
  const [addOpen, setAddOpen] = useState(false);
  const [prepareId, setPrepareId] = useState<string | null>(null);
  const [extInstalled, setExtInstalled] = useState(false);

  const load = useCallback(async () => {
    const res = await fetch("/api/jobs");
    const data = await res.json();
    setJobs(data.jobs ?? []);
    setLoading(false);
  }, []);

  useEffect(() => {
    load();
    isExtensionInstalled().then(setExtInstalled);
  }, [load]);

  const setBusyFor = (id: string, action: string | null) =>
    setBusy((b) => {
      const next = { ...b };
      if (action) next[id] = action;
      else delete next[id];
      return next;
    });

  async function score(id: string) {
    setBusyFor(id, "score");
    try {
      const res = await fetch(`/api/jobs/${id}/score`, { method: "POST" });
      const data = await res.json();
      if (!res.ok) alert(data.message || data.error || "Scoring failed");
      await load();
    } finally {
      setBusyFor(id, null);
    }
  }

  async function prepare(id: string) {
    setBusyFor(id, "prepare");
    try {
      const res = await fetch(`/api/jobs/${id}/prepare`, { method: "POST" });
      const data = await res.json();
      if (!res.ok) {
        alert(data.message || data.error || "Prepare failed");
        return;
      }
      await load();
      setPrepareId(id);
    } finally {
      setBusyFor(id, null);
    }
  }

  async function apply(job: JobRow) {
    if (!extInstalled) {
      window.open(job.jobUrl, "_blank", "noopener");
      alert(
        "The AutoApply extension isn't detected. The job opened in a new tab — install the extension to auto-fill the form."
      );
      return;
    }
    triggerExtensionApply({
      jobId: job.id,
      jobUrl: job.jobUrl,
      apiBase: window.location.origin,
    });
  }

  async function remove(id: string) {
    if (!confirm("Remove this job from your queue?")) return;
    setBusyFor(id, "delete");
    await fetch(`/api/jobs/${id}`, { method: "DELETE" });
    await load();
    setBusyFor(id, null);
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div className="text-sm text-muted-foreground">
          {extInstalled ? (
            <span className="text-emerald-600">● Extension connected</span>
          ) : (
            <span>Extension not detected — Apply will open the tab for manual fill.</span>
          )}
        </div>
        <Button onClick={() => setAddOpen(true)}>+ Add Job</Button>
      </div>

      <Card className="overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-muted/50 text-left text-muted-foreground">
              <tr>
                <th className="px-4 py-3 font-medium">Company</th>
                <th className="px-4 py-3 font-medium">Role</th>
                <th className="px-4 py-3 font-medium">Match</th>
                <th className="px-4 py-3 font-medium">Status</th>
                <th className="px-4 py-3 font-medium text-right">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y">
              {loading && (
                <tr><td colSpan={5} className="px-4 py-10 text-center text-muted-foreground">Loading…</td></tr>
              )}
              {!loading && jobs.length === 0 && (
                <tr><td colSpan={5} className="px-4 py-10 text-center text-muted-foreground">
                  No jobs yet. Click <strong>Add Job</strong> to paste a posting.
                </td></tr>
              )}
              {jobs.map((job) => {
                const b = busy[job.id];
                return (
                  <tr key={job.id} className="hover:bg-muted/30">
                    <td className="px-4 py-3 font-medium">{job.companyName}</td>
                    <td className="px-4 py-3">
                      <a href={job.jobUrl} target="_blank" rel="noopener noreferrer" className="hover:underline">
                        {job.roleTitle}
                      </a>
                    </td>
                    <td className="px-4 py-3">
                      {job.matchScore != null ? (
                        <span className={`font-semibold ${scoreColor(job.matchScore)}`} title={job.matchSummary ?? ""}>
                          {job.matchScore}
                        </span>
                      ) : (
                        <Button variant="ghost" size="sm" disabled={b === "score"} onClick={() => score(job.id)}>
                          {b === "score" ? "Scoring…" : "Score"}
                        </Button>
                      )}
                    </td>
                    <td className="px-4 py-3">
                      <Badge variant={statusBadge[job.status].variant}>{statusBadge[job.status].label}</Badge>
                    </td>
                    <td className="px-4 py-3">
                      <div className="flex items-center justify-end gap-2">
                        {job.status === "NEW" && job.matchScore == null && (
                          <Button variant="outline" size="sm" disabled={b === "score"} onClick={() => score(job.id)}>
                            {b === "score" ? "…" : "Score"}
                          </Button>
                        )}
                        <Button variant="outline" size="sm" disabled={b === "prepare"} onClick={() => prepare(job.id)}>
                          {b === "prepare" ? "Preparing…" : job.status === "NEW" ? "Prepare" : "Re-prepare"}
                        </Button>
                        {job.coverLetter && (
                          <Button variant="ghost" size="sm" onClick={() => setPrepareId(job.id)}>View</Button>
                        )}
                        <Button size="sm" disabled={job.status === "NEW"} onClick={() => apply(job)}>
                          Apply
                        </Button>
                        <Button variant="ghost" size="icon" title="Remove" onClick={() => remove(job.id)}>✕</Button>
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </Card>

      <AddJobDialog open={addOpen} onClose={() => setAddOpen(false)} onAdded={load} />
      {prepareId && (
        <PrepareDrawer jobId={prepareId} onClose={() => setPrepareId(null)} onChanged={load} />
      )}
    </div>
  );
}
