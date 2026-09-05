import { ComingSoon, titleFromSlug } from "@/components/coming-soon";

export default function CandidateSectionPage({
  params,
}: {
  params: { slug: string[] };
}) {
  return <ComingSoon title={titleFromSlug(params.slug)} />;
}
