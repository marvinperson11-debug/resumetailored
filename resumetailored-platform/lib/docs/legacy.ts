import { parseAIOutput } from "../resume-templates";
import type { CoverLetterDoc, ExperienceEntry, ResumeDoc } from "./types";
import { scrubText } from "./scrub";

/**
 * Adapter for the original plain-text tailoring flow (/api/tailor, /api/cover-letter): the text on screen
 * is parsed — deterministically, no model — into the same structured documents the renderer takes, so
 * every export (legacy or new) goes through one server-side .docx renderer.
 */

const BULLET = /^[•·▪●\-*–]\s+/;
const DATE_HINT = /(?:19|20)\d{2}|present|current/i;

function splitContact(s: string): string[] {
  return s.split(/\s*[|•·]\s*/).map((x) => x.trim()).filter(Boolean);
}

export function textToResumeDoc(raw: string, allowFrom = ""): ResumeDoc {
  const text = scrubText(raw, allowFrom);
  const p = parseAIOutput(text);
  const doc: ResumeDoc = { name: p.name, contact: splitContact(p.contact), summary: "", experience: [], skills: [], education: [], certifications: [], extraSections: [] };
  for (const sec of p.sections) {
    const title = sec.title.toUpperCase();
    const lines = sec.lines.map((l) => l.replace(/\*\*/g, "").trim()).filter(Boolean);
    if (/^(SUMMARY|PROFILE|OBJECTIVE|ABOUT|PROFESSIONAL SUMMARY)/.test(title)) {
      doc.summary = lines.map((l) => l.replace(BULLET, "")).join(" ");
    } else if (/EXPERIENCE|EMPLOYMENT|WORK HISTORY|CAREER/.test(title)) {
      let cur: ExperienceEntry | null = null;
      for (const l of lines) {
        if (BULLET.test(l)) {
          if (!cur) { cur = { title: "", company: "", dates: "", bullets: [] }; doc.experience.push(cur); }
          cur.bullets.push(l.replace(BULLET, "").replace(/\.$/, ""));
        } else if (cur && cur.title && !cur.company && !cur.bullets.length) {
          const parts = l.split("|").map((x) => x.trim());
          if (parts.length > 1 && DATE_HINT.test(parts[parts.length - 1])) { cur.dates = parts.pop() || ""; cur.company = parts.join(", "); }
          else if (DATE_HINT.test(l) && !parts[1]) { const m = /^(.*?)[,(]?\s*((?:\w+\s+)?(?:19|20)\d{2}.*)$/.exec(l); cur.company = (m?.[1] || l).trim(); cur.dates = (m?.[2] || "").replace(/[)]$/, ""); }
          else cur.company = l;
        } else {
          cur = { title: l, company: "", dates: "", bullets: [] };
          doc.experience.push(cur);
        }
      }
    } else if (/EDUCATION/.test(title)) {
      let cur: { degree: string; school: string; dates?: string } | null = null;
      for (const l of lines) {
        if (cur && !cur.school) {
          const parts = l.split("|").map((x) => x.trim());
          if (parts.length > 1 && DATE_HINT.test(parts[parts.length - 1])) cur.dates = parts.pop();
          cur.school = parts.join(", ");
        } else { cur = { degree: l, school: "" }; doc.education.push(cur); }
      }
    } else if (/SKILL|COMPETENC/.test(title)) {
      doc.skills = lines.flatMap((l) => l.replace(BULLET, "").replace(/^[^:]{1,30}:\s*/, "").split(/[,;]/)).map((x) => x.trim()).filter(Boolean);
    } else if (/CERTIF|LICEN/.test(title)) {
      doc.certifications = lines.map((l) => l.replace(BULLET, ""));
    } else {
      doc.extraSections!.push({ title: sec.title.charAt(0) + sec.title.slice(1).toLowerCase(), lines: lines.map((l) => l.replace(BULLET, "")) });
    }
  }
  return doc;
}

const CLOSERS = /^(sincerely|best regards|kind regards|regards|yours (?:sincerely|faithfully)|warm regards|best|thank you|respectfully)[,.]?$/i;

export function textToCoverLetterDoc(raw: string, meta: { employer: string; position?: string }, allowFrom = ""): CoverLetterDoc {
  const text = scrubText(raw, allowFrom).replace(/\*\*/g, "");
  const blocks = text.split(/\n\s*\n/).map((b) => b.trim()).filter(Boolean);
  const head = (blocks[0] || "").split("\n").map((l) => l.trim()).filter(Boolean);
  // Header block = name + contact line(s), present when the first block is short and has no sentence.
  const hasHeader = head.length <= 3 && !/[.!?]\s*$/.test(head[head.length - 1] || "") && blocks.length > 1;
  const sender = { name: hasHeader ? head[0] : "", contact: hasHeader ? head.slice(1).flatMap(splitContact) : [] };
  let rest = hasHeader ? blocks.slice(1) : blocks;
  let salutation = "Dear Hiring Manager,";
  if (rest[0] && /^dear\b/i.test(rest[0]) && rest[0].length < 80) { salutation = rest[0].replace(/\s+/g, " "); rest = rest.slice(1); }
  let signOff = "Sincerely,";
  const last = rest[rest.length - 1] || "";
  const lastLines = last.split("\n").map((l) => l.trim());
  if (lastLines.length <= 3 && CLOSERS.test(lastLines[0] || "")) { signOff = lastLines[0].replace(/[.]$/, ",").replace(/([^,])$/, "$1,"); rest = rest.slice(0, -1); if (!sender.name && lastLines[1]) sender.name = lastLines[1]; }
  return {
    sender, employer: meta.employer, position: meta.position || "", salutation,
    paragraphs: rest.map((b) => b.replace(/\s*\n\s*/g, " ")), signOff,
  };
}
