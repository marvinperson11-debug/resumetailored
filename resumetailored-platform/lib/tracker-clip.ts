import { getPublicJob } from "./employer-store";
import { appUrl } from "./subdomain";
import { safeFetchHtml, SafeFetchError } from "./safe-fetch";
import { extractJobFields } from "./clip-extract";
import { createTrackedApplication, type TrackedApplication } from "./tracker-store";
import { EMPTY_CLIP_FIELDS, type ClipFields } from "./tracker-core";

/**
 * Application Tracker — clip orchestration (Combined Build, Section 2).
 * Shared by both clip paths that hit the server with a URL: paste-URL
 * (app/api/tracker/clip/route.ts) and the PWA share-target
 * (app/api/tracker/share-target/route.ts). Manual add (the third path) never
 * reaches this file — it goes straight to POST /api/tracker.
 */

export type ClipFailureCode = "bad_url" | "fetch_failed" | "login_required" | "not_html" | "too_large" | "timeout" | "save_failed";

export interface ClipResult {
  ok: boolean;
  code?: ClipFailureCode;
  message?: string;
  application?: TrackedApplication;
}

const SAFE_FETCH_MESSAGE: Record<string, string> = {
  login_required: "That page requires signing in to view — we couldn't read it. Add the application manually instead.",
  not_html: "That link didn't lead to a readable job posting page. Add the application manually instead.",
  too_large: "That page was too large to read. Add the application manually instead.",
  timeout: "That page took too long to respond. Add the application manually instead.",
};

/** True when a URL points at one of OUR OWN job posting pages — recognized
 *  by host + the `/jobs/:id` path shape, never by content sniffing. */
function ourJobId(rawUrl: string): number | null {
  let u: URL;
  try {
    u = new URL(rawUrl);
  } catch {
    return null;
  }
  const ourHost = new URL(appUrl()).hostname;
  const host = u.hostname.replace(/^www\./, "");
  const isOurHost = host === ourHost.replace(/^www\./, "") || host === "resumetailored.com" || host.endsWith(".resumetailored.com");
  if (!isOurHost) return null;
  const m = /^\/jobs\/(\d+)\/?$/.exec(u.pathname);
  if (!m) return null;
  const id = Number(m[1]);
  return Number.isFinite(id) ? id : null;
}

/** Clip ONE OF OUR OWN jobs — pulls the real, already-structured fields
 *  straight from `job_postings` rather than scraping the rendered page (the
 *  spec's "the fullest fill, still real data"). Returns null if the id
 *  doesn't resolve to a currently public job, so the caller can fall back to
 *  the generic external path rather than failing outright on, say, a job
 *  that's since been closed. */
async function clipOurJob(jobId: number): Promise<{ fields: ClipFields; meta: Record<string, unknown> } | null> {
  const job = await getPublicJob(jobId);
  if (!job) return null;
  const fields: ClipFields = {
    ...EMPTY_CLIP_FIELDS,
    jobTitle: job.title || "",
    company: job.company || "",
    location: job.remoteType === "remote" ? "Remote" : job.location || "",
    description: job.description || "",
    salaryMin: job.salaryMin ?? null,
    salaryMax: job.salaryMax ?? null,
  };
  return { fields, meta: { ourJobId: jobId } };
}

/** Clip from a candidate-supplied URL — resolves our-own-job first (real
 *  data, no fetch needed), else fetches the public page through the
 *  SSRF-guarded fetcher and runs the deterministic extractor. Always creates
 *  a "Clipped" card on success — even one with every field empty — because
 *  the clip itself (the card existing) is the useful part; the honesty rule
 *  only governs what each FIELD says, not whether the card gets created. */
export async function clipFromUrl(userId: string, rawUrl: string): Promise<ClipResult> {
  const trimmed = (rawUrl || "").trim();
  if (!trimmed) return { ok: false, code: "bad_url", message: "A URL is required." };

  const ownJobId = ourJobId(trimmed);
  if (ownJobId !== null) {
    const ours = await clipOurJob(ownJobId);
    if (ours) {
      const application = await createTrackedApplication(userId, {
        ...ours.fields,
        postingUrl: trimmed,
        source: "our_job",
        sourceJobId: ownJobId,
        stage: "Clipped",
        extractedMeta: ours.meta,
        lastVerifiedAt: new Date().toISOString(),
      });
      if (!application) return { ok: false, code: "save_failed", message: "Could not save this application." };
      return { ok: true, application };
    }
    // Fall through to the generic external path below — e.g. the job has
    // since been unpublished/closed, so there's nothing authoritative left
    // to pull from job_postings.
  }

  let html: string;
  try {
    const result = await safeFetchHtml(trimmed);
    html = result.html;
  } catch (err) {
    if (err instanceof SafeFetchError) {
      const code: ClipFailureCode = err.code === "login_required" || err.code === "not_html" || err.code === "too_large" || err.code === "timeout" ? err.code : "fetch_failed";
      return { ok: false, code, message: SAFE_FETCH_MESSAGE[err.code] || "We couldn't read that page — add the application manually instead." };
    }
    return { ok: false, code: "fetch_failed", message: "We couldn't read that page — add the application manually instead." };
  }

  const { fields, meta } = extractJobFields(html);
  const application = await createTrackedApplication(userId, {
    ...fields,
    postingUrl: trimmed,
    source: "clip_url",
    stage: "Clipped",
    extractedMeta: meta,
    lastVerifiedAt: new Date().toISOString(),
  });
  if (!application) return { ok: false, code: "save_failed", message: "Could not save this application." };
  return { ok: true, application };
}
