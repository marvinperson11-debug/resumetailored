import { FeaturePlaceholder } from "@/components/coming-soon";

export const dynamic = "force-dynamic";

// The employee-facing training + acknowledgment view (assigned docs, quizzes)
// lands in Phase 3. The nav item ships now so the shell is complete.
export default function EmployeeTrainingPage() {
  return <FeaturePlaceholder feature="My training" backHref="/employee" />;
}
