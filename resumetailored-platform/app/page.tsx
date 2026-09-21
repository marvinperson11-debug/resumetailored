import { redirect } from "next/navigation";
import { auth } from "@clerk/nextjs/server";
import { getAccess, canUseEmployerPortal, isStaffEmployee } from "@/lib/plan";

/**
 * The dashboard app has no marketing landing page — resumetailored.com is the
 * only marketing site. Root routes people where their ROLE belongs, carrying a
 * Pro-upgrade intent (?upgrade=pro, set by the marketing site's Pro CTAs)
 * through sign-in so it survives to the dashboard:
 *   - signed out          -> /sign-in(?upgrade=pro)  (sign up / sign in FIRST)
 *   - workforce employee  -> /employee               (the scoped Employee Portal)
 *   - employer / recruiter -> /employer              (the Employer Portal)
 *   - individual          -> /candidate(?upgrade=pro) (candidate dashboard)
 * Auth pages point their post-sign-in redirect back here so this one check
 * decides the destination for every role. Because every post-auth flow funnels
 * through this router (the ClerkProvider fallback redirect is "/"), a workforce
 * employee is sent to /employee here no matter where they came from — including
 * after any Clerk task screen — so they never land on /candidate or an employer
 * surface.
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
  // Workforce employees get the scoped portal (they are deliberately excluded
  // from the employer portal), so this must come before the employer check.
  if (isStaffEmployee(access)) redirect("/employee");
  if (canUseEmployerPortal(access)) redirect("/employer");
  redirect(`/candidate${upgrade}`);
}
