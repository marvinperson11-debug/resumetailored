import { JobsClient } from "./jobs-client";

export const dynamic = "force-dynamic";

export default function JobsPage({ searchParams }: { searchParams: { new?: string } }) {
  return <JobsClient openNew={searchParams?.new === "1"} />;
}
