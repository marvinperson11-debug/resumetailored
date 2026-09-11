/**
 * Job Finder — pure helpers: resume↔job match scoring (local keyword overlap,
 * no LLM), AI-mock-listing prompt (fallback when no live job API is
 * configured), and the Pro cover-letter / apply-package prompt builders.
 */

export const EXPERIENCE_LEVELS = [
  { id: "any", label: "Any" },
  { id: "entry", label: "Entry" },
  { id: "mid", label: "Mid" },
  { id: "senior", label: "Senior" },
  { id: "executive", label: "Executive" },
];
export const JOB_TYPES = [
  { id: "full_time", label: "Full-time" },
  { id: "contract", label: "Contract" },
  { id: "part_time", label: "Part-time" },
  { id: "internship", label: "Internship" },
  { id: "remote", label: "Remote" },
];

export interface JobMatch {
  score: number;
  have: string[];
  missing: string[];
}

const STOP = new Set(
  "the and for with you your our are was has have will that this from job role work team years experience skills ability strong excellent required requirements responsibilities including etc who what when where able across into over their they them able within about them a an of to in on at by or as is it be we us our".split(
    /\s+/
  )
);

function tokenize(text: string): string[] {
  return (String(text || "").toLowerCase().match(/[a-z][a-z0-9+#.\-]{2,}/g) || []).filter((w) => !STOP.has(w));
}

/** Rank the most salient keywords in a job's text (title weighted, dedup). */
function jobKeywords(text: string, max = 24): string[] {
  const freq = new Map<string, number>();
  for (const t of tokenize(text)) freq.set(t, (freq.get(t) || 0) + 1);
  return Array.from(freq.entries())
    .filter(([w]) => w.length >= 4)
    .sort((a, b) => b[1] - a[1])
    .slice(0, max)
    .map(([w]) => w);
}

/** Match a resume against a job's text. Returns a 0-100 score + have/missing
 *  keyword lists. Deterministic and instant (no network). */
export function matchResumeToJob(resume: string, jobText: string): JobMatch {
  const resumeSet = new Set(tokenize(resume));
  const kws = jobKeywords(jobText);
  if (!kws.length) return { score: 0, have: [], missing: [] };
  const have = kws.filter((w) => resumeSet.has(w));
  const missing = kws.filter((w) => !resumeSet.has(w));
  // Scale into a realistic 35-98 band so a decent resume never reads as "0%".
  const raw = have.length / kws.length;
  const score = Math.round(35 + raw * 63);
  return { score: Math.max(0, Math.min(98, score)), have: have.slice(0, 12), missing: missing.slice(0, 12) };
}

// ── AI mock listings (fallback only) ──
export function buildMockListingsPrompt(args: {
  resume: string;
  keywords: string;
  location: string;
  experienceLevel: string;
  jobTypes: string[];
  count: number;
}): { system: string; user: string } {
  const { resume, keywords, location, experienceLevel, jobTypes, count } = args;
  return {
    system:
      "You generate realistic, high-quality example job listings for a job-search tool. They must read like real postings (plausible companies, concrete responsibilities and requirements). Output ONLY valid JSON, no markdown.",
    user: `Generate ${count} realistic job listings for: keywords="${keywords || "any"}", location="${location || "any / remote"}", level="${experienceLevel}", types="${(jobTypes || []).join(", ") || "any"}". Return ONLY:
{
  "jobs": [
    {
      "id": "unique-string",
      "title": "job title",
      "company": "plausible company name",
      "location": "city, state or Remote",
      "remote": <bool>,
      "jobType": "Full-time|Contract|Part-time|Internship",
      "experienceLevel": "Entry|Mid|Senior|Executive",
      "salary": "$X – $Y",
      "postedDate": "e.g. 2 days ago",
      "description": "2-3 sentence role summary",
      "requirements": ["5-8 concrete requirements/skills"]
    }
  ]
}
Vary companies, seniorities and salaries realistically. Exactly ${count} listings.

CANDIDATE RESUME (for relevance):
${(resume || "(not provided)").slice(0, 3000)}`,
  };
}

export function buildCoverLetterPrompt(resume: string, jobDescription: string): { system: string; user: string } {
  return {
    system:
      "You are an expert cover-letter writer. Write a tailored, first-person cover letter that complements the résumé (never repeats it as bullets), is specific to this role and company, warm and confident, ~250-320 words. Plain text only, no markdown.",
    user: `Write a cover letter for this job, using the candidate's résumé. Reference something specific about the role; tell one achievement story; close confidently (no "I look forward to hearing from you").

JOB:
${jobDescription.slice(0, 4000)}

RÉSUMÉ:
${resume.slice(0, 4000)}`,
  };
}

export function buildApplyPackagePrompt(resume: string, jobDescription: string): { system: string; user: string } {
  return {
    system:
      "You produce a complete job-application package. Output ONLY valid JSON, no markdown. Never fabricate the candidate's experience — only reframe what the résumé supports.",
    user: `Create a tailored application package for this job. Return ONLY:
{
  "resume": "the candidate's résumé, tailored to this job — plain text, ALL-CAPS section headers (SUMMARY, EXPERIENCE, EDUCATION, SKILLS), quantified bullets starting with strong verbs, every original role kept",
  "coverLetter": "a ~250-word first-person cover letter tailored to this role (complements the résumé, one achievement story, confident close)",
  "linkedInMessage": "a warm, concise (<300 char) LinkedIn connection note to the hiring manager for this role"
}

JOB:
${jobDescription.slice(0, 4000)}

RÉSUMÉ:
${resume.slice(0, 4000)}`,
  };
}

/** Parse a "$120,000 – $150,000" style salary string into [min,max] numbers. */
export function parseSalary(s: string | null | undefined): [number, number] | null {
  if (!s) return null;
  const nums = (String(s).match(/\d[\d,]*/g) || []).map((n) => Number(n.replace(/,/g, ""))).filter((n) => n > 1000);
  if (!nums.length) return null;
  return [Math.min(...nums), Math.max(...nums)];
}

/** Rough local salary insight from the current result set + the candidate's
 *  match. Honest: it's an estimate derived from the listings on screen. */
export function salaryInsight(
  jobSalary: string | null | undefined,
  allSalaries: (string | null | undefined)[],
  matchScore: number | undefined
): { roleLow: number; roleHigh: number; roleMedian: number; yourEstimate: number } | null {
  const ranges = allSalaries.map(parseSalary).filter(Boolean) as [number, number][];
  const own = parseSalary(jobSalary);
  const pool = own ? [own, ...ranges] : ranges;
  if (!pool.length) return null;
  const lows = pool.map((r) => r[0]).sort((a, b) => a - b);
  const highs = pool.map((r) => r[1]).sort((a, b) => a - b);
  const roleLow = lows[0];
  const roleHigh = highs[highs.length - 1];
  const mids = pool.map((r) => (r[0] + r[1]) / 2).sort((a, b) => a - b);
  const roleMedian = Math.round(mids[Math.floor(mids.length / 2)]);
  // Position the candidate within the band by their match score (0.4–1.0 of range).
  const m = Math.max(0, Math.min(98, matchScore ?? 60)) / 100;
  const yourEstimate = Math.round(roleLow + (roleHigh - roleLow) * (0.4 + 0.55 * m));
  return { roleLow, roleHigh, roleMedian, yourEstimate };
}

export interface MockJob {
  id: string;
  title: string;
  company: string;
  location: string;
  remote: boolean;
  jobType: string;
  experienceLevel: string;
  salary: string | null;
  postedDate: string;
  description: string;
  requirements: string[];
}

export function normalizeMockJobs(raw: unknown): MockJob[] {
  const r = (raw || {}) as Record<string, unknown>;
  const arr = Array.isArray(r.jobs) ? (r.jobs as Record<string, unknown>[]) : [];
  return arr
    .map((j, i) => ({
      id: String(j.id || `mock-${i + 1}-${Date.now()}`),
      title: String(j.title || "").trim(),
      company: String(j.company || "Company").trim(),
      location: String(j.location || "").trim(),
      remote: !!j.remote,
      jobType: String(j.jobType || "Full-time").trim(),
      experienceLevel: String(j.experienceLevel || "Mid").trim(),
      salary: j.salary ? String(j.salary).trim() : null,
      postedDate: String(j.postedDate || "Recently").trim(),
      description: String(j.description || "").trim(),
      requirements: Array.isArray(j.requirements) ? j.requirements.map((x) => String(x)).filter(Boolean).slice(0, 10) : [],
    }))
    .filter((j) => j.title);
}
