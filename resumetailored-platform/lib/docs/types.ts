/** Structured document models. The LLM returns JSON in these shapes; the renderer never sees raw model text. */

export interface ExperienceEntry {
  title: string;
  company: string;
  dates: string;
  location?: string;
  bullets: string[];
}
export interface EducationEntry {
  degree: string;
  school: string;
  dates?: string;
}
export interface ResumeDoc {
  name: string;
  /** Contact items (city, phone, email, links the candidate supplied), rendered on one centred line. */
  contact: string[];
  summary: string;
  experience: ExperienceEntry[];
  skills: string[];
  education: EducationEntry[];
  certifications?: string[];
  /** Any other section the candidate's resume had (Projects, Awards …), kept so nothing is dropped. */
  extraSections?: { title: string; lines: string[] }[];
}

export interface SenderBlock {
  name: string;
  contact: string[];
}
export interface CoverLetterDoc {
  sender: SenderBlock;
  /** ISO or human date; the renderer fills today's date when empty. */
  date?: string;
  employer: string;
  employerAddress?: string[];
  position: string;
  salutation: string;
  paragraphs: string[];
  signOff: string;
}

export interface CriterionResponse {
  criterion: string;
  situation: string;
  task: string;
  action: string;
  result: string;
}
export interface SelectionCriteriaDoc {
  name: string;
  contact: string[];
  position: string;
  employer?: string;
  responses: CriterionResponse[];
}

/** The vacancy a run is for. Always read fresh from the database by id. */
export interface Vacancy {
  id: string;
  employer: string;
  position: string;
  description: string;
  employerAddress?: string[];
}

export type DocKind = "resume" | "cover_letter" | "selection_criteria";

const str = (v: unknown): string => (typeof v === "string" ? v.replace(/\s+/g, " ").trim() : typeof v === "number" ? String(v) : "");
const strs = (v: unknown): string[] => (Array.isArray(v) ? v.map(str).filter(Boolean) : typeof v === "string" && v.trim() ? [str(v)] : []);

/** Pull the first JSON object out of a model reply (tolerates code fences and stray prose). */
export function extractJson(text: string): unknown {
  const t = (text || "").trim();
  const fenced = /```(?:json)?\s*([\s\S]*?)```/i.exec(t);
  const body = fenced ? fenced[1] : t;
  const start = body.indexOf("{");
  const end = body.lastIndexOf("}");
  if (start < 0 || end <= start) throw new Error("no_json");
  return JSON.parse(body.slice(start, end + 1));
}

export function coerceResumeDoc(raw: unknown): ResumeDoc {
  const r = (raw || {}) as Record<string, unknown>;
  const exp = Array.isArray(r.experience) ? r.experience : [];
  const edu = Array.isArray(r.education) ? r.education : [];
  const doc: ResumeDoc = {
    name: str(r.name),
    contact: strs(r.contact),
    summary: str(r.summary),
    experience: exp
      .map((e) => {
        const x = (e || {}) as Record<string, unknown>;
        return { title: str(x.title), company: str(x.company), dates: str(x.dates), location: str(x.location) || undefined, bullets: strs(x.bullets) };
      })
      .filter((e) => e.title || e.company),
    skills: strs(r.skills),
    education: edu
      .map((e) => {
        const x = (e || {}) as Record<string, unknown>;
        return { degree: str(x.degree), school: str(x.school), dates: str(x.dates) || undefined };
      })
      .filter((e) => e.degree || e.school),
    certifications: strs(r.certifications),
  };
  if (!doc.name) throw new Error("resume_missing_name");
  if (!doc.experience.length && !doc.education.length) throw new Error("resume_empty");
  return doc;
}

export function coerceCoverLetterDoc(raw: unknown): CoverLetterDoc {
  const r = (raw || {}) as Record<string, unknown>;
  const s = (r.sender || {}) as Record<string, unknown>;
  const doc: CoverLetterDoc = {
    sender: { name: str(s.name) || str(r.name), contact: strs(s.contact ?? r.contact) },
    date: str(r.date) || undefined,
    employer: str(r.employer),
    employerAddress: strs(r.employerAddress),
    position: str(r.position),
    salutation: str(r.salutation) || "Dear Hiring Manager,",
    paragraphs: strs(r.paragraphs),
    signOff: str(r.signOff) || "Sincerely,",
  };
  if (!doc.paragraphs.length) throw new Error("letter_empty");
  return doc;
}

export function coerceSelectionCriteriaDoc(raw: unknown): SelectionCriteriaDoc {
  const r = (raw || {}) as Record<string, unknown>;
  const resp = Array.isArray(r.responses) ? r.responses : [];
  const doc: SelectionCriteriaDoc = {
    name: str(r.name),
    contact: strs(r.contact),
    position: str(r.position),
    employer: str(r.employer) || undefined,
    responses: resp
      .map((e) => {
        const x = (e || {}) as Record<string, unknown>;
        return { criterion: str(x.criterion), situation: str(x.situation), task: str(x.task), action: str(x.action), result: str(x.result) };
      })
      .filter((e) => e.criterion),
  };
  if (!doc.responses.length) throw new Error("criteria_empty");
  return doc;
}
