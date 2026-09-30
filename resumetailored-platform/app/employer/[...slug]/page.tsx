import { getTranslations } from "next-intl/server";
import { FeaturePlaceholder, titleFromSlug } from "@/components/coming-soon";

export default async function EmployerSectionPage({
  params,
}: {
  params: { slug: string[] };
}) {
  const key = params.slug[params.slug.length - 1];
  // Exact display names for employer tools (messages: employerSlug.<slug>); unknown slugs fall back to a title-cased slug.
  const t = await getTranslations("employerSlug");
  const feature = t.has(key) ? t(key) : titleFromSlug(params.slug);
  return <FeaturePlaceholder feature={feature} backHref="/employer" />;
}
