import { EMPTY_CLIP_FIELDS, type ClipFields } from "./tracker-core";

/**
 * Application Tracker — pure HTML/JSON-LD/meta extraction (Combined Build,
 * Section 2). Given raw HTML (already fetched by lib/safe-fetch.ts), returns
 * ONLY what the page actually exposes — no LLM embellishment, no guessing.
 * A field this module can't find comes back empty, per the spec's honesty
 * rule (lib/tracker-core.ts `EMPTY_CLIP_FIELDS`), so the UI can render the
 * "fill this in" affordance rather than a placeholder.
 *
 * Deliberately separate from `app/api/fetch-job-url/route.ts`'s own
 * extractor: that route returns one flattened text blob meant for the
 * tailoring prompt; this one returns structured, individually-honest fields
 * meant for a tracker card, and never falls back to an LLM pass (the spec's
 * "deterministic meta/JSON-LD parsing — no LLM embellishment of job facts in
 * v1" line).
 */

export interface ClipExtractionResult {
  fields: ClipFields;
  /** Raw capture for `tracked_applications.extracted_meta` — the JSON-LD
   *  block(s) and/or meta tags that were actually used, kept verbatim for
   *  audit. Empty object when nothing was found at all. */
  meta: Record<string, unknown>;
}

function stripTags(html: string): string {
  return html
    .replace(/<[^>]+>/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&nbsp;/g, " ")
    .replace(/&#\d+;/g, " ")
    .replace(/&[a-z]+;/g, " ")
    .replace(/\s{2,}/g, " ")
    .trim();
}

function findJsonLdJobPostings(html: string): Record<string, unknown>[] {
  const blocks = html.match(/<script[^>]+type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi) || [];
  const found: Record<string, unknown>[] = [];
  for (const block of blocks) {
    const raw = block.replace(/<script[^>]*>/i, "").replace(/<\/script>/i, "");
    try {
      const parsed = JSON.parse(raw);
      const candidates = Array.isArray(parsed) ? parsed : parsed?.["@graph"] && Array.isArray(parsed["@graph"]) ? parsed["@graph"] : [parsed];
      for (const obj of candidates) {
        if (obj && typeof obj === "object" && obj["@type"] === "JobPosting") found.push(obj as Record<string, unknown>);
      }
    } catch {
      /* not valid JSON — skip this block, keep scanning the rest of the page */
    }
  }
  return found;
}

function num(v: unknown): number | null {
  const n = typeof v === "string" ? Number(v) : typeof v === "number" ? v : NaN;
  return Number.isFinite(n) ? n : null;
}

function extractFromJsonLd(obj: Record<string, unknown>): ClipFields {
  const fields: ClipFields = { ...EMPTY_CLIP_FIELDS };

  if (typeof obj.title === "string" && obj.title.trim()) fields.jobTitle = obj.title.trim();

  const org = obj.hiringOrganization as { name?: string } | undefined;
  if (org?.name) fields.company = String(org.name).trim();

  if (obj.jobLocationType === "TELECOMMUTE") {
    fields.location = "Remote";
  } else {
    const loc = obj.jobLocation as { address?: Record<string, unknown> } | { address?: Record<string, unknown> }[] | undefined;
    const addr = Array.isArray(loc) ? loc[0]?.address : loc?.address;
    if (addr) {
      const parts = [addr.addressLocality, addr.addressRegion, addr.addressCountry].filter((p) => typeof p === "string" && p.trim());
      if (parts.length) fields.location = parts.join(", ");
    }
  }

  if (typeof obj.description === "string" && obj.description.trim()) {
    fields.description = stripTags(obj.description).slice(0, 8000);
  }

  const salary = obj.baseSalary as { value?: { minValue?: unknown; maxValue?: unknown; value?: unknown } } | undefined;
  const value = salary?.value;
  if (value) {
    const min = num(value.minValue);
    const max = num(value.maxValue);
    const flat = num(value.value);
    if (min !== null || max !== null) {
      fields.salaryMin = min;
      fields.salaryMax = max;
    } else if (flat !== null) {
      fields.salaryMin = flat;
      fields.salaryMax = flat;
    }
  }

  return fields;
}

/** og:/meta fallback when there's no (or an incomplete) JSON-LD JobPosting —
 *  only ever fills a field JSON-LD left empty; never overwrites a
 *  JSON-LD-sourced value. */
function fillFromMeta(html: string, fields: ClipFields, meta: Record<string, unknown>): void {
  const metaTag = (prop: string): string | null => {
    const re = new RegExp(`<meta[^>]+(?:property|name)=["']${prop}["'][^>]+content=["']([^"']*)["']`, "i");
    const m = re.exec(html);
    return m ? m[1].trim() : null;
  };
  if (!fields.jobTitle) {
    const ogTitle = metaTag("og:title") || (html.match(/<title[^>]*>([^<]*)<\/title>/i)?.[1] || "").trim();
    if (ogTitle) {
      fields.jobTitle = ogTitle;
      meta.ogTitle = ogTitle;
    }
  }
  if (!fields.company) {
    const siteName = metaTag("og:site_name");
    if (siteName) {
      fields.company = siteName;
      meta.ogSiteName = siteName;
    }
  }
  if (!fields.description) {
    const desc = metaTag("og:description") || metaTag("description");
    if (desc) {
      fields.description = desc.slice(0, 8000);
      meta.metaDescription = desc;
    }
  }
}

/** Main entry: given raw HTML already fetched by lib/safe-fetch.ts, return
 *  the honestly-filled fields plus the raw capture for audit. Every field
 *  this function cannot find stays empty — never a guess. */
export function extractJobFields(html: string): ClipExtractionResult {
  const postings = findJsonLdJobPostings(html);
  const meta: Record<string, unknown> = {};
  let fields: ClipFields = { ...EMPTY_CLIP_FIELDS };

  if (postings.length) {
    fields = extractFromJsonLd(postings[0]);
    meta.jsonLd = postings[0];
  }
  fillFromMeta(html, fields, meta);
  return { fields, meta };
}
