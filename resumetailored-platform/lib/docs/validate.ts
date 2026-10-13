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
    return !!a && !!b && (a === b || a.includes(b) || b.includes(a));
  };

  for (const other of opts.otherEmployers || []) {
    if (!coreName(other) || isTarget(other)) continue;
    if (mentionsEmployer(body, other) && !mentionsEmployer(profile, other)) problems.push(`The letter names a different company, "${other}".`);
  }
  const seen = new Set<string>();
  const LEAD = /^(?:at|the|in|for|with|to|from|and|but|as|my|our|your|of|on|by|when|while|during|after|before|since|i|we)$/i;
  const flag = (name: string) => {
    const words = name.trim().split(/\s+/);
    // A sentence-initial word ("At Harbour Infrastructure Pty Ltd") is not part of the company's name:
    // if ANY trailing run of the words is this employer or one of the candidate's own, it is fine.
    for (let i = 0; i < words.length - 1 || i === 0; i++) {
      const phrase = words.slice(i).join(" ");
      if (isTarget(phrase) || mentionsEmployer(profile, phrase)) return;
      if (i >= words.length - 1) break;
    }
    let start = 0;
    while (start < words.length - 1 && LEAD.test(words[start])) start++;
    const clean = words.slice(start).join(" ");
    const k = coreName(clean);
    if (!k || seen.has(k)) return;
    seen.add(k);
    problems.push(`The letter names a different company, "${clean}".`);
  };
  for (const m of Array.from(body.matchAll(ORG_RE))) flag(m[1]);
  for (const m of Array.from(body.matchAll(APPLY_RE))) {
    const name = m[1].replace(/^the\s+/i, "");
    // A lone capitalised word after "join" is usually "join your team" / a person's team name, not a company.
    if (/\s/.test(name.trim()) || /(?:Pty|Ltd|Inc)/.test(name)) flag(name);
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
