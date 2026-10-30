import { TrackerBoard } from "./tracker-board";

// Full-page Application Tracker Kanban board (Combined Build, Sections 1/2/4)
// — concrete route overrides the catch-all placeholder for /candidate/tracker.
// This is the ONE tracker surface (Section F): the older hand-entry list at
// /candidate/applications is superseded, 301-redirected here by middleware.ts,
// and read-only from app code — see lib/legacy-migration-map.ts.
export const dynamic = "force-dynamic";

export default function TrackerPage() {
  return <TrackerBoard />;
}
