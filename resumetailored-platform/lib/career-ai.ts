/**
 * Career Hub — shared types, option lists, AI prompt builders + normalizers for
 * the roadmap / skill-gap / insights routes, and small deterministic helpers
 * (countdown, velocity score). No DB, no network.
 */

export const INDUSTRIES = ["Tech", "Healthcare", "Finance", "Marketing", "Design", "Education", "Sales", "Operations", "Legal", "Manufacturing", "Other"];
export const GOAL_CATEGORIES = ["promotion", "skill", "certification", "networking", "salary", "transition"] as const;
export const PRIORITIES = ["low", "medium", "high"] as const;
export const GOAL_STATUSES = ["not_started", "in_progress", "completed"] as const;
export const MILESTONE_TYPES = ["job", "promotion", "certification", "project", "salary", "education"] as const;

export type GoalCategory = (typeof GOAL_CATEGORIES)[number];
export type Priority = (typeof PRIORITIES)[number];
export type GoalStatus = (typeof GOAL_STATUSES)[number];
export type MilestoneType = (typeof MILESTONE_TYPES)[number];

export const isGoalCategory = (v: unknown): v is GoalCategory => (GOAL_CATEGORIES as readonly string[]).includes(String(v));
export const isPriority = (v: unknown): v is Priority => (PRIORITIES as readonly string[]).includes(String(v));
export const isGoalStatus = (v: unknown): v is GoalStatus => (GOAL_STATUSES as readonly string[]).includes(String(v));
export const isMilestoneType = (v: unknown): v is MilestoneType => (MILESTONE_TYPES as readonly string[]).includes(String(v));

export interface CareerProfile {
  currentRole: string;
  targetRole: string;
  industry: string;
  yearsExperience: number | null;
}
export interface CareerGoal {
  id: number;
  title: string;
  category: GoalCategory;
  priority: Priority;
  targetDate: string | null;
  status: GoalStatus;
  progress: number;
  notes: string | null;
}
export interface CareerMilestone {
  id: number;
  type: MilestoneType;
  title: string;
  date: string;
  description: string | null;
  impact: string | null;
}

export interface RoadmapStage {
  stage: string;
  timeframe: string;
  skills: string[];
  certifications: string[];
  actions: string[];
}
export interface Roadmap {
  roadmap: RoadmapStage[];
  estimatedMonths: number;
  confidence: "low" | "medium" | "high";
}
export interface SkillGap {
  gaps: { skill: string; importance: number; learnTime: string; resources: string[] }[];
  haveIt: { skill: string; proficiency: string }[];
}
export interface Insights {
  onTrack: boolean;
  targetDate: string;
  topActions: string[];
  velocityScore: number;
}

// ── Prompts ──
export function buildRoadmapPrompt(a: { currentRole: string; targetRole: string; industry: string; yearsExperience: number | null; skills: string[]; goals: string[] }): { system: string; user: string } {
  return {
    system: "You are a senior career coach. You design concrete, realistic career-progression roadmaps. Output ONLY valid JSON, no markdown.",
    user: `Build a step-by-step roadmap from "${a.currentRole || "current role"}" to "${a.targetRole || "the next logical role"}" in ${a.industry || "their industry"} (${a.yearsExperience ?? "some"} yrs experience). Return ONLY:
{
  "roadmap": [ { "stage": "short stage name", "timeframe": "e.g. Months 0-3", "skills": ["skills to acquire"], "certifications": ["relevant certs, if any"], "actions": ["concrete actions"] } ],
  "estimatedMonths": <integer total months to target role>,
  "confidence": "low|medium|high"
}
3-5 stages covering a 6-12 month path. Be specific to the roles/industry.
${a.skills.length ? `Current skills: ${a.skills.slice(0, 30).join(", ")}` : ""}
${a.goals.length ? `Their stated goals: ${a.goals.slice(0, 10).join("; ")}` : ""}`,
  };
}

export function buildSkillGapPrompt(a: { currentSkills: string[]; targetRole: string; industry: string }): { system: string; user: string } {
  return {
    system: "You are a career skills analyst. Output ONLY valid JSON, no markdown.",
    user: `Compare the candidate's current skills to what "${a.targetRole}" in ${a.industry || "their industry"} requires. Return ONLY:
{
  "gaps": [ { "skill": "missing skill", "importance": <0-100>, "learnTime": "e.g. 2-3 months", "resources": ["a course/book/cert suggestion"] } ],
  "haveIt": [ { "skill": "skill they already have that matters", "proficiency": "e.g. Strong" } ]
}
Rank gaps by importance (most important first), max 8 gaps. Base "haveIt" only on their listed skills.
Current skills: ${a.currentSkills.slice(0, 40).join(", ") || "(none provided)"}`,
  };
}

