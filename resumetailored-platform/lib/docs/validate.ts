import type { CoverLetterDoc, ResumeDoc, Vacancy } from "./types";

/** Lower-case, strip punctuation + diacritics, collapse spaces — for tolerant comparison. */
export function norm(s: string): string {
  return (s || "")
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/&/g, " and ")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

const LEGAL_SUFFIX = /\b(pty ltd|pty limited|pty|ltd|limited|inc|incorporated|llc|llp|plc|corp|corporation|co|company|gmbh|group|holdings|australia|the)\b/g;
/** Employer name stripped of legal suffixes: "Acme Engineering Pty Ltd" → "acme engineering". */
export function coreName(s: string): string {
  return norm(s).replace(LEGAL_SUFFIX, " ").replace(/\s+/g, " ").trim();
}

function containsPhrase(haystack: string, needle: string): boolean {
  const h = ` ${norm(haystack)} `;
  const n = norm(needle);
  return !!n && h.includes(` ${n} `);
}

/** True when `text` names `employer` (full name, or its name without legal suffixes). */
export function mentionsEmployer(text: string, employer: string): boolean {
  return containsPhrase(text, employer) || (coreName(employer).length >= 2 && containsPhrase(text, coreName(employer)));
}

type Span = [start: number, end: number];

/** Every word-boundary occurrence of `needle` (already normalised) in `padded` (` ${norm(text)} `), as [start, end). */
function phraseSpans(padded: string, needle: string): Span[] {
  const spans: Span[] = [];
  if (!needle) return spans;
  const n = ` ${needle} `;
  for (let i = padded.indexOf(n); i !== -1; i = padded.indexOf(n, i + 1)) spans.push([i + 1, i + 1 + needle.length]);
  return spans;
}

/**
 * True when `text` names `employer` somewhere that is NOT wholly inside one of the `exclude` spans.
 * Used so "Smoke Test" (another vacancy) inside "Smoke Test Water Authority" (this vacancy) is not a mention of the
 * other company, while a separate "Smoke Test Co" elsewhere in the same letter still is. Containment is tested per
 * occurrence — nothing is deleted from the text, so a genuine mention that shares the target's words survives.
 */
function mentionsEmployerOutside(padded: string, employer: string, exclude: Span[]): boolean {
  const core = coreName(employer);
  const needles = [norm(employer), ...(core.length >= 2 ? [core] : [])];
  return needles.some((n) => phraseSpans(padded, n).some(([s, e]) => !exclude.some(([xs, xe]) => xs <= s && e <= xe)));
}

/* Words that say "qualification", not "who": dropped before comparing an org-looking name with a profile field, so
   "Civil Engineering" (the degree, as written in the letter) matches "Bachelor of Engineering (Civil)". */
const FIELD_STOPWORDS = new Set(
  "degree bachelor bachelors master masters phd doctor doctorate diploma advanced certificate cert graduate postgraduate undergraduate associate university college school institute tafe bsc msc ba ma bs ms be beng meng bcom mba hons honours honors of in and the from at with major minor".split(" ")
);
function fieldTokens(s: string): Set<string> {
  return new Set(norm(s).split(" ").filter((t) => t && !FIELD_STOPWORDS.has(t) && !MONTH_SET.has(t) && !/^\d+$/.test(t)));
}

/**
 * True when an org-looking name is the same words as one field of the profile, in any order
 * ("Civil Engineering" ↔ "Engineering (Civil)"). Fields are the profile's lines split on , | ; and " - ".
 * The token SETS must be equal (after stopwords), not merely overlap: "Harbour Pty Ltd" does not borrow the
 * exemption of "Harbour Infrastructure Pty Ltd", and "Coastal Engineering" cannot be assembled from two fields.
 */
function matchesProfileField(profile: string, name: string): boolean {
  const want = fieldTokens(name);
  if (!want.size) return false;
  return profile.split(/\n|[,|;]|\s[-–—]\s/).some((field) => {
    const have = fieldTokens(field);
    return have.size === want.size && Array.from(want).every((t) => have.has(t));
  });
}

export interface EmployerCheck {
  ok: boolean;
  problems: string[];
}

