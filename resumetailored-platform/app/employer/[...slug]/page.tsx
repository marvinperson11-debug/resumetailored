import { ComingSoon, titleFromSlug } from "@/components/coming-soon";

export default function EmployerSectionPage({
  params,
}: {
  params: { slug: string[] };
}) {
  return <ComingSoon title={titleFromSlug(params.slug)} />;
}
