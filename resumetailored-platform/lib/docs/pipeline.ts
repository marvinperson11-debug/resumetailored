import { renderCoverLetterDocx, renderResumeDocx, renderSelectionCriteriaDocx } from "./docx-render";
import { coverLetterSystem, coverLetterUser, resumeSystem, resumeUser, selectionCriteriaSystem, selectionCriteriaUser } from "./prompts";
import { findBanned, scrubDeep } from "./scrub";
import {
  coerceCoverLetterDoc, coerceResumeDoc, coerceSelectionCriteriaDoc, extractJson,
  type CoverLetterDoc, type ResumeDoc, type SelectionCriteriaDoc, type Vacancy,
} from "./types";
import { checkEmployer, norm, verifyResumeAgainstProfile, type ProfileFlag } from "./validate";

/**
 * The single-run engine. One vacancy + one career profile in, validated structured documents (and .docx
 * buffers) out. The batch endpoint calls exactly this per vacancy — there is no second pipeline.
 * The model is injected (`Llm`) so tests run it offline.
 */
export type Llm = (a: { system: string; user: string; maxTokens: number }) => Promise<string>;

export class GenerationError extends Error {
  constructor(public code: "employer_mismatch" | "bad_output" | "banned_content", message: string, public problems: string[] = []) {
    super(message);
  }
}

const MAX_TOKENS = 4096;

/** Ask for JSON, parse + coerce it; one retry if the reply is not usable. */
async function callDoc<T>(llm: Llm, system: string, userFor: (correction: string) => string, coerce: (raw: unknown) => T): Promise<T> {
  let correction = "";
  for (let attempt = 0; attempt < 2; attempt++) {
    const reply = await llm({ system, user: userFor(correction), maxTokens: MAX_TOKENS });
    try {
      return coerce(extractJson(reply));
    } catch (e) {
      correction = `the reply was not valid JSON in the required shape (${e instanceof Error ? e.message : "parse error"}). Return only the JSON object.`;
    }
  }
  throw new GenerationError("bad_output", "The document could not be generated in a usable form. Please try again.");
}

/** Keep only contact items the candidate actually supplied — never invent a phone number or address. */
function groundedContact(items: string[], profileText: string): string[] {
  const p = norm(profileText);
  return items.filter((i) => p.includes(norm(i)) || (i.includes("@") && profileText.toLowerCase().includes(i.toLowerCase())));
}

function finish<T>(doc: T, allowFrom: string): T {
  const clean = scrubDeep(doc, allowFrom);
  const left = findBanned(JSON.stringify(clean), allowFrom);
  if (left.length) throw new GenerationError("banned_content", "Generated text still contained banned branding.", left);
  return clean;
}

/* ─────────────── Resume ─────────────── */

export interface ResumeResult {
  doc: ResumeDoc;
  /** Employers/titles/dates/schools not found in the career profile. Non-empty = needs review before export. */
  flags: ProfileFlag[];
}

export async function generateResume(a: { vacancy: Vacancy; profileText: string; llm: Llm; prefs?: string }): Promise<ResumeResult> {
  const { vacancy, profileText, llm } = a;
  const allow = `${profileText}\n${vacancy.description}`;
  const build = async (correction: string): Promise<ResumeResult> => {
    let doc = await callDoc(llm, resumeSystem(), () => resumeUser(vacancy, profileText, a.prefs, correction), coerceResumeDoc);
    doc = finish({ ...doc, contact: groundedContact(doc.contact, profileText) }, allow);
    return { doc, flags: verifyResumeAgainstProfile(doc, profileText) };
  };
  let res = await build("");
  if (res.flags.length) {
    const msg = `these details are not in the candidate evidence and must be removed or replaced with what the evidence says: ${res.flags.map((f) => f.message).join(" ")}`;
    res = await build(msg);
  }
  return res;
}

/* ─────────────── Cover letter ─────────────── */

export async function generateCoverLetter(a: {
  vacancy: Vacancy;
  profileText: string;
  llm: Llm;
  otherEmployers?: string[];
  prefs?: string;
  senderFallback?: { name: string; contact: string[] };
}): Promise<CoverLetterDoc> {
  const { vacancy, profileText, llm } = a;
  const allow = `${profileText}\n${vacancy.description}`;
  let problems: string[] = [];
  let correction = "";
  // First attempt, then ONE retry with an explicit correction. Never exported if the second also fails.
  for (let attempt = 0; attempt < 2; attempt++) {
    const raw = await callDoc(llm, coverLetterSystem(), () => coverLetterUser(vacancy, profileText, a.prefs, correction), coerceCoverLetterDoc);
    const check = checkEmployer(raw, vacancy, { otherEmployers: a.otherEmployers, profileText });
    if (check.ok) {
      const sender = {
        name: norm(profileText).includes(norm(raw.sender.name)) && raw.sender.name ? raw.sender.name : a.senderFallback?.name || raw.sender.name,
        contact: groundedContact(raw.sender.contact, profileText),
      };
      // The vacancy record, not the model, is the authority for who the letter is addressed to.
      const doc = finish<CoverLetterDoc>(
        { ...raw, sender: { ...sender, contact: sender.contact.length ? sender.contact : a.senderFallback?.contact || [] }, employer: vacancy.employer, position: vacancy.position, employerAddress: vacancy.employerAddress },
        allow
      );
      // Scrubbing must not have removed the employer's name from the body.
      const recheck = checkEmployer(doc, vacancy, { otherEmployers: a.otherEmployers, profileText });
      if (recheck.ok) return doc;
      problems = recheck.problems;
    } else {
      problems = check.problems;
    }
    correction = `${problems.join(" ")} The employer is "${vacancy.employer}" and the position is "${vacancy.position}". Name that employer, and no other company as the one being applied to. Do not use any other employer's name.`;
  }
  throw new GenerationError("employer_mismatch", `The cover letter did not name the right employer ("${vacancy.employer}"), so it was not exported.`, problems);
}