const ORG_SUFFIX = "(?:Pty\\.? Ltd\\.?|Pty|Ltd\\.?|Limited|Inc\\.?|LLC|LLP|PLC|Corp\\.?|Corporation|Group|Holdings|Co\\.|Company|Council|University|Department|Authority|Services|Solutions|Technologies|Engineering|Consulting|Partners)";
const ORG_RE = new RegExp(`\\b((?:[A-Z][\\w&'.-]*\\s+){0,4}[A-Z][\\w&'.-]*\\s+${ORG_SUFFIX})`, "g");
const APPLY_RE = /\b(?:join|joining|apply(?:ing)? (?:to|at|with)|role at|position at|opportunity at|work(?:ing)? (?:at|for)|team at|hire(?:d)? by)\s+((?:the\s+)?[A-Z][\w&'.-]*(?:\s+(?:of|and|&|[A-Z][\w&'.-]*)){0,4})/g;

/**
 * Employer gate for a cover letter. Passes only when (1) the letter names THIS vacancy's employer
 * and (2) it does not name a different company as the target. A different company counts when it is
 *  - one of `otherEmployers` (the user's other vacancies — the realistic source of a mix-up), or
 *  - an organisation-looking name (…Pty Ltd, …Council, …) in the letter that is neither this employer
 *    nor an employer in the candidate's own evidence (`profileText`), or
 *  - the object of "join / apply to / work at …" and not this employer or a past employer.
 */
