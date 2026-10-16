import {
  AlignmentType, BorderStyle, Document, Footer, LevelFormat, Packer, Paragraph, TabStopType, TextRun, HeadingLevel,
} from "docx";
import { shouldWatermark, WATERMARK_TEXT, type Target, type Tier } from "./tier";
import type { CoverLetterDoc, ExperienceEntry, ResumeDoc, SelectionCriteriaDoc } from "./types";

/**
 * Server-side .docx renderer (the `docx` package). It only ever sees STRUCTURED data — never raw model
 * text. Calibri 11pt body, 1" margins, real Heading styles, bullets with a hanging indent. No headers,
 * footers, links or print chrome are emitted, and the file properties carry only the document kind.
 */

export const DOCX_MIME = "application/vnd.openxmlformats-officedocument.wordprocessingml.document";

const FONT = "Calibri";
/** The one accent (Professional template): name + section headings + their rule. Body text is black. */
export const ACCENT = "1F3A5F";
const BODY = 22; // half-points = 11pt
const MARGIN = 1440; // 1 inch in twips
const BULLET_REF = "rt-bullets";

const styles = {
  default: {
    document: { run: { font: FONT, size: BODY }, paragraph: { spacing: { after: 60, line: 264 } } },
    heading1: {
      run: { font: FONT, size: 24, bold: true, allCaps: true, color: ACCENT },
      paragraph: { spacing: { before: 200, after: 80 }, keepNext: true },
    },
    heading2: { run: { font: FONT, size: BODY, bold: true, color: "000000" }, paragraph: { spacing: { before: 100, after: 0 }, keepNext: true } },
    title: { run: { font: FONT, size: 32, bold: true, color: ACCENT }, paragraph: { alignment: AlignmentType.CENTER, spacing: { after: 40 } } },
  },
};

const numbering = {
  config: [
    {
      reference: BULLET_REF,
      levels: [
        {
          level: 0,
          format: LevelFormat.BULLET,
          text: "•",
          alignment: AlignmentType.LEFT,
          style: { paragraph: { indent: { left: 360, hanging: 360 } }, run: { font: FONT } },
        },
      ],
    },
  ],
};

const text = (t: string, o: { bold?: boolean; italics?: boolean } = {}) => new TextRun({ text: t, ...o });

function bullet(t: string): Paragraph {
  return new Paragraph({ numbering: { reference: BULLET_REF, level: 0 }, children: [text(t)], spacing: { after: 40 } });
}
function section(title: string): Paragraph {
  return new Paragraph({
    heading: HeadingLevel.HEADING_1,
    children: [text(title)],
    border: { bottom: { style: BorderStyle.SINGLE, size: 6, space: 1, color: ACCENT } },
  });
}
function body(t: string, o: { after?: number; align?: (typeof AlignmentType)[keyof typeof AlignmentType] } = {}): Paragraph {
  return new Paragraph({ children: [text(t)], spacing: { after: o.after ?? 120 }, alignment: o.align });
}

