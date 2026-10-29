import { auth } from "@clerk/nextjs/server";
import { getTranslations } from "next-intl/server";
import { getAccess, resolveEmployerId } from "@/lib/plan";
import { jobPostingLimit } from "@/lib/employer-plan";
import { isFreeTier, getFreeTierState } from "@/lib/employer-free-tier";
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

  // Taylor v5 Fix, Section A: a grandfathered Free employer's snapshot
  // (free_tier_state.jobs_count, seeded at migration 0077 from however many
  // jobs they already had) can exceed the new cap of 1 — their meter must
  // show THAT total, never the new-cap denominator, or "3 of 11 jobs" reads
  // as "1 of 1". A fresh Free org has no snapshot (or one at/under the new
  // cap) and renders the ordinary meter exactly as before.
  let legacyTotal: number | null = null;
  if (limit !== Infinity && isFreeTier(access)) {
    const employerId = resolveEmployerId(access, userId);
    if (employerId) {
      const freeState = await getFreeTierState(employerId);
      if (freeState.jobsCount > limit) legacyTotal = freeState.jobsCount;
    }
  }

  return (
    <JobsClient
      openNew={searchParams?.new === "1"}
      activeLimit={limit === Infinity ? null : limit}
      legacyTotal={legacyTotal}
    />
  );
}
