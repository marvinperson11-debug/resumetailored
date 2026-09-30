import { getAccess, isEmployer } from "@/lib/plan";
import { documentLimit, normalizeTier } from "@/lib/employer-plan";
import { DocumentsClient } from "./documents-client";

export const dynamic = "force-dynamic";

export default async function DocumentsPage() {
  const access = await getAccess();
  const limit = documentLimit(access);
  const tier = normalizeTier(access.tier);
  const nextTierLabel = tier === "free" ? "Employer Portal" : tier === "portal" ? "Scale" : "Corporate";
  return (
    <DocumentsClient
      canManage={isEmployer(access)}
      documentLimit={limit === Infinity ? null : limit}
      documentNextTierLabel={nextTierLabel}
    />
  );
}