export function checkEmployer(
  letter: Pick<CoverLetterDoc, "employer" | "paragraphs" | "salutation" | "signOff" | "position">,
  vacancy: Pick<Vacancy, "employer">,
  opts: { otherEmployers?: string[]; profileText?: string } = {}
): EmployerCheck {
  const problems: string[] = [];
  const body = [letter.salutation, ...letter.paragraphs, letter.signOff].join("\n");
  const target = vacancy.employer;

  if (!norm(target)) return { ok: false, problems: ["The vacancy has no employer name."] };
  if (letter.employer && !mentionsEmployer(letter.employer, target) && !mentionsEmployer(target, letter.employer)) {
    problems.push(`The letter's employer field is "${letter.employer}" but the vacancy is for "${target}".`);
  }
  if (!mentionsEmployer(body, target)) problems.push(`The letter never names "${target}".`);

  const profile = opts.profileText || "";
  const isTarget = (name: string) => {
    const a = coreName(name);
    const b = coreName(target);
    return !!a && !!b && a === b; // exact core-name match only: "Acme" and "Acme Mining" are different companies
  };

  /** True when `name`'s words are a leading or trailing run of the target's words ("Authority" of "… Water Authority"). */
  const targetTokens = norm(target).split(" ").filter(Boolean);
  const isTargetRun = (name: string) => {
    const t = norm(name).split(" ").filter(Boolean);
    if (!t.length || t.length > targetTokens.length) return false;
    const at = (off: number) => t.every((w, i) => targetTokens[off + i] === w);
    return at(0) || at(targetTokens.length - t.length);
  };

  // Where the letter names THIS employer (full name, and core name if it is long enough to be one).
  const paddedBody = ` ${norm(body)} `;
  const targetCore = coreName(target);
  const targetSpans = [...phraseSpans(paddedBody, norm(target)), ...(targetCore.length >= 2 ? phraseSpans(paddedBody, targetCore) : [])];

  for (const other of opts.otherEmployers || []) {
    if (!coreName(other) || isTarget(other)) continue;
    // A mention of `other` that sits inside a mention of the target ("Acme" inside "Acme Mining") is the target.
    if (mentionsEmployerOutside(paddedBody, other, targetSpans) && !mentionsEmployer(profile, other)) problems.push(`The letter names a different company, "${other}".`);
  }
  const seen = new Set<string>();
  const LEAD = /^(?:at|the|in|for|with|to|from|and|but|as|my|our|your|of|on|by|when|while|during|after|before|since|i|we)$/i;
  const flag = (raw: string, orgShaped = false) => {
    // Sentence-initial words ("At Harbour Infrastructure Pty Ltd") are not part of the company's name.
    const words = raw.trim().split(/\s+/);
    let start = 0;
    while (start < words.length - 1 && LEAD.test(words[start])) start++;
    // A possessive ("Authority's programme") is the company itself, not "… Authority S".
    const clean = words.slice(start).join(" ").replace(/[.,;:!?]+$/, "").replace(/['’]s$/i, "");
    const k = coreName(clean);
    if (!k || seen.has(k) || isTarget(clean) || mentionsEmployer(profile, clean)) return;
    if (orgShaped && matchesProfileField(profile, clean)) return; // e.g. a degree name ending in "Engineering"
    // "The Authority manages…" (sentence-initial, so ORG_RE caught "The Authority") is a short form of
    // "Smoke Test Water Authority". Full normalised tokens, not core names: "Authority Holdings" keeps "holdings"
    // and so is not a run of the target's words.
    if (orgShaped && isTargetRun(clean)) return;
    seen.add(k);
    problems.push(`The letter names a different company, "${clean}".`);
  };
  // Match per sentence so a name can never run across a full stop into the next sentence.
  const sentences = body.split(/(?<!\b(?:Mr|Mrs|Ms|Dr|St))[.!?]\s+(?=[A-Z])/);
  for (const sentence of sentences) {
    for (const m of Array.from(sentence.matchAll(ORG_RE))) flag(m[1], true);
    for (const m of Array.from(sentence.matchAll(APPLY_RE))) {
      const name = m[1].replace(/^the\s+/i, "");
      // A lone capitalised word after "join" is usually "join your team" / a person's team name, not a company.
      if (/\s/.test(name.trim()) || /(?:Pty|Ltd|Inc)/.test(name)) flag(name);
    }
  }
  return { ok: problems.length === 0, problems };
}

/* ───────────── "Nothing invented": compare output against the stored profile ───────────── */

const YEAR = /\b(?:19|20)\d{2}\b/g;
const MONTHS = "jan feb mar apr may jun jul aug sep sept oct nov dec january february march april june july august september october november december";
const MONTH_SET = new Set(MONTHS.split(" "));

function tokens(s: string): string[] {
  return norm(s).split(" ").filter((t) => t && !MONTH_SET.has(t) && !/^\d+$/.test(t));
}

/** Fraction of `needle`'s tokens present in `hay` (loose, so reworded titles like "Sr." still pass). */
function overlap(hay: string, needle: string): number {
  const h = new Set(tokens(hay));
  const n = tokens(needle);
  if (!n.length) return 1;
  return n.filter((t) => h.has(t)).length / n.length;
}

export interface ProfileFlag {
  field: "company" | "title" | "dates" | "education";
  value: string;
  message: string;
}

/**
 * Compare a generated resume against the candidate's stored evidence. Flags any employer, job title,
 * school or year that cannot be found in it. Deterministic; run before export.
 */
export function verifyResumeAgainstProfile(doc: ResumeDoc, profileText: string): ProfileFlag[] {
  const flags: ProfileFlag[] = [];
  const profile = profileText || "";
  const profileYears = new Set(profile.match(YEAR) || []);

  for (const e of doc.experience) {
    if (e.company && !(containsPhrase(profile, e.company) || overlap(profile, e.company) >= 0.99)) {
      flags.push({ field: "company", value: e.company, message: `Employer "${e.company}" is not in your career profile.` });
    }
    if (e.title && overlap(profile, e.title) < 0.6) {
      flags.push({ field: "title", value: e.title, message: `Job title "${e.title}" (${e.company}) is not in your career profile.` });
    }
    for (const y of e.dates.match(YEAR) || []) {
      if (!profileYears.has(y)) flags.push({ field: "dates", value: e.dates, message: `Date "${e.dates}" at ${e.company} uses ${y}, which is not in your career profile.` });
    }
  }
  for (const ed of doc.education) {
    if (ed.school && overlap(profile, ed.school) < 0.7) flags.push({ field: "education", value: ed.school, message: `School "${ed.school}" is not in your career profile.` });
    if (ed.degree && overlap(profile, ed.degree) < 0.5) flags.push({ field: "education", value: ed.degree, message: `Qualification "${ed.degree}" is not in your career profile.` });
    for (const y of (ed.dates || "").match(YEAR) || []) {
      if (!profileYears.has(y)) flags.push({ field: "dates", value: ed.dates || y, message: `Education year ${y} is not in your career profile.` });
    }
  }
  return flags;
}
