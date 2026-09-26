"use client";

import { useCallback, useEffect, useState } from "react";
import { BarChart3, Loader2 } from "lucide-react";
import { SKILL_LEVEL_COLORS, SKILL_LEVEL_LABELS, type EmployeeSkill } from "@/lib/skills-hub";

/** Employee's own skills matrix row — read-only. Ratings are set by the
 *  employer on the Employees → Skills tab. */
export function MySkills() {
  const [skills, setSkills] = useState<(EmployeeSkill & { name: string })[]>([]);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    const res = await fetch("/api/employee/skills").then((r) => r.json()).catch(() => ({}));
    setSkills(res.skills || []);
    setLoading(false);
  }, []);
  useEffect(() => {
    load();
  }, [load]);

  return (
    <div className="rounded-2xl border border-border-gold bg-white/[0.03] p-6">
      <h2 className="mb-4 flex items-center gap-2 text-sm font-semibold text-cream">
        <BarChart3 className="h-4 w-4 text-violet" /> My skills
      </h2>
      {loading ? (
        <div className="flex items-center gap-2 text-sm text-white/50">
          <Loader2 className="h-4 w-4 animate-spin" /> Loading…
        </div>
      ) : skills.length === 0 ? (
        <p className="text-sm text-white/50">Your employer hasn&apos;t rated any skills for you yet.</p>
      ) : (
        <ul className="space-y-1.5">
          {skills.map((s) => (
            <li key={s.skillId} className="flex items-center justify-between gap-3 rounded-lg border border-border-gold bg-white/[0.02] px-3 py-2 text-sm">
              <span className="truncate text-cream">{s.name}</span>
              <span
                title={SKILL_LEVEL_LABELS[s.level]}
                className={`inline-flex h-6 w-6 shrink-0 items-center justify-center rounded-md text-xs font-bold ${SKILL_LEVEL_COLORS[s.level]}`}
              >
                {s.level}
              </span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
