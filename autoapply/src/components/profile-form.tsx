"use client";

import { useState } from "react";
import { Card, CardHeader, CardTitle, CardDescription, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import type { JobPreferences, WorkMode } from "@/lib/types";

const MODES: WorkMode[] = ["any", "remote", "hybrid", "onsite"];

export function ProfileForm({ initial }: { initial: JobPreferences | null }) {
  const [role, setRole] = useState(initial?.role ?? "");
  const [location, setLocation] = useState(initial?.location ?? "");
  const [workMode, setWorkMode] = useState<WorkMode>(initial?.workMode ?? "any");
  const [minSalary, setMinSalary] = useState<string>(initial?.minSalary ? String(initial.minSalary) : "");
  const [status, setStatus] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function save() {
    setBusy(true);
    setStatus(null);
    try {
      const preferences: JobPreferences = {
        role: role || undefined,
        location: location || undefined,
        workMode,
        minSalary: minSalary ? Number(minSalary) : undefined,
      };
      const res = await fetch("/api/profile", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ preferences }),
      });
      setStatus(res.ok ? "Saved ✓" : "Save failed");
    } finally {
      setBusy(false);
    }
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Job preferences</CardTitle>
        <CardDescription>Used to prioritize matches and pre-fill filters.</CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="grid grid-cols-2 gap-4">
          <div>
            <label className="text-xs font-medium">Target role / niche</label>
            <Input value={role} onChange={(e) => setRole(e.target.value)} placeholder="Frontend Engineer" />
          </div>
          <div>
            <label className="text-xs font-medium">Preferred location</label>
            <Input value={location} onChange={(e) => setLocation(e.target.value)} placeholder="Remote · NYC" />
          </div>
          <div>
            <label className="text-xs font-medium">Work mode</label>
            <div className="mt-1 flex gap-1">
              {MODES.map((m) => (
                <button
                  key={m}
                  onClick={() => setWorkMode(m)}
                  className={`rounded-md border px-3 py-1.5 text-xs capitalize ${workMode === m ? "border-primary bg-primary text-primary-foreground" : "border-input"}`}
                >
                  {m}
                </button>
              ))}
            </div>
          </div>
          <div>
            <label className="text-xs font-medium">Minimum salary (USD)</label>
            <Input type="number" value={minSalary} onChange={(e) => setMinSalary(e.target.value)} placeholder="120000" />
          </div>
        </div>
        <div className="flex items-center gap-3">
          <Button onClick={save} disabled={busy}>{busy ? "Saving…" : "Save preferences"}</Button>
          {status && <span className="text-sm text-muted-foreground">{status}</span>}
        </div>
      </CardContent>
    </Card>
  );
}
