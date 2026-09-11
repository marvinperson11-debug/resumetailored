import { getAccess } from "@/lib/plan";
import { requireEmployerId } from "@/lib/employer-auth";
import { getEmployerProfile } from "@/lib/employer-store";
import { SettingsClient } from "./settings-client";

export const dynamic = "force-dynamic";

export default async function SettingsPage() {
  const access = await getAccess();
  const employerId = await requireEmployerId();
  const profile = employerId ? await getEmployerProfile(employerId) : null;
  return (
    <SettingsClient
      canManage={access.plan === "employer"}
      tier={access.tier || null}
      initial={profile || { companyName: "", companyWebsite: "", industry: "", companySize: "" }}
    />
  );
}