/** Sort key for "2019 – Present", "Mar 2021 – Jun 2023", "2018": newest end date first. */
export function endKey(dates: string): number {
  const d = dates || "";
  if (/\b(present|current|now|ongoing|to date)\b/i.test(d)) return 9999 * 12 + 11;
  const MONTHS = ["jan", "feb", "mar", "apr", "may", "jun", "jul", "aug", "sep", "oct", "nov", "dec"];
  const parts = Array.from(d.matchAll(/(?:(jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*\.?\s+)?((?:19|20)\d{2})/gi));
  if (!parts.length) return -1;
  const last = parts[parts.length - 1];
  return Number(last[2]) * 12 + (last[1] ? MONTHS.indexOf(last[1].toLowerCase()) : 11);
}
function startKey(dates: string): number {
  const m = /((?:19|20)\d{2})/.exec(dates || "");
  return m ? Number(m[1]) : -1;
}
/** Reverse-chronological (stable): by end date, then start year; unparseable dates keep their place. */
export function sortReverseChron(entries: ExperienceEntry[]): ExperienceEntry[] {
  return entries
    .map((e, i) => ({ e, i }))
    .sort((a, b) => endKey(b.e.dates) - endKey(a.e.dates) || startKey(b.e.dates) - startKey(a.e.dates) || a.i - b.i)
    .map((x) => x.e);
}

function header(name: string, contact: string[]): Paragraph[] {
  const out = [new Paragraph({ heading: HeadingLevel.TITLE, children: [text(name || " ")] })];
  if (contact.length) out.push(new Paragraph({ alignment: AlignmentType.CENTER, spacing: { after: 120 }, children: [text(contact.join("  |  "))] }));
  return out;
}

function pack(doc: Document): Promise<Buffer> {
  return Packer.toBuffer(doc);
}
function makeDoc(kind: string, author: string, children: Paragraph[], watermark = false): Document {
  return new Document({
    creator: author || kind,
    lastModifiedBy: author || kind,
    title: kind, // "Resume" / "Cover Letter" — the only metadata a recipient could see
    description: "",
    styles,
    numbering,
    sections: [
      {
        properties: { page: { margin: { top: MARGIN, right: MARGIN, bottom: MARGIN, left: MARGIN } } },
        // Free-tier PDF only (see tier.ts). Otherwise the file has no footer part at all.
        ...(watermark
          ? { footers: { default: new Footer({ children: [new Paragraph({ alignment: AlignmentType.CENTER, children: [new TextRun({ text: WATERMARK_TEXT, size: 16, color: "6B7280" })] })] }) } }
          : {}),
        children,
      },
    ],
  });
}

async function renderResumeDocx(doc: ResumeDoc, watermark: boolean): Promise<Buffer> {
  const c: Paragraph[] = [...header(doc.name, doc.contact)];
  if (doc.summary) c.push(section("Summary"), body(doc.summary));
  if (doc.experience.length) {
    c.push(section("Experience"));
    for (const e of sortReverseChron(doc.experience)) {
      const right = [e.dates].filter(Boolean).join("");
      c.push(
        new Paragraph({
          heading: HeadingLevel.HEADING_2,
          tabStops: [{ type: TabStopType.RIGHT, position: 9360 }],
          children: [text(e.title), ...(right ? [new TextRun({ text: `\t${right}`, bold: false })] : [])],
        }),
        new Paragraph({ spacing: { after: 40 }, children: [text([e.company, e.location].filter(Boolean).join(", "), { italics: true })] })
      );
      for (const b of e.bullets) c.push(bullet(b));
    }
  }
  if (doc.education.length) {
    c.push(section("Education"));
    for (const ed of doc.education) {
      c.push(
        new Paragraph({
          heading: HeadingLevel.HEADING_2,
          tabStops: [{ type: TabStopType.RIGHT, position: 9360 }],
          children: [text(ed.degree), ...(ed.dates ? [new TextRun({ text: `\t${ed.dates}`, bold: false })] : [])],
        }),
        new Paragraph({ spacing: { after: 60 }, children: [text(ed.school, { italics: true })] })
      );
    }
  }
  if (doc.skills.length) c.push(section("Skills"), body(doc.skills.join(", ")));
  if (doc.certifications?.length) {
    c.push(section("Certifications"));
    for (const x of doc.certifications) c.push(bullet(x));
  }
  for (const x of doc.extraSections || []) {
    c.push(section(x.title));
    for (const l of x.lines) c.push(bullet(l));
  }
  return pack(makeDoc("Resume", doc.name, c, watermark));
}

function longDate(d?: string): string {
  if (d && d.trim()) return d.trim();
  return new Intl.DateTimeFormat("en-AU", { day: "numeric", month: "long", year: "numeric" }).format(new Date());
}

/** Standard business letter: sender block, date, employer block, salutation, body, sign-off. */
async function renderCoverLetterDocx(doc: CoverLetterDoc, watermark: boolean): Promise<Buffer> {
  const c: Paragraph[] = [];
  const line = (t: string, after = 0) => new Paragraph({ spacing: { after }, children: [text(t)] });
  c.push(new Paragraph({ spacing: { after: 0 }, children: [text(doc.sender.name, { bold: true })] }));
  doc.sender.contact.forEach((x, i, a) => c.push(line(x, i === a.length - 1 ? 240 : 0)));
  if (!doc.sender.contact.length) c.push(line("", 120));
  c.push(line(longDate(doc.date), 240));
  c.push(line(doc.employer, doc.employerAddress?.length ? 0 : 240));
  (doc.employerAddress || []).forEach((x, i, a) => c.push(line(x, i === a.length - 1 ? 240 : 0)));
  if (doc.position) c.push(new Paragraph({ spacing: { after: 200 }, children: [text(`Re: ${doc.position}`, { bold: true })] }));
  c.push(body(doc.salutation, { after: 160 }));
  for (const p of doc.paragraphs) c.push(body(p, { after: 160 }));
  c.push(new Paragraph({ spacing: { before: 120, after: 480 }, children: [text(doc.signOff)] }));
  c.push(new Paragraph({ children: [text(doc.sender.name)] }));
  return pack(makeDoc("Cover Letter", doc.sender.name, c, watermark));
}

async function renderSelectionCriteriaDocx(doc: SelectionCriteriaDoc, watermark: boolean): Promise<Buffer> {
  const c: Paragraph[] = [...header(doc.name, doc.contact)];
  const sub = [doc.position && `Application for ${doc.position}`, doc.employer].filter(Boolean).join(" — ");
  if (sub) c.push(new Paragraph({ alignment: AlignmentType.CENTER, spacing: { after: 160 }, children: [text(sub)] }));
  c.push(section("Response to Selection Criteria"));
  doc.responses.forEach((r, i) => {
    c.push(new Paragraph({ heading: HeadingLevel.HEADING_2, spacing: { before: 200, after: 60 }, children: [text(`${i + 1}. ${r.criterion}`)] }));
    const parts: [string, string][] = [["Situation", r.situation], ["Task", r.task], ["Action", r.action], ["Result", r.result]];
    for (const [label, val] of parts) {
      if (!val) continue;
      c.push(new Paragraph({ spacing: { after: 80 }, children: [text(`${label}: `, { bold: true }), text(val)] }));
    }
  });
  return pack(makeDoc("Selection Criteria Response", doc.name, c, watermark));
}

export type RenderRequest =
  | { kind: "resume"; doc: ResumeDoc }
  | { kind: "cover_letter"; doc: CoverLetterDoc }
  | { kind: "selection_criteria"; doc: SelectionCriteriaDoc };

/**
 * THE renderer. Single run, batch, selection criteria and the export route all call this, so the
 * tier/target watermark rule (tier.ts) and the Professional styling live in exactly one place.
 * `target` is what the bytes are for: "docx" is the file the user downloads; "pdf" is the intermediate
 * that LibreOffice converts (the only place a free-tier watermark appears).
 */
export function renderDocument(req: RenderRequest, opts: { tier: Tier; target: Target }): Promise<Buffer> {
  const wm = shouldWatermark(opts.tier, opts.target);
  if (req.kind === "resume") return renderResumeDocx(req.doc, wm);
  if (req.kind === "cover_letter") return renderCoverLetterDocx(req.doc, wm);
  return renderSelectionCriteriaDocx(req.doc, wm);
}
