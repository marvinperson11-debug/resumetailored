import { JobQueue } from "@/components/job-queue";

export default function DashboardPage() {
  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold">Job Queue</h1>
          <p className="text-sm text-muted-foreground">
            Add a posting, score your fit, prepare, then Apply to auto-fill the form.
          </p>
        </div>
      </div>
      <JobQueue />
    </div>
  );
}
