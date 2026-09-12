/**
 * LinkedIn data-export parsing (Feature B) — pure, no network, no AI. Handles
 * two inputs:
 *   - the CSV files from "Get a copy of your data" (Profile/Positions/Education/
 *     Skills.csv), passed as already-extracted text, and
 *   - a loosely-shaped JSON blob (our own shape, or common alternatives).
 * The ZIP is unpacked in the route (Node zlib); everything here is string-in.
 */

export interface LinkedInExperience {
  company: string;
  title: string;
  start: string;
  end: string;
  description: string;
}
export interface LinkedInEducation {
  school: string;
  degree: string;
  start: string;
  end: string;
}
export interface ParsedLinkedIn {
  name: string;
  headline: string;
  location: string;
  summary: string;
  experience: LinkedInExperience[];
  education: LinkedInEducation[];
  skills: string[];
}

export function emptyParsed(): ParsedLinkedIn {
  return { name: "", headline: "", location: "", summary: "", experience: [], education: [], skills: [] };
}

// ── CSV ───────────────────────────────────────────────────────────────────────
/** Minimal RFC-4180-ish CSV parser (handles quotes, escaped quotes, newlines). */
export function parseCsv(text: string): Record<string, string>[] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let inQuotes = false;
  const s = text.replace(/^﻿/, "").replace(/\r\n/g, "\n").replace(/\r/g, "\n");
  for (let i = 0; i < s.length; i++) {
    const ch = s[i];
    if (inQuotes) {
      if (ch === '"') {
        if (s[i + 1] === '"') { field += '"'; i++; } else inQuotes = false;
      } else field += ch;
    } else if (ch === '"') inQuotes = true;
    else if (ch === ",") { row.push(field); field = ""; }
    else if (ch === "\n") { row.push(field); rows.push(row); row = []; field = ""; }
    else field += ch;
  }
  if (field.length || row.length) { row.push(field); rows.push(row); }
  if (!rows.length) return [];
  const headers = rows[0].map((h) => h.trim());
  return rows.slice(1).filter((r) => r.some((c) => c.trim() !== "")).map((r) => {
    const obj: Record<string, string> = {};
    headers.forEach((h, idx) => (obj[h] = (r[idx] ?? "").trim()));
    return obj;
  });
}

const pick = (row: Record<string, string>, ...keys: string[]): string => {
  for (const k of keys) {
    const found = Object.keys(row).find((c) => c.toLowerCase() === k.toLowerCase());
    if (found && row[found]) return row[found];
  }
  return "";
};

/** Build a ParsedLinkedIn from the export's CSV files (any subset present). */
export function parseFromCsvFiles(files: { profile?: string; positions?: string; education?: string; skills?: string }): ParsedLinkedIn {
  const out = emptyParsed();

  if (files.profile) {
    const rows = parseCsv(files.profile);
    const p = rows[0] || {};
    const first = pick(p, "First Name", "firstName");
    const last = pick(p, "Last Name", "lastName");
    out.name = [first, last].filter(Boolean).join(" ").trim();
    out.headline = pick(p, "Headline");
    out.location = pick(p, "Geo Location", "Location");
    out.summary = pick(p, "Summary", "About");
  }

  if (files.positions) {
    out.experience = parseCsv(files.positions).map((r) => ({
      company: pick(r, "Company Name", "Company"),
      title: pick(r, "Title", "Position"),
      start: pick(r, "Started On", "Start Date"),
      end: pick(r, "Finished On", "End Date") || "Present",
      description: pick(r, "Description"),
    })).filter((e) => e.company || e.title).slice(0, 25);
  }

  if (files.education) {
    out.education = parseCsv(files.education).map((r) => ({
      school: pick(r, "School Name", "School"),
      degree: [pick(r, "Degree Name", "Degree"), pick(r, "Notes", "Field Of Study")].filter(Boolean).join(", "),
      start: pick(r, "Start Date", "Started On"),
      end: pick(r, "End Date", "Finished On"),
    })).filter((e) => e.school).slice(0, 15);
  }

  if (files.skills) {
    out.skills = parseCsv(files.skills).map((r) => pick(r, "Name", "Skill")).filter(Boolean).slice(0, 50);
  }

  return out;
}

