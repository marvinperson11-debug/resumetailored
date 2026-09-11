import { redirect } from "next/navigation";
import { auth } from "@clerk/nextjs/server";
import { getAccess, canUseEmployerPortal } from "@/lib/plan";

/**
 * The dashboard app has no marketing landing page — resumetailored.com is the
 * only marketing site. Root routes people where their ROLE belongs, carrying a
 * Pro-upgrade intent (?upgrade=pro, set by the marketing site's Pro CTAs)
 * through sign-in so it survives to the dashboard:
 *   - signed out          -> /sign-in(?upgrade=pro)  (sign up / sign in FIRST)
 *   - employer / employee -> /employer               (the Employer Portal)
 *   - individual          -> /candidate(?upgrade=pro) (candidate dashboard)
 * Auth pages point their post-sign-in redirect back here so this one check
 * decides the destination for every role.
 */
export default async function Home({
  searchParams,
}: {
  searchParams: { upgrade?: string };
}) {
  const { userId } = await auth();
  const upgrade = searchParams?.upgrade === "pro" ? "?upgrade=pro" : "";
  if (!userId) redirect(`/sign-in${upgrade}`);

  const access = await getAccess();
  if (canUseEmployerPortal(access)) redirect("/employer");
  redirect(`/candidate${upgrade}`);
}