export function buildInsightsPrompt(a: { currentRole: string; targetRole: string; milestones: string[]; goals: string[]; velocityScore: number }): { system: string; user: string } {
  return {
    system: "You are a pragmatic career coach giving a short status read. Output ONLY valid JSON, no markdown.",
    user: `Assess this person's progress from "${a.currentRole}" toward "${a.targetRole}". Return ONLY:
{
  "onTrack": <bool — are they progressing well toward the target?>,
  "targetDate": "a realistic month/year they could reach the target role, e.g. 'Q3 2027'",
  "topActions": ["3 highest-impact actions to take THIS month"],
  "velocityScore": <0-100 — momentum, informed by the computed score ${a.velocityScore}>
}
Milestones (recent-first): ${a.milestones.slice(0, 12).join(" | ") || "(none)"}
Goals: ${a.goals.slice(0, 12).join(" | ") || "(none)"}`,
  };
}

// ── Normalizers ──
const clamp100 = (n: unknown) => Math.max(0, Math.min(100, Math.round(Number(n) || 0)));
const strArr = (v: unknown, n: number) => (Array.isArray(v) ? v.map((x) => String(x).trim()).filter(Boolean).slice(0, n) : []);

export function normalizeRoadmap(raw: unknown): Roadmap | null {
  const r = (raw || {}) as Record<string, unknown>;
  const stages = Array.isArray(r.roadmap) ? (r.roadmap as Record<string, unknown>[]) : [];
  const roadmap = stages
    .map((s) => ({
      stage: String(s.stage || "").trim(),
      timeframe: String(s.timeframe || "").trim(),
      skills: strArr(s.skills, 8),
      certifications: strArr(s.certifications, 6),
      actions: strArr(s.actions, 8),
    }))
    .filter((s) => s.stage);
  if (!roadmap.length) return null;
  const conf = ["low", "medium", "high"].includes(String(r.confidence)) ? (r.confidence as Roadmap["confidence"]) : "medium";
  return { roadmap, estimatedMonths: Math.max(1, Math.min(60, Math.round(Number(r.estimatedMonths) || 9))), confidence: conf };
}

export function normalizeSkillGap(raw: unknown): SkillGap | null {
  const r = (raw || {}) as Record<string, unknown>;
  const gaps = Array.isArray(r.gaps) ? (r.gaps as Record<string, unknown>[]) : [];
  const g = gaps
    .map((x) => ({ skill: String(x.skill || "").trim(), importance: clamp100(x.importance), learnTime: String(x.learnTime || "").trim(), resources: strArr(x.resources, 4) }))
    .filter((x) => x.skill)
    .sort((a, b) => b.importance - a.importance)
    .slice(0, 8);
  const have = Array.isArray(r.haveIt) ? (r.haveIt as Record<string, unknown>[]) : [];
  const haveIt = have.map((x) => ({ skill: String(x.skill || "").trim(), proficiency: String(x.proficiency || "").trim() })).filter((x) => x.skill).slice(0, 12);
  if (!g.length && !haveIt.length) return null;
  return { gaps: g, haveIt };
}

export function normalizeInsights(raw: unknown, fallbackVelocity: number): Insights | null {
  const r = (raw || {}) as Record<string, unknown>;
  const topActions = strArr(r.topActions, 4);
  if (!topActions.length && typeof r.onTrack !== "boolean") return null;
  return {
    onTrack: !!r.onTrack,
    targetDate: String(r.targetDate || "").trim() || "—",
    topActions,
    velocityScore: typeof r.velocityScore === "number" ? clamp100(r.velocityScore) : fallbackVelocity,
  };
}

// ── Deterministic helpers ──
/** Days until a YYYY-MM-DD date (negative = past). null when no date. */
export function daysUntil(date: string | null | undefined): number | null {
  if (!date) return null;
  const d = Date.parse(date);
  if (!d) return null;
  return Math.round((d - Date.now()) / 86400000);
}

/** Local career-velocity score (0-100): recent milestone frequency + goal completion. */
export function velocityScore(milestones: { date: string }[], goals: { status: string }[]): number {
  const now = Date.now();
  const recent = milestones.filter((m) => {
    const d = Date.parse(m.date);
    return d && now - d < 2 * 365 * 86400000; // last 2 years
  }).length;
  const done = goals.filter((g) => g.status === "completed").length;
  const total = goals.length || 1;
  const milestoneScore = Math.min(60, recent * 20); // ~3 recent milestones caps it
  const goalScore = Math.round((done / total) * 40);
  return Math.max(0, Math.min(100, milestoneScore + goalScore));
}
