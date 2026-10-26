import { NextResponse } from "next/server";
import { getEmployerIdByFeedToken, listIndeedFeedJobIds } from "@/lib/job-distribution-store";
import { getJob, getEmployerProfile } from "@/lib/employer-store";
import { isJobCurrentlyPublic, computeValidThrough } from "@/lib/job-posting-lifecycle";
import { addUtm, buildIndeedJobType, buildIndeedSalaryField, toIndeedExpirationDate } from "@/lib/job-distribution";
import { parseFeedLocation } from "@/lib/feed-location";
import { appUrl } from "@/lib/subdomain";

export const runtime = "nodejs";

/** CDATA can't contain its own closing sequence — the one escape XML needs
 *  here, since every value below is otherwise wrapped in CDATA rather than
 *  entity-escaped. */
function cdata(s: string): string {
  return `<![CDATA[${(s || "").replace(/]]>/g, "]] >")}]]>`;
}

/**
 * Public Indeed XML feed (Kimi prompt v3) — one per employer, at an
 * unguessable path segment (employer_profiles.job_feed_token), same
 * public-readable shape every XML job feed needs. Lists only jobs this
 * employer turned the Indeed-feed channel ON for (distribute_job) AND that
 * are STILL currently public — a job closed after being feed-included drops
 * out here on its own, no separate write needed. This only produces the
 * FEED; getting it ingested into Indeed's own listings is Indeed's own
 * review process (see lib/job-distribution.ts's instructions artifact) —
 * nothing here claims a job is "posted to Indeed".
 *
 * Distribution Fix 2 (verified against docs.indeed.com/job-sync-xml/xml-feed,
 * accessed 2026-10-25) splits `location` (one free-text string) into
 * separate `<city>`/`<state>`/`<country>` via lib/feed-location.ts, adds
 * `<jobtype>` and `<expirationdate>` (the job's own computed validThrough,
 * date-only per the doc's example), and upgrades `<salary>` to a dash range
 * when both bounds exist. A location that doesn't parse still renders its
 * raw text as `<city>` (today's behavior) with no `<state>`/`<country>` —
 * get_distribution_status (lib/assistant-tools.ts) surfaces a notice for
 * that case so it's never silent.
 */
export async function GET(req: Request, { params }: { params: { token: string } }) {
  const employerId = await getEmployerIdByFeedToken(params.token);
  if (!employerId) return NextResponse.json({ error: "not found" }, { status: 404 });

  const profile = await getEmployerProfile(employerId);
  const companyName = profile?.companyName || "An employer";

  const jobIds = await listIndeedFeedJobIds(employerId);
  const jobs = (await Promise.all(jobIds.map((id) => getJob(employerId, id)))).filter((j): j is NonNullable<typeof j> => !!j && isJobCurrentlyPublic(j));

  const items = jobs
    .map((job) => {
      const jobUrl = addUtm(appUrl(`/jobs/${job.id}`), "indeed");
      const date = job.publishedAt ? new Date(job.publishedAt).toUTCString() : new Date(job.createdAt).toUTCString();
      const salaryValue = buildIndeedSalaryField(job.salaryMin, job.salaryMax, job.salaryCurrency, job.salaryPeriod);
      const salary = salaryValue ? `<salary>${cdata(salaryValue)}</salary>` : "";
      const loc = parseFeedLocation(job.location);
      const jobType = buildIndeedJobType(job.employmentType);
      const expirationDate = toIndeedExpirationDate(computeValidThrough(job.publishedAt, job.validThrough));
      return [
        "<job>",
        `<title>${cdata(job.title)}</title>`,
        `<date>${date}</date>`,
        `<referencenumber>${job.id}</referencenumber>`,
        `<url>${cdata(jobUrl)}</url>`,
        `<company>${cdata(companyName)}</company>`,
        loc.city ? `<city>${cdata(loc.city)}</city>` : "",
        loc.state ? `<state>${cdata(loc.state)}</state>` : "",
        loc.country ? `<country>${cdata(loc.country)}</country>` : "",
        `<description>${cdata(job.description)}</description>`,
        salary,
        jobType ? `<jobtype>${cdata(jobType)}</jobtype>` : "",
        expirationDate ? `<expirationdate>${expirationDate}</expirationdate>` : "",
        "</job>",
      ]
        .filter(Boolean)
        .join("");
    })
    .join("");

  // TEMPORARY-DIAGNOSTIC: serving-layer canary (remove after probe — see
  // commit "TEMPORARY-DIAGNOSTIC: serving-layer canary (revert after probe)").
  // TODO: delete this line.
  const canaryComment = `<!-- canary:${process.env.RAILWAY_DEPLOYMENT_ID || "unknown"} -->`;
  const xml = `<?xml version="1.0" encoding="UTF-8"?><source><publisher>${cdata("ResumeTailored")}</publisher><publisherurl>${cdata(appUrl())}</publisherurl>${items}${canaryComment}</source>`;
  return new NextResponse(xml, { headers: { "Content-Type": "application/xml; charset=utf-8", "Cache-Control": "public, max-age=300" } });
}
