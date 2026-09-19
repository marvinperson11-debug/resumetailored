import { getAccess, isEmployer } from "@/lib/plan";
import { requireEmployerId } from "@/lib/employer-auth";
import { getEmployerProfile } from "@/lib/employer-store";
import { getCareerSiteCompanyName } from "@/lib/career-site-store";
import { SettingsClient } from "./settings-client";

export const dynamic = "force-dynamic";

export default async function SettingsPage() {
  const access = await getAccess();
  const employerId = await requireEmployerId();
  const [profile, careerName] = employerId
    ? await Promise.all([getEmployerProfile(employerId), getCareerSiteCompanyName(employerId)])
    : [null, ""];
  // Distinct known names for the company-name picker: the saved profile name and
  // the Career Site builder name (some employers operate under multiple names).
  const knownNames = Array.from(new Set([profile?.companyName, careerName].map((n) => (n || "").trim()).filter(Boolean)));
  // Editability = the workspace owner (plan "employer", whose Clerk id keys the
  // workspace) OR the platform admin. `isEmployer` is exactly that union, so an
  // invited employee stays read-only while the admin/owner can edit. Using
  // `plan === "employer"` alone locked the admin out (admin resolves to plan
  // "pro" + isAdmin), which is what left the whole page read-only.
  const canManage = isEmployer(access);
  return (
    <SettingsClient
      canManage={canManage}
      tier={access.tier || null}
      knownNames={knownNames}
      gate={{ plan: access.plan, isAdmin: !!access.isAdmin }}
      initial={profile || { companyName: careerName || "", companyWebsite: "", industry: "", companyBio: "" }}
    />
  );
}
