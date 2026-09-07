import { ApplicationTracker } from "./application-tracker";

// Full-page Application Tracker (concrete route overrides the catch-all
// placeholder for /candidate/applications).
export const dynamic = "force-dynamic";

export default function ApplicationsPage() {
  return <ApplicationTracker />;
}
