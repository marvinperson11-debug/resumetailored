import { redirect } from "next/navigation";
import { auth } from "@clerk/nextjs/server";
import { getAccess, canUseIndividualPro } from "@/lib/plan";
import { getUserSite } from "@/lib/site-store";
import { StudioGallery } from "./studio-gallery";

// Full-screen template gallery — the entry point for the Personal Website tool.
// Pro-only; free users are redirected to the upgrade flow.
export const dynamic = "force-dynamic";

export default async function StudioGalleryPage() {
  const access = await getAccess();
  if (!canUseIndividualPro(access)) redirect("/candidate?upgrade=pro");
  const { userId } = await auth();
  const existing = userId ? await getUserSite(userId) : null;
  return <StudioGallery hasPublished={!!existing} />;
}
