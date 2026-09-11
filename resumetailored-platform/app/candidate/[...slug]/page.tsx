import { redirect } from "next/navigation";

// Every real candidate feature now has its own route (dashboard, resumes,
// applications, shareable-links, templates, profile, settings) or opens as a
// modal from the dashboard. Any other /candidate/* path is unknown, so send the
// user back to the dashboard rather than showing a placeholder.
export default function CandidateSectionPage() {
  redirect("/candidate");
}
