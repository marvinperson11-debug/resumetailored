import { auth } from "@clerk/nextjs/server";
import { getUserProfile, DEFAULT_PROFILE } from "@/lib/profile-store";
import { EmployeeSettingsClient } from "./settings-client";

export const dynamic = "force-dynamic";

/**
 * Employee-portal Settings. Deliberately trimmed vs. the candidate Settings:
 * staff have no billing relationship with us and this is their employer's managed
 * account, so only Notifications and Account (change password) are shown — no
 * Plan & billing, Appearance, Privacy, or Connected accounts. Lives under the
 * (portal) route group so it renders the employee shell + sidebar.
 */
export default async function EmployeeSettingsPage() {
  const { userId } = await auth();
  const profile = userId ? await getUserProfile(userId) : { ...DEFAULT_PROFILE };
  return <EmployeeSettingsClient initial={{ emailProduct: profile.emailProduct, emailTips: profile.emailTips }} />;
}
