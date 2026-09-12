/**
 * Employer Dashboard — shared types, taxonomy constants, and the two AI helpers
 * (job-description assist + applicant match scoring). Pure: prompt builders,
 * validators, and normalizers only — no DB, no network. Model: claude-sonnet-4-6
 * (via lib/ai.ts), consistent with the rest of the app.
 */

// ── Taxonomy / enums ──────────────────────────────────────────────────────────
export const INDUSTRIES = [
  "Technology / Software",
  "Finance / Banking",
  "Healthcare / Medical",
  "Education",
  "Retail / E-commerce",
  "Manufacturing",
  "Marketing / Advertising",
  "Real Estate",
  "Hospitality / Travel",
  "Construction",
  "Legal",
  "Non-profit",
  "Media / Entertainment",
  "Transportation / Logistics",
  "Energy / Utilities",
  "Other",
] as const;

export const COMPANY_SIZES = ["1-10", "11-50", "51-200", "201-500", "500+"] as const;

export const JOB_STATUSES = ["draft", "active", "paused", "closed"] as const;
export type JobStatus = (typeof JOB_STATUSES)[number];
export const isJobStatus = (v: unknown): v is JobStatus => (JOB_STATUSES as readonly string[]).includes(String(v));

export const REMOTE_TYPES = ["remote", "hybrid", "onsite"] as const;
export type RemoteType = (typeof REMOTE_TYPES)[number];

export const EMPLOYMENT_TYPES = ["full-time", "part-time", "contract", "internship"] as const;
export type EmploymentType = (typeof EMPLOYMENT_TYPES)[number];

export const APPLICANT_STATUSES = ["new", "reviewed", "shortlisted", "interviewed", "hired", "rejected"] as const;
export type ApplicantStatus = (typeof APPLICANT_STATUSES)[number];
export const isApplicantStatus = (v: unknown): v is ApplicantStatus =>
  (APPLICANT_STATUSES as readonly string[]).includes(String(v));

export const TEAM_ROLES = ["owner", "admin", "recruiter", "viewer"] as const;
export type TeamRole = (typeof TEAM_ROLES)[number];
export const isTeamRole = (v: unknown): v is TeamRole => (TEAM_ROLES as readonly string[]).includes(String(v));

// ── Data shapes (mirror the DB rows, camelCased) ──────────────────────────────
export interface EmployerProfile {
  companyName: string;
  companyWebsite: string;
  industry: string;
  companySize: string;
}

export interface JobPosting {
  id: number;
  title: string;
  department: string;
  location: string;
  remoteType: RemoteType | "";
  employmentType: EmploymentType | "";
  salaryMin: number | null;
  salaryMax: number | null;
  salaryCurrency: string;
  description: string;
  requirements: string[];
  niceToHaves: string[];
  deadline: string | null;
  status: JobStatus;
  publicListed?: boolean;
  company?: string; // employer's company name (joined for the public board)
  applicantCount?: number;
  createdAt: string;
  updatedAt: string;
}

export interface Applicant {
  id: number;
  jobId: number;
  jobTitle?: string;
  name: string;
  email: string;
  resumeText: string;
  coverLetter: string;
  matchScore: number | null;
  matchAnalysis: MatchAnalysis | null;
  status: ApplicantStatus;
  notes: string;
  createdAt: string;
}

export interface TeamMember {
  id: number;
  userId: string | null;
  email: string;
  role: TeamRole;
  status: "pending" | "active";
  inviteToken: string | null;
  createdAt: string;
}

// ── Match scoring ─────────────────────────────────────────────────────────────
export interface MatchAnalysis {
  score: number; // 0-100
  breakdown: {
    requiredMet: string[];
    missing: string[];
    experienceMatch: number; // 0-100
    skillsMatch: number; // 0-100
  };
  strengths: string[]; // top 3
  gaps: string[]; // 2 to consider
  summary: string;
}

export function buildMatchScorePrompt(args: {
  jobTitle?: string;
  jobDescription: string;
  requirements: string[];
  resumeText: string;
}): { system: string; user: string } {
  const { jobTitle, jobDescription, requirements, resumeText } = args;
  return {
    system:
      "You are an experienced technical recruiter who evaluates how well a candidate's resume fits a specific role. You are fair, evidence-based, and never inflate a score. Judge only what the resume actually shows. Output ONLY valid JSON, no markdown.",
    user: `Score this candidate against the role. Return ONLY:
{
  "score": <0-100 overall fit>,
  "breakdown": {
    "requiredMet": ["each required item the resume clearly satisfies"],
    "missing": ["each required item the resume does NOT show"],
    "experienceMatch": <0-100 — seniority/years/domain fit>,
    "skillsMatch": <0-100 — skills/tools/keyword coverage>
  },
  "strengths": ["the 3 strongest reasons to advance this candidate"],
  "gaps": ["the 2 most important gaps or risks to weigh"],
  "summary": "2 sentences: the honest hire-signal verdict"
}
Base every requiredMet/missing item on the REQUIREMENTS list. Keep strengths to 3 and gaps to 2.

ROLE: ${(jobTitle || "the role").slice(0, 160)}

REQUIREMENTS:
${(requirements.length ? requirements : ["(none listed — infer from the description)"]).map((r) => `- ${r}`).join("\n").slice(0, 2500)}

JOB DESCRIPTION:
${jobDescription.slice(0, 4000)}

CANDIDATE RESUME:
${resumeText.slice(0, 4000) || "(no resume text provided)"}`,
  };
}

