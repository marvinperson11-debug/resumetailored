"use client";

import { useState } from "react";
import { Dialog } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";

export function AddJobDialog({
  open,
  onClose,
  onAdded,
}: {
  open: boolean;
  onClose: () => void;
  onAdded: () => void;
}) {
  const [companyName, setCompanyName] = useState("");
  const [roleTitle, setRoleTitle] = useState("");
  const [jobUrl, setJobUrl] = useState("");
  const [jobDescription, setJobDescription] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function reset() {
    setCompanyName(""); setRoleTitle(""); setJobUrl(""); setJobDescription(""); setError(null);
  }

  async function submit() {
    setSubmitting(true);
    setError(null);
    try {
      const res = await fetch("/api/jobs", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ companyName, roleTitle, jobUrl, jobDescription }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error === "invalid_body" ? "Please fill every field (URL must be valid, description 20+ chars)." : data.error);
        return;
      }
      reset();
      onAdded();
      onClose();
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <Dialog open={open} onClose={onClose}>
      <h2 className="text-lg font-semibold">Add a job</h2>
      <p className="text-sm text-muted-foreground mb-4">Paste the posting URL and the full job description.</p>
      <div className="space-y-3">
        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="text-xs font-medium">Company</label>
            <Input value={companyName} onChange={(e) => setCompanyName(e.target.value)} placeholder="Acme Corp" />
          </div>
          <div>
            <label className="text-xs font-medium">Role</label>
            <Input value={roleTitle} onChange={(e) => setRoleTitle(e.target.value)} placeholder="Senior Frontend Engineer" />
          </div>
        </div>
        <div>
          <label className="text-xs font-medium">Job URL</label>
          <Input value={jobUrl} onChange={(e) => setJobUrl(e.target.value)} placeholder="https://boards.greenhouse.io/acme/jobs/123" />
        </div>
        <div>
          <label className="text-xs font-medium">Job description</label>
          <Textarea
            value={jobDescription}
            onChange={(e) => setJobDescription(e.target.value)}
            placeholder="Paste the full job description here…"
            className="min-h-[160px]"
          />
        </div>
        {error && <p className="text-sm text-destructive">{error}</p>}
      </div>
      <div className="mt-5 flex justify-end gap-2">
        <Button variant="ghost" onClick={onClose}>Cancel</Button>
        <Button
          disabled={submitting || !companyName || !roleTitle || !jobUrl || jobDescription.length < 20}
          onClick={submit}
        >
          {submitting ? "Adding…" : "Add to queue"}
        </Button>
      </div>
    </Dialog>
  );
}
