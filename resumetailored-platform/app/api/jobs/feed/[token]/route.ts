import { NextResponse } from "next/server";
import { getEmployerIdByFeedToken, listIndeedFeedJobIds } from "@/lib/job-distribution-store";
import { getJob, getEmployerProfile } from "@/lib/employer-store";
import { isJobCurrentlyPublic } from "@/lib/job-posting-lifecycle";
import { addUtm } from "@/lib/job-distribution";
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
      const salary = job.salaryMin || job.salaryMax ? `<salary>${cdata(`${job.salaryMin || job.salaryMax} ${job.salaryCurrency} per ${job.salaryPeriod}`)}</salary>` : "";
      return [
        "<job>",
        `<title>${cdata(job.title)}</title>`,
        `<date>${date}</date>`,
        `<referencenumber>${job.id}</referencenumber>`,
        `<url>${cdata(jobUrl)}</url>`,
        `<company>${cdata(companyName)}</company>`,
        job.location ? `<city>${cdata(job.location)}</city>` : "",
        `<description>${cdata(job.description)}</description>`,
        salary,
        "</job>",
      ]
        .filter(Boolean)
        .join("");
    })
    .join("");

  const xml = `<?xml version="1.0" encoding="UTF-8"?><source><publisher>${cdata("ResumeTailored")}</publisher><publisherurl>${cdata(appUrl())}</publisherurl>${items}</source>`;
  return new NextResponse(xml, { headers: { "Content-Type": "application/xml; charset=utf-8", "Cache-Control": "public, max-age=300" } });
}
