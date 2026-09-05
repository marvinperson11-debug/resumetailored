import { FeaturePlaceholder, titleFromSlug } from "@/components/coming-soon";

// Exact display names for employer tools, so slugs render with correct casing.
const LABELS: Record<string, string> = {
  hire: "Hire",
  people: "People",
  candidates: "Candidate Search",
  shortlists: "Shortlists",
  messages: "Messages",
  scheduler: "Interview Scheduler",
  time: "Time",
  payroll: "Payroll",
  reports: "Reports",
  "career-site": "Career Site Builder",
  documents: "Documents",
  compliance: "Compliance",
  settings: "Settings",
};

export default function EmployerSectionPage({
  params,
}: {
  params: { slug: string[] };
}) {
  const key = params.slug[params.slug.length - 1];
  const feature = LABELS[key] ?? titleFromSlug(params.slug);
  return <FeaturePlaceholder feature={feature} backHref="/dashboard/employer" />;
}