const clamp100 = (n: unknown) => Math.max(0, Math.min(100, Math.round(Number(n) || 0)));
const strArr = (v: unknown, n: number) =>
  Array.isArray(v) ? v.map((x) => String(x).trim()).filter(Boolean).slice(0, n) : [];

export function normalizeMatch(raw: unknown): MatchAnalysis | null {
  if (!raw || typeof raw !== "object") return null;
  const r = raw as Record<string, unknown>;
  const b = (r.breakdown || {}) as Record<string, unknown>;
  const analysis: MatchAnalysis = {
    score: clamp100(r.score),
    breakdown: {
      requiredMet: strArr(b.requiredMet, 20),
      missing: strArr(b.missing, 20),
      experienceMatch: clamp100(b.experienceMatch),
      skillsMatch: clamp100(b.skillsMatch),
    },
    strengths: strArr(r.strengths, 3),
    gaps: strArr(r.gaps, 2),
    summary: String(r.summary || "").trim(),
  };
  if (!analysis.summary && !analysis.strengths.length && !analysis.breakdown.requiredMet.length) return null;
  return analysis;
}

/** Deterministic keyword-overlap fallback when the AI provider is unavailable. */
export function localMatchFallback(requirements: string[], jobDescription: string, resumeText: string): MatchAnalysis {
  const norm = (s: string) => s.toLowerCase();
  const resume = norm(resumeText);
  const reqs = requirements.length
    ? requirements
    : Array.from(new Set(norm(jobDescription).match(/[a-z][a-z0-9+#.]{3,}/g) || [])).slice(0, 12);
  const met: string[] = [];
  const missing: string[] = [];
  for (const req of reqs) {
    const key = norm(req).split(/[^a-z0-9+#.]+/).filter((w) => w.length > 3)[0] || norm(req);
    (resume.includes(key) ? met : missing).push(req);
  }
  const skillsMatch = reqs.length ? Math.round((met.length / reqs.length) * 100) : 50;
  const score = Math.max(15, Math.min(95, skillsMatch));
  return {
    score,
    breakdown: { requiredMet: met.slice(0, 20), missing: missing.slice(0, 20), experienceMatch: score, skillsMatch },
    strengths: met.slice(0, 3).map((m) => `Resume shows evidence of: ${m}`),
    gaps: missing.slice(0, 2).map((m) => `No clear evidence of: ${m}`),
    summary: "Keyword-based estimate (AI scoring was unavailable). Review the resume directly before deciding.",
  };
}

// ── Job description assist ────────────────────────────────────────────────────
export function buildJobAssistPrompt(args: {
  title: string;
  notes: string;
  department?: string;
  location?: string;
  employmentType?: string;
}): { system: string; user: string } {
  const { title, notes, department, location, employmentType } = args;
  return {
    system:
      "You are an expert recruiting copywriter. You turn rough hiring notes into a polished, inclusive, and specific job description that attracts strong candidates. You write in clear plain prose, avoid clichés and bias-coded language (e.g. 'rockstar', 'ninja', 'aggressive', 'young'), and never invent salary, benefits, or requirements that were not provided. Output plain text only — no markdown symbols.",
    user: `Write a polished job description from these notes.

ROLE: ${title || "(untitled role)"}${department ? `\nDEPARTMENT: ${department}` : ""}${location ? `\nLOCATION: ${location}` : ""}${employmentType ? `\nEMPLOYMENT TYPE: ${employmentType}` : ""}

ROUGH NOTES:
${notes.slice(0, 4000)}

Structure the output as:
- A short, engaging 2-3 sentence overview of the role and its impact.
- "What you'll do" — 4-6 responsibility bullets (start each with "- ").
- "What we're looking for" — 4-6 requirement bullets (start each with "- ").
- A brief, welcoming closing line encouraging a range of candidates to apply.

Keep it inclusive and specific. Do not fabricate compensation, perks, or company facts not present in the notes.`,
  };
}