// ── JSON ──────────────────────────────────────────────────────────────────────
const asStr = (v: unknown) => (typeof v === "string" ? v.trim() : "");
const asArr = (v: unknown) => (Array.isArray(v) ? v : []);

/** Parse a loosely-shaped JSON export (our shape or common variants). */
export function parseFromJson(raw: unknown): ParsedLinkedIn {
  const out = emptyParsed();
  if (!raw || typeof raw !== "object") return out;
  const r = raw as Record<string, unknown>;
  out.name = asStr(r.name) || [asStr(r.firstName), asStr(r.lastName)].filter(Boolean).join(" ");
  out.headline = asStr(r.headline) || asStr(r.title);
  out.location = asStr(r.location) || asStr(r.geoLocation);
  out.summary = asStr(r.summary) || asStr(r.about);

  const exp = asArr(r.experience).length ? asArr(r.experience) : asArr(r.positions);
  out.experience = exp.map((e) => {
    const o = (e || {}) as Record<string, unknown>;
    return {
      company: asStr(o.company) || asStr(o.companyName),
      title: asStr(o.title) || asStr(o.role) || asStr(o.position),
      start: asStr(o.start) || asStr(o.startDate) || asStr(o.startedOn),
      end: asStr(o.end) || asStr(o.endDate) || asStr(o.finishedOn) || "Present",
      description: asStr(o.description) || asStr(o.summary),
    };
  }).filter((e) => e.company || e.title).slice(0, 25);

  out.education = asArr(r.education).map((e) => {
    const o = (e || {}) as Record<string, unknown>;
    return {
      school: asStr(o.school) || asStr(o.schoolName),
      degree: asStr(o.degree) || asStr(o.degreeName) || asStr(o.fieldOfStudy),
      start: asStr(o.start) || asStr(o.startDate),
      end: asStr(o.end) || asStr(o.endDate),
    };
  }).filter((e) => e.school).slice(0, 15);

  const skills = asArr(r.skills);
  out.skills = skills.map((s) => (typeof s === "string" ? s : asStr((s as Record<string, unknown>)?.name))).filter(Boolean).slice(0, 50);

  return out;
}

/** Compose plain resume text from a parsed profile (seeds the resume builder). */
export function toResumeText(p: ParsedLinkedIn): string {
  const lines: string[] = [];
  if (p.name) lines.push(p.name);
  if (p.headline) lines.push(p.headline);
  if (p.location) lines.push(p.location);
  if (p.summary) lines.push("", "SUMMARY", p.summary);
  if (p.experience.length) {
    lines.push("", "EXPERIENCE");
    for (const e of p.experience) {
      lines.push(`${e.title}${e.company ? ` — ${e.company}` : ""}`.trim());
      const dates = [e.start, e.end].filter(Boolean).join(" – ");
      if (dates) lines.push(dates);
      if (e.description) lines.push(e.description);
      lines.push("");
    }
  }
  if (p.education.length) {
    lines.push("EDUCATION");
    for (const e of p.education) {
      lines.push(`${e.degree ? `${e.degree}, ` : ""}${e.school}`.trim());
      const dates = [e.start, e.end].filter(Boolean).join(" – ");
      if (dates) lines.push(dates);
    }
    lines.push("");
  }
  if (p.skills.length) {
    lines.push("SKILLS", p.skills.join(", "));
  }
  return lines.join("\n").trim();
}

export function hasContent(p: ParsedLinkedIn): boolean {
  return !!(p.name || p.headline || p.summary || p.experience.length || p.education.length || p.skills.length);
}
