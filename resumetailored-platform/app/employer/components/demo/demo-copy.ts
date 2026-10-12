import { DEMO_CANDIDATES, buildDemoCandidates, buildDemoJob, type DemoJobText } from "@/lib/employer-demo";

/** The minimal shape of next-intl's server translator, so this stays callable from the pages and the tests. */
type T = (key: string) => string;

/** The demo job post in the viewer's language. The facts are fixtures (lib/employer-demo.ts); the words are `employerDemo.job.*`. */
export function demoJobText(t: T): DemoJobText {
  return {
    title: t("job.title"),
    department: t("job.department"),
    location: t("job.location"),
    description: t("job.description"),
    benefits: t("job.benefits"),
    requirements: [t("job.req1"), t("job.req2"), t("job.req3")],
  };
}

export function demoJobFor(t: T, now?: number) {
  return buildDemoJob(demoJobText(t), now);
}

export function demoCandidatesFor(t: T, now?: number) {
  return buildDemoCandidates(Object.fromEntries(DEMO_CANDIDATES.map((c) => [c.key, t(`candidates.${c.key}`)])), now);
}
