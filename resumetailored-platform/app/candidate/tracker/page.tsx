import { TrackerBoard } from "./tracker-board";

// Full-page Application Tracker Kanban board (Combined Build, Sections 1/2/4)
// — concrete route overrides the catch-all placeholder for /candidate/tracker.
// Distinct from /candidate/applications (the older, simpler list view, left
// untouched); see lib/tracker-core.ts's header comment for why both exist.
export const dynamic = "force-dynamic";

export default function TrackerPage() {
  return <TrackerBoard />;
}
