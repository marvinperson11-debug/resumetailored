import { getAccess } from "@/lib/plan";
import { canUseCareerSiteBuilder, canUseWhiteLabel } from "@/lib/employer-plan";
import { CareerSiteClient } from "./career-site-client";

export const dynamic = "force-dynamic";

export default async function CareerSitePage() {
  const access = await getAccess();
  return <CareerSiteClient locked={!canUseCareerSiteBuilder(access)} whiteLabel={canUseWhiteLabel(access)} />;
}
