import type { ApplyData } from "../../lib/api";
import { fillByHints, selectByHints, findField, fillElement, labelTextFor } from "../../lib/filler";

/**
 * Platform-agnostic fill: the fields nearly every ATS shares (identity,
 * contact links, cover letter) plus heuristic mapping of custom questions to
 * the AI-suggested answers. Adapters call this then add their own quirks.
 */
export function fillCommonFields(data: ApplyData): void {
  const p = data.personal;
  const [firstName, ...rest] = (p.fullName || "").split(" ");
  const lastName = rest.join(" ");

  // Identity
  fillByHints(["first name", "given name", "legal first"], firstName, { negative: ["last"] });
  fillByHints(["last name", "family name", "surname", "legal last"], lastName);
  // Some forms have a single full-name field.
  if (firstName) fillByHints(["full name", "your name", "name"], p.fullName, { negative: ["first", "last", "user", "company", "file"] });

  // Contact
  fillByHints(["email", "e-mail"], p.email);
  fillByHints(["phone", "mobile", "telephone"], p.phone);
  fillByHints(["location", "city", "where are you", "current location"], p.location, { negative: ["relocat"] });

  // Links
  fillByHints(["linkedin"], p.linkedin);
  fillByHints(["portfolio", "website", "personal site"], p.portfolio || p.website);

  // Availability / comp
  fillByHints(["salary", "compensation", "expected pay", "desired salary"], data.preferredSalary);
  fillByHints(["start date", "available", "availability", "notice period"], data.startDate);

  // Cover letter — largest textarea whose label mentions cover/why, else any
  // empty textarea labelled cover letter.
  if (data.coverLetter) {
    const coverEl = findField(["cover letter", "cover", "why do you", "message to", "additional information", "anything else"]);
    if (coverEl && coverEl.tagName === "TEXTAREA") {
      fillElement(coverEl, data.coverLetter);
    }
  }

  // Work-authorization / yes-no selects — leave to the user (legal), but map
  // remote/onsite-type dropdowns when we can.
  selectByHints(["country"], p.location);

  fillCustomQuestions(data);
}

/**
 * Map every AI-suggested answer to the closest unfilled textarea/text input by
 * fuzzy-matching the question text against each field's label.
 */
export function fillCustomQuestions(data: ApplyData): void {
  const answers = data.suggestedAnswers ?? [];
  if (answers.length === 0) return;

  const fields = Array.from(document.querySelectorAll<HTMLInputElement | HTMLTextAreaElement>("textarea, input[type=text]"))
    .filter((el) => !el.value && !el.getAttribute("data-autoapply-filled"));

  for (const el of fields) {
    const label = labelTextFor(el);
    if (!label) continue;
    const best = bestAnswer(label, answers);
    if (best) fillElement(el, best.answer);
  }
}

const STOP = new Set(["why", "what", "the", "you", "your", "are", "for", "and", "this", "with", "want", "would", "like", "our", "how", "when", "can"]);

function tokens(s: string): string[] {
  return s.toLowerCase().replace(/[^a-z0-9 ]/g, " ").split(/\s+/).filter((w) => w.length > 2 && !STOP.has(w));
}

function bestAnswer(label: string, answers: { question: string; answer: string }[]) {
  const lt = tokens(label);
  if (lt.length === 0) return null;
  let best: { score: number; answer: string } | null = null;
  for (const a of answers) {
    const qt = tokens(a.question);
    const overlap = qt.filter((t) => lt.includes(t)).length;
    const score = overlap / Math.max(1, Math.min(qt.length, lt.length));
    if (overlap >= 1 && (!best || score > best.score)) best = { score, answer: a.answer };
  }
  // Require a reasonable overlap so we don't paste an answer into an unrelated box.
  return best && best.score >= 0.34 ? best : null;
}
