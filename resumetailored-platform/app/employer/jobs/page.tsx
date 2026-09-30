import { getAccess } from "@/lib/plan";
import { jobPostingLimit } from "@/lib/employer-plan";
import { JobsClient } from "./jobs-client";

export const dynamic = "force-dynamic";

export default async function JobsPage({ searchParams }: { searchParams: { new?: string } }) {
  const access = await getAccess();
  const limit = jobPostingLimit(access);
  return <JobsClient openNew={searchParams?.new === "1"} activeLimit={limit === Infinity ? null : limit} />;
}
