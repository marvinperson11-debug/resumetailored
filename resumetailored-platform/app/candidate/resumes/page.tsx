import { MyResumes } from "./my-resumes";

// Version-history page (FIX 8). This concrete route takes precedence over the
// catch-all placeholder for /candidate/resumes.
export const dynamic = "force-dynamic";

export default function MyResumesPage() {
  return <MyResumes />;
}
