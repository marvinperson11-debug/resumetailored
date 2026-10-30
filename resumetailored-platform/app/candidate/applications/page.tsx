import { redirect } from "next/navigation";

// The hand-entry applications list is superseded by the Kanban tracker.
// middleware.ts already 301-redirects /candidate/applications ->
// /candidate/tracker before this route ever renders (see
// legacyApplicationsRedirectTarget) — this is a defense-in-depth fallback
// only, in case the middleware matcher is ever narrowed to exclude this path.
export default function ApplicationsPage() {
  redirect("/candidate/tracker");
}
