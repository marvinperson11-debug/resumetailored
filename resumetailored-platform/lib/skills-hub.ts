/**
 * Skills Matrix — shared types and pure helpers (no DB, no network). Mirrors
 * the `cert-hub.ts` convention.
 */

export interface Skill {
  id: number;
  name: string;
  createdAt: string;
}

export interface EmployeeSkill {
  employeeId: number;
  skillId: number;
  level: number; // 1-5
  updatedAt: string;
}

export const MIN_SKILL_LEVEL = 1;
export const MAX_SKILL_LEVEL = 5;

export function isValidSkillLevel(n: unknown): n is number {
  return typeof n === "number" && Number.isInteger(n) && n >= MIN_SKILL_LEVEL && n <= MAX_SKILL_LEVEL;
}

/** A color scale from thin (1) to strong (5) for the matrix cell fill. */
export const SKILL_LEVEL_COLORS: Record<number, string> = {
  1: "bg-white/10 text-white/60",
  2: "bg-teal/20 text-teal",
  3: "bg-teal/40 text-white",
  4: "bg-violet/50 text-white",
  5: "bg-gold/70 text-navy",
};

export const SKILL_LEVEL_LABELS: Record<number, string> = {
  1: "Beginner",
  2: "Basic",
  3: "Proficient",
  4: "Advanced",
  5: "Expert",
};

export function normalizeSkillName(name: unknown): string | null {
  const s = typeof name === "string" ? name.trim() : "";
  if (!s) return null;
  return s.slice(0, 100);
}
