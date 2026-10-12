import { auth } from "@clerk/nextjs/server";
import { getTranslations } from "next-intl/server";
import { getAccess } from "@/lib/plan";
import { jobPostingLimit } from "@/lib/employer-plan";
import { JobsClient } from "./jobs-client";
import { demoJobFor } from "../components/demo/demo-copy";

export const dynamic = "force-dynamic";

export default async function JobsPage({ searchParams }: { searchParams: { new?: string } }) {
  // Signed out = the anonymous employer taste: the one demo job post, passed in as a prop. Nothing real is read.
  const { userId } = await auth();
  if (!userId) {
    const td = await getTranslations("employerDemo");
    return <JobsClient openNew={searchParams?.new === "1"} demoJob={demoJobFor(td)} />;
  }
  const access = await getAccess();
  const limit = jobPostingLimit(access);
  return <JobsClient openNew={searchParams?.new === "1"} activeLimit={limit === Infinity ? null : limit} />;
}
