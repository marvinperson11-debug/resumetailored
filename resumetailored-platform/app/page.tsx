import { redirect } from "next/navigation";
import { cookies } from "next/headers";
import { auth } from "@clerk/nextjs/server";
import { getAccess, canUseEmployerPortal, isStaffEmployee } from "@/lib/plan";
import { getEmployerProfile } from "@/lib/employer-store";
import { StaffWhichDoor } from "@/components/staff-which-door";

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
  // The FIRST time (per browser — see rt_staff_door_seen) a staff session
  // lands here, offer the choice instead of silently bouncing to /employee:
  // a workforce employee who discovers the candidate tools and tries to sign
  // up with their work email hits Clerk's duplicate-email block, and signing
  // in instead used to just re-strand them in the employee portal with no way
  // to reach the resume tools using that same login.
  if (isStaffEmployee(access)) {
    if (cookies().get("rt_staff_door_seen")?.value !== "1") {
      const profile = await getEmployerProfile(access.employerId!);
      const company = profile?.companyName || access.employerName || "your company";
      return <StaffWhichDoor company={company} />;
    }
    redirect("/employee");
  }
  if (canUseEmployerPortal(access)) redirect("/employer");
  redirect(`/candidate${upgrade}`);
}
