import { payTransparencyProblems, payProblemsMessage } from "./pay-transparency";
import { listingProblems } from "./job-quality";

/**
 * The ONE gate a job posting must pass to go live (status "active") — shared
 * by the hand-driven employer route (app/api/employer/jobs/route.ts POST) and
 * the Employer Portal AI Assistant's draft_job_post mutation
 * (lib/assistant-mutations.ts). The assistant's publish path used to skip
 * this entirely (build-flagged drift) because it never called either check.
 * Draft creation (status !== "active") is never checked — publishing is the
 * only moment either caller enforces anything, same as before this file
 * existed.
 */
export interface JobPublishInput {
  status: string;
  publicListed: boolean;
  title: string;
  description: string;
  location?: string;
  salaryMin?: number | null;
  salaryMax?: number | null;
  benefitsDescription?: string | null;
}

export type JobPublishViolationCode = "pay_transparency" | "low_quality_listing";

export interface JobPublishViolation {
  code: JobPublishViolationCode;
  message: string;
  problems: string[];
}

export const LOW_QUALITY_LISTING_MESSAGE =
  'To appear on the public job board, add a real job title (not "Any …") and a description of at least 80 characters. You can still save it as a private posting.';

/** Null when publishable (or not being published at all). Pay-transparency is
 *  checked for ANY active posting; the board quality check only applies once
 *  it is also public-listed — exactly the two gates the hand route already
 *  enforced separately, just in one place now. */
export function jobPublishViolation(j: JobPublishInput): JobPublishViolation | null {
  if (j.status !== "active") return null;
  const pay = payTransparencyProblems({ salaryMin: j.salaryMin ?? null, salaryMax: j.salaryMax ?? null, benefitsDescription: j.benefitsDescription ?? "" });
  if (pay.length) return { code: "pay_transparency", message: payProblemsMessage(pay), problems: pay };
  if (j.publicListed) {
    const problems = listingProblems({
      title: j.title,
      description: j.description,
      location: j.location || "",
      salaryMin: j.salaryMin ?? null,
      salaryMax: j.salaryMax ?? null,
      benefitsDescription: j.benefitsDescription ?? "",
    });
    if (problems.length) return { code: "low_quality_listing", message: LOW_QUALITY_LISTING_MESSAGE, problems };
  }
  return null;
}
