import { getAccess } from "@/lib/plan";
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
  return (
    <SettingsClient
      canManage={access.plan === "employer"}
      tier={access.tier || null}
      knownNames={knownNames}
      initial={profile || { companyName: careerName || "", companyWebsite: "", industry: "", companyBio: "" }}
    />
  );
}
