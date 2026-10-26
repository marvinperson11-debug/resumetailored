/**
 * US location-string parser for the Indeed Job Sync XML feed (Distribution
 * Fix 2) — pure, no DB, no network, no LLM. `job_postings.location` is one
 * free-text string an employer typed (e.g. "LaGrange, GA"), but Indeed's
 * feed wants city/state/country as separate elements
 * (docs.indeed.com/job-sync-xml/xml-feed — <city>/<state>/<country> are each
 * "Required", <state> as a USPS postal abbreviation, or the matching
 * province/region outside the US).
 *
 * This never guesses past what it can verify against a real US state table:
 * a string that doesn't match one of the patterns below comes back with the
 * ORIGINAL raw text as `city` and `unparseable: true` (today's behavior —
 * the feed still renders a `<city>`, just not a separately-matched
 * state/country), so the caller can flag it for the status surface instead
 * of silently losing the job's location.
 *
 * Remote handling follows the same doc's XML feed FAQ, not the pattern this
 * file's own prompt first assumed: Indeed wants the literal string "remote"
 * IN <city> or <state> (not both fields blank) — "enter 'remote' in one
 * element and leave the other blank. Do not enter 'remote' in one element
 * and a real location in the other."
 */

export interface ParsedFeedLocation {
  city: string;
  state?: string;
  country?: string;
  remote: boolean;
  unparseable: boolean;
}

/** USPS state/territory abbreviations Indeed's <state> element accepts for US jobs. */
const US_STATE_ABBR = new Set([
  "AL", "AK", "AZ", "AR", "CA", "CO", "CT", "DE", "FL", "GA", "HI", "ID", "IL", "IN", "IA", "KS", "KY", "LA", "ME", "MD",
  "MA", "MI", "MN", "MS", "MO", "MT", "NE", "NV", "NH", "NJ", "NM", "NY", "NC", "ND", "OH", "OK", "OR", "PA", "RI", "SC",
  "SD", "TN", "TX", "UT", "VT", "VA", "WA", "WV", "WI", "WY", "DC", "PR", "VI", "GU", "AS", "MP",
]);

/** Full state/territory name (lowercase) -> USPS abbreviation. */
const US_STATE_NAME_TO_ABBR: Record<string, string> = {
  alabama: "AL", alaska: "AK", arizona: "AZ", arkansas: "AR", california: "CA", colorado: "CO",
  connecticut: "CT", delaware: "DE", florida: "FL", georgia: "GA", hawaii: "HI", idaho: "ID",
  illinois: "IL", indiana: "IN", iowa: "IA", kansas: "KS", kentucky: "KY", louisiana: "LA",
  maine: "ME", maryland: "MD", massachusetts: "MA", michigan: "MI", minnesota: "MN",
  mississippi: "MS", missouri: "MO", montana: "MT", nebraska: "NE", nevada: "NV",
  "new hampshire": "NH", "new jersey": "NJ", "new mexico": "NM", "new york": "NY",
  "north carolina": "NC", "north dakota": "ND", ohio: "OH", oklahoma: "OK", oregon: "OR",
  pennsylvania: "PA", "rhode island": "RI", "south carolina": "SC", "south dakota": "SD",
  tennessee: "TN", texas: "TX", utah: "UT", vermont: "VT", virginia: "VA", washington: "WA",
  "west virginia": "WV", wisconsin: "WI", wyoming: "WY", "district of columbia": "DC",
  "puerto rico": "PR", "virgin islands": "VI", guam: "GU", "american samoa": "AS",
  "northern mariana islands": "MP",
};

const REMOTE_RE = /^(fully\s+remote|100%\s*remote|remote\s*work|remote|work[\s-]?from[\s-]?home|wfh)$/i;
/** "City, ST" or "City, ST ZIP" / "City, ST ZIP-ZIP4" — the zip is matched (so it doesn't leak into `state`) and discarded. */
const CITY_STATE_ABBR_RE = /^(.+?),\s*([A-Za-z]{2})(?:\s+\d{5}(?:-\d{4})?)?$/;
/** "City, Full State Name" */
const CITY_STATE_NAME_RE = /^(.+?),\s*([A-Za-z][A-Za-z.\s]+)$/;

export function parseFeedLocation(raw: string | null | undefined): ParsedFeedLocation {
  const input = (raw || "").trim();
  if (!input) return { city: "", remote: false, unparseable: false };
  if (REMOTE_RE.test(input)) return { city: "remote", remote: true, unparseable: false };

  const abbrMatch = input.match(CITY_STATE_ABBR_RE);
  if (abbrMatch) {
    const city = abbrMatch[1].trim();
    const state = abbrMatch[2].toUpperCase();
    if (city && US_STATE_ABBR.has(state)) return { city, state, country: "US", remote: false, unparseable: false };
  }

  const nameMatch = input.match(CITY_STATE_NAME_RE);
  if (nameMatch) {
    const city = nameMatch[1].trim();
    const abbr = US_STATE_NAME_TO_ABBR[nameMatch[2].trim().toLowerCase()];
    if (city && abbr) return { city, state: abbr, country: "US", remote: false, unparseable: false };
  }

  return { city: input, remote: false, unparseable: true };
}

/** Shared notice text (Distribution Fix 2) — the exact string both
 *  get_distribution_status and distribute_job's approval card surface for a
 *  feed-included job whose location didn't parse, so the two call sites can
 *  never drift apart. */
export const FEED_LOCATION_UNPARSEABLE_NOTICE = 'Location not in "City, ST" format — Indeed visibility limited.';
