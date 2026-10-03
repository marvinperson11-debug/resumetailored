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

/** Light plural fold so "teams" matches "team" (never touches "ss"/short words). */
function stem(w: string): string {
  if (w.length > 4 && w.endsWith("ies")) return w.slice(0, -3) + "y";
  if (w.length > 3 && w.endsWith("s") && !w.endsWith("ss") && !w.endsWith("us")) return w.slice(0, -1);
  return w;
}

/**
 * Lower-cased keyword tokens. Words may keep INNER "." / "+" / "#" (node.js, c++, c#) but
 * never a trailing period or other punctuation. A hyphenated compound yields the full
 * compound AND each part, so "cross-functional" matches "cross", "functional" and itself.
 */
function tokenize(text: string): string[] {
  const out: string[] = [];
  const words = String(text).toLowerCase().match(/[a-z0-9][a-z0-9+#]*(?:[-.][a-z0-9+#]+)*[+#]*/g) || [];
  for (const raw of words) {
    const parts = raw.includes("-") ? raw.split("-") : [];
    for (const w of [raw, ...parts]) {
      if (w.length >= 3 && /[a-z]/.test(w) && !STOPWORDS.has(w) && !STOPWORDS.has(stem(w))) out.push(w);
    }
  }
  return out;
}

export interface SkillGap {
  present: string[];
  missing: string[];
}

/** Top job keywords split into those present in the resume and those missing. */
export function analyzeSkillGap(resume: string, job: string, limit = 24): SkillGap {
  if (!job.trim()) return { present: [], missing: [] };
  // Compare on the plural-folded form, so display words keep the job's own spelling.
  const resumeSet = new Set(tokenize(resume).map(stem));

  // Rank job keywords by frequency, keep the top `limit` unique terms.
  const freq = new Map<string, number>();
  for (const w of tokenize(job)) freq.set(w, (freq.get(w) || 0) + 1);
  // Merge singular/plural variants of one job term ("team"/"teams") into the first-seen spelling.
  const byStem = new Map<string, string>();
  for (const w of Array.from(freq.keys())) {
    const k = stem(w), first = byStem.get(k);
    if (first === undefined) byStem.set(k, w);
    else { freq.set(first, (freq.get(first) || 0) + (freq.get(w) || 0)); freq.delete(w); }
  }
  const ranked = Array.from(freq.entries())
    .sort((a, b) => b[1] - a[1])
    .map(([w]) => w)
    .slice(0, limit);

  // A compound also counts when the resume has every part ("data driven" ~ "data-driven").
  const inResume = (w: string) =>
    resumeSet.has(stem(w)) || (w.includes("-") && w.split("-").every((p) => resumeSet.has(stem(p)) || STOPWORDS.has(p)));

  const present: string[] = [];
  const missing: string[] = [];
  for (const w of ranked) (inResume(w) ? present : missing).push(w);
  return { present, missing };
}
