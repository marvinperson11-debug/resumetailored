import { FeaturePlaceholder } from "@/components/coming-soon";

export const dynamic = "force-dynamic";

// Time off requests land in Phase 2 (Time). The nav item ships now so the portal
// shell is complete; this screen is a placeholder until then.
export default function EmployeeTimeOffPage() {
  return <FeaturePlaceholder feature="Time off" backHref="/employee" />;
}
