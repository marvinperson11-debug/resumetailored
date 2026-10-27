import { NextResponse } from "next/server";
import { randomUUID } from "node:crypto";
import { getEmployerIdByFeedToken, listZipRecruiterFeedJobIds } from "@/lib/job-distribution-store";
import { getLivePublicJob, getEmployerProfile } from "@/lib/employer-store";
import { addUtm, buildZipRecruiterJobType, buildZipRecruiterCompensationFields } from "@/lib/job-distribution";
import { parseFeedLocation } from "@/lib/feed-location";
import { appUrl } from "@/lib/subdomain";

export const runtime = "nodejs";
// Same lesson as the sibling Indeed feed route (jobs/feed/[token]): Next's
// default caching for a route handler with no dynamic function/param usage
// would serve a build-time snapshot instead of a live read. force-dynamic
// opts this route out of that, same as Indeed's and the sitemap's.
export const dynamic = "force-dynamic";

/** CDATA can't contain its own closing sequence — the one escape XML needs
 *  here, since every free-text value below is wrapped in CDATA rather than
 *  entity-escaped. Same helper as the Indeed feed route; kept local rather
 *  than shared, same as that route's own copy. */
function cdata(s: string): string {
  return `<![CDATA[${(s || "").replace(/]]>/g, "]] >")}]]>`;
}

/**
 * Public ZipRecruiter XML feed — sibling of the Indeed feed
 * (app/api/jobs/feed/[token]/route.ts), same employer-scoped, unguessable
 * token (employer_profiles.job_feed_token — the token is channel-agnostic,
 * so this route and the Indeed route share the same token/column rather than
 * minting a second one). Lists only jobs this employer turned the
 * ZipRecruiter-feed channel ON for (distribute_job) AND that are STILL
 * currently public — a job closed, or the channel turned off, after being
 * feed-included drops out here on its own, same mechanism as Indeed's feed,
 * because ZipRecruiter's own spec has no expiration field: omission from the
 * feed is the only way to remove a job from their index. This only produces
 * the FEED; getting it registered with ZipRecruiter is ZipRecruiter's own
 * manual-submission process (see lib/job-distribution.ts
 * buildZipRecruiterFeedInstructions) — nothing here claims a job is "posted
 * to ZipRecruiter".
 *
 * Field mapping verified against ZipRecruiter's live Feed Import
 * documentation (ziprecruiter.com/partner/documentation/feed-import/,
 * accessed 2026-10-26 — a continuously-updated Docusaurus page with no
 * "v1.9" or other version marker today, so this is the current spec
 * superseding any earlier v1.9 assumption): a `<source>` wrapping one or
 * more `<job>` tags; `<referencenumber>` is the job's own stable id (never
 * regenerated, so a re-render always matches the same job rather than
 * duplicating it); `<city>`/`<state>`/`<country>` come from the SAME shared
 * lib/feed-location.ts parser the Indeed feed uses (not a second parser);
 * `<jobtype>` is ZipRecruiter's own CLOSED set (Full-Time/Part-Time/
 * Contractor/Temporary/Per Diem/Other), unlike Indeed's open passthrough;
 * compensation is four separate elements
 * (compensation_min/max/interval/currency), not one dash-range string like
 * Indeed's `<salary>`, with currency required whenever either bound is
 * present; `<url>` is the apply link (ZipRecruiter's "Candidate Delivery"
 * field — redirects applicants rather than emailing them), UTM-tagged
 * utm_source=ziprecruiter; there is deliberately no expiration field of any
 * kind, per the doc's own "no expiration field" design (see module header).
 */
export async function GET(req: Request, { params }: { params: { token: string } }) {
  // Live data — never cache below this line; freshness is verified per
  // deploy (see sitemap/feed liveness checklist). ZipRecruiter's own doc
  // ("Feeds must provide all currently open jobs... Jobs not included in
  // your feed will be removed from your account") is exactly why this route
  // does NOT add an HTTP Cache-Control TTL: a cached/stale render of this
  // feed would read to ZipRecruiter as jobs having closed. Cache-Control is
  // `no-store`, matching the Indeed feed and the sitemap after the same
  // staleness bug was fixed there (see git history: "Fix sitemap + Indeed
  // feed serving build-time snapshots instead of live data").
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

    const jobIds = await listZipRecruiterFeedJobIds(employerId);
    // getLivePublicJob re-checks status+public_listed server-side (the same
    // predicate the sitemap and the public job page use) rather than
    // fetching the raw row and re-checking isJobCurrentlyPublic() in JS —
    // one shared live-eligibility check instead of two that could diverge.
    jobs = (await Promise.all(jobIds.map((id) => getLivePublicJob(employerId, id)))).filter((j): j is NonNullable<typeof j> => !!j);
  } catch (e) {
    // Silent-fallback class, closed: a failed lookup/query used to resolve to
    // an empty jobs array and serve a confident 200 feed — indistinguishable
    // from "this employer has nothing to distribute". Fail loudly instead.
    console.error("[jobs/ziprecruiter-feed] feed failed — refusing to serve a possibly-empty/stale feed", params.token, e);
    return new NextResponse("feed temporarily unavailable", { status: 503, headers: { "Cache-Control": "no-store" } });
  }

  const items = jobs
    .map((job) => {
      const jobUrl = addUtm(appUrl(`/jobs/${job.id}`), "ziprecruiter");
      const date = job.publishedAt ? new Date(job.publishedAt).toUTCString() : new Date(job.createdAt).toUTCString();
      const loc = parseFeedLocation(job.location);
      const jobType = buildZipRecruiterJobType(job.employmentType);
      const comp = buildZipRecruiterCompensationFields(job.salaryMin, job.salaryMax, job.salaryCurrency, job.salaryPeriod);
      return [
        "<job>",
        `<referencenumber>${job.id}</referencenumber>`,
        `<title>${cdata(job.title)}</title>`,
        `<company>${cdata(companyName)}</company>`,
        `<date>${date}</date>`,
        loc.city ? `<city>${cdata(loc.city)}</city>` : "",
        loc.state ? `<state>${cdata(loc.state)}</state>` : "",
        loc.country ? `<country>${cdata(loc.country)}</country>` : "",
        `<description>${cdata(job.description)}</description>`,
        `<url>${cdata(jobUrl)}</url>`,
        `<jobtype>${cdata(jobType)}</jobtype>`,
        comp.compensation_min !== undefined ? `<compensation_min>${comp.compensation_min}</compensation_min>` : "",
        comp.compensation_max !== undefined ? `<compensation_max>${comp.compensation_max}</compensation_max>` : "",
        comp.compensation_interval !== undefined ? `<compensation_interval>${comp.compensation_interval}</compensation_interval>` : "",
        comp.compensation_currency !== undefined ? `<compensation_currency>${comp.compensation_currency}</compensation_currency>` : "",
        "</job>",
      ]
        .filter(Boolean)
        .join("");
    })
    .join("");

  const xml = `<?xml version="1.0" encoding="UTF-8"?><!-- TEMPORARY-DIAGNOSTIC nonce=${diagNonce} generatedAt=${diagAt} --><source><publisher>${cdata("ResumeTailored")}</publisher><publisherurl>${cdata(appUrl())}</publisherurl>${items}</source>`;
  return new NextResponse(xml, { headers: { "Content-Type": "application/xml; charset=utf-8", "Cache-Control": "no-store" } });
}