/* ─────────────── Selection criteria ─────────────── */

const words = (s: string) => s.split(/\s+/).filter(Boolean).length;

export async function generateSelectionCriteria(a: {
  position: string; employer?: string; criteria: string[]; profileText: string; llm: Llm;
  senderFallback?: { name: string; contact: string[] };
}): Promise<SelectionCriteriaDoc> {
  const criteria = a.criteria.map((c) => c.trim()).filter(Boolean);
  const allow = a.profileText;
  const raw = await callDoc(a.llm, selectionCriteriaSystem(), () => selectionCriteriaUser({ position: a.position, employer: a.employer, criteria }, a.profileText), coerceSelectionCriteriaDoc);
  const none = "No matching evidence in your career profile — add an example before submitting.";
  const responses = criteria.map((criterion, i) => {
    const found = raw.responses.find((r) => norm(r.criterion) === norm(criterion)) || raw.responses[i];
    if (!found || (!found.situation && !found.task && !found.action && !found.result)) return { criterion, situation: found?.situation || none, task: "", action: "", result: "" };
    return { ...found, criterion };
  });
  const doc = finish<SelectionCriteriaDoc>(
    {
      name: raw.name && norm(a.profileText).includes(norm(raw.name)) ? raw.name : a.senderFallback?.name || raw.name,
      contact: groundedContact(raw.contact, a.profileText).length ? groundedContact(raw.contact, a.profileText) : a.senderFallback?.contact || [],
      position: a.position,
      employer: a.employer,
      responses,
    },
    allow
  );
  // ~300 words each: trim the over-long rather than ship a 600-word "response".
  for (const r of doc.responses) {
    const total = words(r.situation + r.task + r.action + r.result);
    if (total > 340) r.action = r.action.split(/\s+/).slice(0, Math.max(40, words(r.action) - (total - 320))).join(" ").replace(/[,;:\s]+$/, "") + ".";
  }
  return doc;
}

/* ─────────────── Whole-package run (single + batch share this) ─────────────── */

/** Contact + name the profile text itself supplies (first line = name; email/phone/location lines). */
export function deriveSender(profileText: string): { name: string; contact: string[] } {
  const lines = profileText.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
  const name = (lines[0] || "").replace(/^name:\s*/i, "").slice(0, 80);
  const contact: string[] = [];
  const email = /[\w.+-]+@[\w-]+\.[\w.-]+/.exec(profileText);
  const phone = /(?:\+?\d[\d\s().-]{7,}\d)/.exec(profileText);
  if (email) contact.push(email[0]);
  if (phone) contact.push(phone[0].trim());
  return { name, contact };
}

export interface PackageResult {
  resume?: { doc: ResumeDoc; docx: Buffer; flags: ProfileFlag[] };
  coverLetter?: { doc: CoverLetterDoc; docx: Buffer };
  errors: { kind: "resume" | "cover_letter"; code: string; message: string; problems?: string[] }[];
}

export async function runVacancyPackage(a: {
  vacancy: Vacancy; profileText: string; llm: Llm; otherEmployers?: string[]; prefs?: string; kinds?: ("resume" | "cover_letter")[];
}): Promise<PackageResult> {
  const kinds = a.kinds || ["resume", "cover_letter"];
  const out: PackageResult = { errors: [] };
  const fallback = deriveSender(a.profileText);
  const guard = async (kind: "resume" | "cover_letter", fn: () => Promise<void>) => {
    try { await fn(); } catch (e) {
      const ge = e instanceof GenerationError ? e : null;
      out.errors.push({ kind, code: ge?.code || "failed", message: ge ? ge.message : "Generation failed. Please try again.", problems: ge?.problems });
    }
  };
  await Promise.all([
    kinds.includes("resume") && guard("resume", async () => {
      const r = await generateResume({ vacancy: a.vacancy, profileText: a.profileText, llm: a.llm, prefs: a.prefs });
      out.resume = { doc: r.doc, flags: r.flags, docx: await renderResumeDocx(r.doc) };
    }),
    kinds.includes("cover_letter") && guard("cover_letter", async () => {
      const d = await generateCoverLetter({ vacancy: a.vacancy, profileText: a.profileText, llm: a.llm, otherEmployers: a.otherEmployers, prefs: a.prefs, senderFallback: fallback });
      out.coverLetter = { doc: d, docx: await renderCoverLetterDocx(d) };
    }),
  ].filter(Boolean) as Promise<void>[]);
  return out;
}

export { renderSelectionCriteriaDocx };
