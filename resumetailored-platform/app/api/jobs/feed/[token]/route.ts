import { NextResponse } from "next/server";
import { randomUUID } from "node:crypto";
import { getEmployerIdByFeedToken, listIndeedFeedJobIds } from "@/lib/job-distribution-store";
import { getLivePublicJob, getEmployerProfile } from "@/lib/employer-store";
import { computeValidThrough } from "@/lib/job-posting-lifecycle";
import { addUtm, buildIndeedJobType, buildIndeedSalaryField, toIndeedExpirationDate } from "@/lib/job-distribution";
import { parseFeedLocation } from "@/lib/feed-location";
import { appUrl } from "@/lib/subdomain";

export const runtime = "nodejs";
// Canary probe (post-canary fix) found this GET handler being statically
// evaluated — Next's default caching for route handlers with no dynamic
// function/param usage. force-dynamic opts it out so every request re-reads
// job_distribution/job_postings instead of a build-time snapshot.
export const dynamic = "force-dynamic";

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
  // Live data — never cache below this line; freshness is verified per
  // deploy (see sitemap/feed liveness checklist).
  //
  // TEMPORARY-DIAGNOSTIC (runtime-snapshot probe, 4th round — remove once the
  // operator has confirmed live via the nonce below): per-request nonce +
  // server wall-clock timestamp, emitted as an XML comment. Same reading as
  // the sitemap route's copy: a frozen nonce implicates an upstream
  // response-level cache; an advancing nonce with a frozen job list
  // implicates the Supabase round trip instead.
  const diagNonce = randomUUID();
  const diagAt = new Date().toISOString();

  let companyName: string;
  let jobs: NonNullable<Awaited<ReturnType<typeof getLivePublicJob>>>[];
  try {
    const employerId = await getEmployerIdByFeedToken(params.token);
    if (!employerId) return NextResponse.json({ error: "not found" }, { status: 404 });

    const profile = await getEmployerProfile(employerId);
    companyName = profile?.companyName || "An employer";

    const jobIds = await listIndeedFeedJobIds(employerId);
    // getLivePublicJob re-checks status+public_listed server-side (the same
    // predicate the sitemap and the public job page use) rather than
    // fetching the raw row and re-checking isJobCurrentlyPublic() in JS —
    // one shared live-eligibility check instead of two that could diverge.
    jobs = (await Promise.all(jobIds.map((id) => getLivePublicJob(employerId, id)))).filter((j): j is NonNullable<typeof j> => !!j);
  } catch (e) {
    // Silent-fallback class, closed: a failed lookup/query used to resolve to
    // an empty jobs array and serve a confident 200 feed — indistinguishable
    // from "this employer has nothing to distribute". Fail loudly instead.
    console.error("[jobs/feed] Indeed feed failed — refusing to serve a possibly-empty/stale feed", params.token, e);
    return new NextResponse("feed temporarily unavailable", { status: 503, headers: { "Cache-Control": "no-store" } });
  }

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

  const xml = `<?xml version="1.0" encoding="UTF-8"?><!-- TEMPORARY-DIAGNOSTIC nonce=${diagNonce} generatedAt=${diagAt} --><source><publisher>${cdata("ResumeTailored")}</publisher><publisherurl>${cdata(appUrl())}</publisherurl>${items}</source>`;
  // Live data — never cache below this line (or in this response): the
  // previous `public, max-age=300` let any CDN/proxy sitting in front of
  // Railway serve a stale feed to Indeed's crawler for up to 5 minutes.
  // `no-store` matches the sitemap route; freshness is verified per deploy
  // (see sitemap/feed liveness checklist).
  return new NextResponse(xml, { headers: { "Content-Type": "application/xml; charset=utf-8", "Cache-Control": "no-store" } });
}
