/**
 * Builds the two plain-text blocks sent to /api/cover-letter. These are
 * model-facing prompt scaffolding (always English, regardless of UI locale) —
 * not user-facing UI copy — so they live here rather than in the component.
 */
export function buildCoverLetterPayload(f: {
  name: string;
  contact: string;
  highlights: string;
  company: string;
  role: string;
  jobText: string;
}): { resume: string; jobPosting: string } {
  const resume = [
    f.name && `Name: ${f.name}`,
    f.contact && `Contact: ${f.contact}`,
    f.highlights && `Highlights / background:\n${f.highlights}`,
  ]
    .filter(Boolean)
    .join("\n");
  const jobPosting = [f.company && `Company: ${f.company}`, f.role && `Role: ${f.role}`, f.jobText && `\nJob posting:\n${f.jobText}`]
    .filter(Boolean)
    .join("\n");
  return { resume, jobPosting };
}
