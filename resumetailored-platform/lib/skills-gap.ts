/**
 * Skills-gap analysis (FIX 7 #8). Pure + client-safe: pulls the most salient
 * keywords out of a job posting and marks each as present in, or missing from,
 * the candidate's resume — so the builder can show green (present) / red
 * (missing) chips before the user builds. This is a lightweight local heuristic
 * (no AI call); the ATS scanner remains the authoritative match score.
 */

const STOPWORDS = new Set([
  "the", "and", "for", "you", "your", "our", "with", "will", "are", "have", "has", "was", "were", "this", "that",
  "from", "they", "their", "them", "who", "what", "when", "where", "which", "while", "into", "onto", "than", "then",
  "role", "job", "work", "working", "team", "teams", "company", "companies", "candidate", "candidates", "position",
  "experience", "experiences", "years", "year", "ability", "able", "skills", "skill", "including", "include", "etc",
  "responsibilities", "requirements", "required", "preferred", "plus", "must", "should", "would", "could", "can",
  "we", "us", "as", "at", "to", "of", "in", "on", "or", "an", "a", "is", "be", "by", "it", "its", "not", "all", "any",
  "new", "help", "make", "made", "using", "use", "used", "well", "more", "most", "other", "across", "within", "per",
  "about", "such", "also", "may", "each", "over", "get", "one", "two", "three", "day", "days", "week", "weeks",
  "looking", "seeking", "join", "opportunity", "opportunities", "environment", "based", "strong", "excellent", "good",
  "great", "highly", "self", "must-have", "nice", "bonus", "responsible", "duties", "role's", "you'll", "we're",
]);

function tokenize(text: string): string[] {
  return (String(text).toLowerCase().match(/[a-z][a-z0-9+#.]{2,}/g) || []).filter((w) => !STOPWORDS.has(w));
}

export interface SkillGap {
  present: string[];
  missing: string[];
}

/** Top job keywords split into those present in the resume and those missing. */
export function analyzeSkillGap(resume: string, job: string, limit = 24): SkillGap {
  if (!job.trim()) return { present: [], missing: [] };
  const resumeSet = new Set(tokenize(resume));

  // Rank job keywords by frequency, keep the top `limit` unique terms.
  const freq = new Map<string, number>();
  for (const w of tokenize(job)) freq.set(w, (freq.get(w) || 0) + 1);
  const ranked = Array.from(freq.entries())
    .sort((a, b) => b[1] - a[1])
    .map(([w]) => w)
    .slice(0, limit);

  const present: string[] = [];
  const missing: string[] = [];
  for (const w of ranked) (resumeSet.has(w) ? present : missing).push(w);
  return { present, missing };
}
