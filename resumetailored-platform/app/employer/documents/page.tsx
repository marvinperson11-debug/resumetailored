import { auth } from "@clerk/nextjs/server";
import { getAccess, isEmployer } from "@/lib/plan";
import { documentLimit, normalizeTier } from "@/lib/employer-plan";
import { DocumentsClient } from "./documents-client";

export const dynamic = "force-dynamic";

export default async function DocumentsPage() {
  const { userId } = await auth();
  const access = await getAccess();
  const limit = documentLimit(access);
  const tier = normalizeTier(access.tier);
  const nextTierLabel = tier === "free" ? "Portal" : tier === "portal" ? "Scale" : "Corporate";
  return (
    <DocumentsClient
      // Signed-out = the anonymous employer taste: `isEmployer(access)` reads
      // false for the FREE access getAccess() returns to an anonymous caller
      // (no `plan: "employer"` yet), but a brand-new signed-up account IS the
      // owner from the moment it exists — so the create action stays visible
      // here too. Actually creating one is gated client-side (useEmployerDemo).
      canManage={userId ? isEmployer(access) : true}
      documentLimit={limit === Infinity ? null : limit}
      documentNextTierLabel={nextTierLabel}
    />
  );
}
