/**
 * LinkedIn Optimizer — pure prompt builders + types for profile analysis and
 * section rewrites. Analysis scores the profile for recruiter search/visibility
 * and returns a keyword gap; optimize rewrites a single section for a target
 * role. No DB, no network — the routes call Anthropic and parse with extractJson.
 */

export type SuggestionPriority = "high" | "medium" | "low";

export interface LinkedinSuggestion {
  issue: string;
  fix: string;
  priority: SuggestionPriority;
  /** Which section the "Fix it" button jumps to. */
  section?: "headline" | "about" | "experience" | "skills";
}

export interface LinkedinBreakdown {
  headline: number;
  about: number;
  experience: number;
  keywords: number;
}

export interface LinkedinAnalysis {
  score: number;
  jobTitle: string;
  breakdown: LinkedinBreakdown;
  suggestions: LinkedinSuggestion[];
  presentKeywords: string[];
  missingKeywords: string[];
}

export type OptimizeSection = "headline" | "about" | "experience";

export function isOptimizeSection(v: unknown): v is OptimizeSection {
  return v === "headline" || v === "about" || v === "experience";
}

export function buildLinkedinAnalyzePrompt(profileText: string, jobTitle?: string): { system: string; user: string } {
  const target = (jobTitle || "").trim();
  return {
    system:
      "You are a LinkedIn profile strategist and recruiter-search (LinkedIn Recruiter / boolean search) expert. You score profiles for recruiter visibility and personal branding and return ONLY valid JSON — no markdown, no commentary.",
    user: `Analyze the LinkedIn profile below${target ? ` for someone targeting "${target}" roles` : ""}. If no target role is given, infer the most likely one from the profile.

Return ONLY this JSON shape:
{
  "jobTitle": "the target/inferred role",
  "score": <integer 0-100 overall>,
  "breakdown": {
    "headline": <0-100>,      // is the headline keyword-rich, specific, recruiter-searchable?
    "about": <0-100>,         // is the About section 150-300 words, keyword-dense, first-person, specific?
    "experience": <0-100>,    // do experience entries have quantified, outcome-focused bullets?
    "keywords": <0-100>       // overall richness of role-specific keywords/skills
  },
  "suggestions": [
    { "issue": "specific problem found", "fix": "concrete, actionable fix", "priority": "high|medium|low", "section": "headline|about|experience|skills" }
  ],
  "presentKeywords": [<role-relevant keywords the profile ALREADY contains, max 15>],
  "missingKeywords": [<high-value role keywords recruiters search for that are MISSING, max 15>]
}

Rules: base every judgement on the actual text (never invent the person's history). 4-8 suggestions ordered most-impactful first. Keep keyword tags short (1-3 words). Scores must be consistent with the issues you list.

PROFILE:
${profileText.slice(0, 8000)}`,
  };
}

export function buildLinkedinOptimizePrompt(
  profileText: string,
  section: OptimizeSection,
  jobTitle?: string
): { system: string; user: string } {
  const target = (jobTitle || "").trim();
  const forRole = target ? ` for a "${target}" target role` : "";
  const system =
    "You are an elite LinkedIn copywriter. You write in natural, confident, first-person English optimized for LinkedIn recruiter search — specific, keyword-rich, never buzzword soup. Output ONLY valid JSON, no markdown.";

  let task = "";
  if (section === "headline") {
    task = `Write 3 distinct LinkedIn HEADLINE options${forRole} (each under 220 characters, keyword-rich, recruiter-searchable, no clichés like "results-driven"). Return {"options": ["...","...","..."]} — exactly 3 strings.`;
  } else if (section === "about") {
    task = `Write ONE keyword-rich LinkedIn ABOUT section${forRole}: 150-300 words, first person, specific, with a natural spread of role-relevant keywords and a short call-to-action to close. Return {"options": ["<the full about text>"]} — a single string in the array.`;
  } else {
    task = `Rewrite the candidate's EXPERIENCE as quantified, outcome-focused bullets${forRole} (start each with a strong past-tense verb; add metrics — %, $, timeframes, scale — only where the profile supports them; never invent employers or numbers). Return {"options": ["<all rewritten bullets as one newline-separated string, each line starting with • >"]} — a single string in the array.`;
  }

  return {
    system,
    user: `${task}

Use only what the profile below supports; never fabricate roles, employers, or metrics.

PROFILE:
${profileText.slice(0, 8000)}`,
  };
}

/** Defensive clamp/shape so a slightly-off model response still renders. */
export function normalizeAnalysis(raw: unknown): LinkedinAnalysis | null {
  if (!raw || typeof raw !== "object") return null;
  const r = raw as Record<string, unknown>;
  const clamp = (n: unknown) => Math.max(0, Math.min(100, Math.round(Number(n) || 0)));
  const b = (r.breakdown || {}) as Record<string, unknown>;
  const arr = (v: unknown): string[] => (Array.isArray(v) ? v.map((x) => String(x)).filter(Boolean).slice(0, 15) : []);
  const sugg = Array.isArray(r.suggestions)
    ? (r.suggestions as Record<string, unknown>[])
        .map((s) => ({
          issue: String(s.issue || "").trim(),
          fix: String(s.fix || "").trim(),
          priority: (["high", "medium", "low"].includes(String(s.priority)) ? s.priority : "medium") as SuggestionPriority,
          section: (["headline", "about", "experience", "skills"].includes(String(s.section)) ? s.section : undefined) as LinkedinSuggestion["section"],
        }))
        .filter((s) => s.issue)
    : [];
  if (!sugg.length && typeof r.score !== "number") return null;
  return {
    score: clamp(r.score),
    jobTitle: String(r.jobTitle || "").trim() || "your field",
    breakdown: { headline: clamp(b.headline), about: clamp(b.about), experience: clamp(b.experience), keywords: clamp(b.keywords) },
    suggestions: sugg,
    presentKeywords: arr(r.presentKeywords),
    missingKeywords: arr(r.missingKeywords),
  };
}
