/**
 * Pay-transparency data capture for job postings. A posting cannot be PUBLISHED
 * (status "active") without (1) a wage or a good-faith wage range and (2) a general
 * description of benefits. Drafts may leave them empty. These are data-capture
 * rules only — they say nothing about whether any particular listing satisfies any
 * particular law; that obligation stays with the employer.
 *
 * Pure (no DB, no network) so the API routes, the editor and the tests share one rule.
 */
export const PAY_PERIODS = ["hour", "week", "month", "year"] as const;
export type PayPeriod = (typeof PAY_PERIODS)[number];
export const DEFAULT_PAY_PERIOD: PayPeriod = "year";
export const BENEFITS_MIN_CHARS = 10;
export const BENEFITS_MAX_CHARS = 2000;

export type PayProblem = "wage_required" | "wage_range_invalid" | "benefits_required";

export function cleanPayPeriod(v: unknown): PayPeriod {
  return (PAY_PERIODS as readonly string[]).includes(String(v)) ? (v as PayPeriod) : DEFAULT_PAY_PERIOD;
}

export interface PayInput {
  salaryMin?: number | null;
  salaryMax?: number | null;
  benefitsDescription?: string | null;
}

/** A wage is one figure typed into both boxes; a range is min < max. Both bounds are required. */
export function payTransparencyProblems(j: PayInput): PayProblem[] {
  const problems: PayProblem[] = [];
  const min = j.salaryMin ?? 0;
  const max = j.salaryMax ?? 0;
  if (!(min > 0) || !(max > 0)) problems.push("wage_required");
  else if (max < min) problems.push("wage_range_invalid");
  if ((j.benefitsDescription || "").trim().length < BENEFITS_MIN_CHARS) problems.push("benefits_required");
  return problems;
}

export const PAY_PROBLEM_MESSAGES: Record<PayProblem, string> = {
  wage_required: "Add the wage or a good-faith wage range (minimum and maximum) before publishing. For a fixed wage, enter the same amount in both fields.",
  wage_range_invalid: "The maximum wage must be at least the minimum.",
  benefits_required: "Add a general description of benefits (for example health insurance, retirement, paid leave, other non-wage compensation) before publishing.",
};

export function payProblemsMessage(problems: PayProblem[]): string {
  return problems.map((p) => PAY_PROBLEM_MESSAGES[p]).join(" ");
}
