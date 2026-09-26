"use client";

import { useState } from "react";
import { Users, UserCheck } from "lucide-react";
import { MessagesClient } from "./messages-client";
import { EmployeeThreads } from "./employee-threads";
import { PageHeader } from "../components/ui";

type Mode = "candidates" | "employees";

/**
 * Top-level Messages switcher: Candidates (the existing recruiting inbox) vs
 * Employees (workforce ↔ employer threads, Phase 1). Kept as a thin wrapper so
 * the complex candidate client stays untouched. Opening a candidate thread from
 * elsewhere (?applicantId=) still lands on the Candidates tab by default.
 */
export function MessagesTabs({
  initialApplicantId,
  initialMode,
  initialEmployeeId,
}: {
  initialApplicantId?: number;
  initialMode?: Mode;
  initialEmployeeId?: number;
}) {
  const [mode, setMode] = useState<Mode>(initialMode ?? "candidates");

  return (
    <div>
      <PageHeader title="Messages" subtitle="Talk to candidates and your team in one place." />
      <div className="mb-6 inline-flex rounded-lg border border-border-gold bg-white/[0.03] p-1">
        <button
          onClick={() => setMode("candidates")}
          className={`inline-flex items-center gap-2 rounded-md px-4 py-1.5 text-sm font-semibold transition-colors ${
            mode === "candidates" ? "bg-violet text-white" : "text-muted-cream hover:text-cream"
          }`}
        >
          <Users className="h-4 w-4" /> Candidates
        </button>
        <button
          onClick={() => setMode("employees")}
          className={`inline-flex items-center gap-2 rounded-md px-4 py-1.5 text-sm font-semibold transition-colors ${
            mode === "employees" ? "bg-violet text-white" : "text-muted-cream hover:text-cream"
          }`}
        >
          <UserCheck className="h-4 w-4" /> Employees
        </button>
      </div>

      {/* Both stay mounted so switching tabs doesn't refetch/lose scroll; the
          hidden one is display:none. */}
      <div className={mode === "candidates" ? "" : "hidden"}>
        <MessagesClient initialApplicantId={initialApplicantId} hideHeader />
      </div>
      <div className={mode === "employees" ? "" : "hidden"}>
        <EmployeeThreads initialEmployeeId={initialEmployeeId} />
      </div>
    </div>
  );
}
