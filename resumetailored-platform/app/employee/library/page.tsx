import { FeaturePlaceholder } from "@/components/coming-soon";

export const dynamic = "force-dynamic";

// Employee self-serve Training Library (self-assign) lands in Phase 3. The nav
// item ships now so the shell is complete.
export default function EmployeeLibraryPage() {
  return <FeaturePlaceholder feature="Library" backHref="/employee" />;
}
