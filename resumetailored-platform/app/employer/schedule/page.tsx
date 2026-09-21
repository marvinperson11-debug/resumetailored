import { ScheduleGridClient } from "./schedule-grid-client";

export const dynamic = "force-dynamic";

/**
 * Employer shift scheduling — a weekly grid per employee. Distinct from
 * /employer/scheduler (video-interview scheduling); this one posts and
 * publishes work shifts.
 */
export default function EmployerSchedulePage() {
  return <ScheduleGridClient />;
}
