import { FeaturePlaceholder, titleFromSlug } from "@/components/coming-soon";
import { LockedFeature } from "@/components/locked-feature";
import { getAccess, canUseIndividualPro } from "@/lib/plan";

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

// Individual Pro-only tools. Free tools stay open to everyone; employers are
// blocked here (these are individual tools, not employer tools).
const PRO_ONLY = new Set(["resume-video", "personal-website"]);

export default async function CandidateSectionPage({
  params,
}: {
  params: { slug: string[] };
}) {
  const key = params.slug[params.slug.length - 1];
  const feature = LABELS[key] ?? titleFromSlug(params.slug);

  if (PRO_ONLY.has(key)) {
    const access = await getAccess();
    if (!canUseIndividualPro(access)) {
      return <LockedFeature feature={feature} variant="pro" />;
    }
  }

  return <FeaturePlaceholder feature={feature} backHref="/candidate" />;
}
