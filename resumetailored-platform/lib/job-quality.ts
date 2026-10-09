import { payTransparencyProblems } from "./pay-transparency";

/**
 * Public-board quality gate. A spam-like listing ("Any Walmart · Any Lagrange ga
 * Hybrid Part-time … $12 – $12") was live on /jobs. This is a conservative
 * heuristic — it only hides listings that are plainly placeholder/low-effort, and
 * never touches the employer's own dashboard (they can still see and edit it).
 * It is NOT a substitute for human moderation; see the audit report.
 */
export interface QualityInput {
  title: string;
  description: string;
  location?: string;
  salaryMin?: number | null;
  salaryMax?: number | null;
  benefitsDescription?: string | null;
}

const MIN_DESCRIPTION_CHARS = 80;

export function listingProblems(j: QualityInput): string[] {
  const problems: string[] = [];
  const title = (j.title || "").trim();
  const anyCount = (`${title} ${j.location || ""}`.match(/\bany\b/gi) || []).length;
  if (/^any\b/i.test(title) || anyCount >= 2) problems.push("placeholder_title");
  if ((j.description || "").trim().length < MIN_DESCRIPTION_CHARS) problems.push("description_too_short");
  // A tiny identical min/max ("$12 – $12") is a spam tell ONLY when the listing has no real pay data.
  // A job with a full wage + benefits description is a deliberate fixed wage (e.g. $18/hr, the same
  // figure entered in both boxes) and is never hidden by this rule.
  const hasFullPayData = payTransparencyProblems({ salaryMin: j.salaryMin, salaryMax: j.salaryMax, benefitsDescription: j.benefitsDescription }).length === 0;
  if (!hasFullPayData && j.salaryMin != null && j.salaryMax != null && j.salaryMin > 0 && j.salaryMin === j.salaryMax && j.salaryMin < 20) problems.push("degenerate_salary");
  return problems;
}

export function isPublishableListing(j: QualityInput): boolean {
  return listingProblems(j).length === 0;
}
