import { FeaturePlaceholder, titleFromSlug } from "@/components/coming-soon";

// Exact display names for candidate tools, so slugs render with correct casing.
const LABELS: Record<string, string> = {
  tailor: "Tailor My Resume",
  resumes: "My Resumes",
  "cover-letters": "Cover Letters",
  "ats-scanner": "ATS Scanner",
  "linkedin-optimizer": "LinkedIn Optimizer",
  matches: "Job Matches",
  applications: "Applications",
  "shareable-links": "Shareable Links",
  "resume-video": "Resume Video",
  "personal-website": "Personal Website",
  "career-hub": "Career Hub",
  templates: "Templates",
  "interview-prep": "Interview Prep",
  profile: "Profile",
  settings: "Settings",
};

export default function CandidateSectionPage({
  params,
}: {
  params: { slug: string[] };
}) {
  const key = params.slug[params.slug.length - 1];
  const feature = LABELS[key] ?? titleFromSlug(params.slug);
  return <FeaturePlaceholder feature={feature} backHref="/dashboard/candidate" />;
}
