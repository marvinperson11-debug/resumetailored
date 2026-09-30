import type { ActivityEntry } from "./employer-store";

/** Minimal shapes of next-intl's translator/formatter, so this stays a pure
 *  function that the server page and the tests can both call. */
type T = (key: string, values?: Record<string, string | number>) => string;
type Fmt = { dateTime: (d: Date, o: { dateStyle: "medium"; timeZone: string }) => string };

/** Turn a structured entry into the viewer's language. Dates go through Intl
 *  (UTC, so a bare YYYY-MM-DD never slides a day); names, job titles and emails
 *  are user data and pass through untouched. */
export function describeActivity(entry: ActivityEntry, t: T, format: Fmt): { text: string; meta?: string } {
  const p = entry.params;
  const due = p.due ? format.dateTime(new Date(p.due.length === 10 ? `${p.due}T00:00:00Z` : p.due), { dateStyle: "medium", timeZone: "UTC" }) : "";
  switch (entry.event) {
    case "applicant":
      return {
        text: t("activity.applicant", { job: p.job ?? t("activity.fallbackRole") }),
        meta: p.score != null ? t("activity.applicantMeta", { name: p.name ?? "", score: p.score }) : (p.name ?? undefined),
      };
    case "expiring":
      return { text: t("activity.expiring", { job: p.job ?? "" }), meta: t("activity.closes", { date: due }) };
    case "teamJoined":
      return { text: t("activity.teamJoined"), meta: p.email ?? undefined };
    case "trainingSigned":
      return { text: t("activity.trainingSigned", { doc: p.doc ?? t("activity.fallbackDoc") }), meta: p.name ?? t("activity.fallbackEmployee") };
    case "trainingOverdue":
      return {
        text: t("activity.trainingOverdue", { doc: p.doc ?? t("activity.fallbackDoc") }),
        meta: t("activity.overdueMeta", { name: p.name ?? t("activity.fallbackEmployee"), date: due }),
      };
  }
}

