import { OnboardingClient } from "./onboarding-client";

export const dynamic = "force-dynamic";

/** The new hire's own onboarding page (prompt item 3): checklist they can
 *  act on (not just read), the paperwork packet (ID upload, I-9, direct
 *  deposit, W-4, handbook acknowledgment), and the first-week schedule —
 *  all read from the plan/paperwork their employer set up, never generated
 *  by this page. */
export default function EmployeeOnboardingPage() {
  return <OnboardingClient />;
}
