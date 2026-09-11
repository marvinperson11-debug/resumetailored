/**
 * Decoder Key — decode a job description (jargon → plain English, red flags,
 * hidden requirements, salary/culture intel, the "real ask") and compare two
 * postings. Pure prompt builders + types + normalizers. No DB, no network.
 */

export type Depth = "basic" | "deep";
export type Severity = "info" | "warning" | "danger";

export interface JargonItem { phrase: string; translation: string; severity: Severity }
export interface RedFlag { title: string; explanation: string; severity: number; interviewTip: string }
export interface HiddenReq { requirement: string; evidence: string }
export interface SalaryIntel {
  listed: boolean;
  assessment: string;      // e.g. "Below market", "Market rate", "Competitive", "Unknown"
  estimatedRange: string;  // e.g. "$95k – $120k"
  leverage: string[];      // negotiation leverage points
  breakdown: string;       // base + bonus + equity + benefits estimate
}
export interface CultureSignals {
  signals: { phrase: string; meaning: string }[];
  cultureScore: number;    // 0-100, higher = healthier
  questions: string[];     // questions to verify culture in the interview
}
export interface RealAsk { summary: string; emphasize: string[] }

export interface DecodeResult {
  jargon: JargonItem[];
  redFlags: RedFlag[];
  hiddenRequirements?: HiddenReq[];
  salaryIntel?: SalaryIntel;
  cultureSignals?: CultureSignals;
  realAsk?: RealAsk;
  fitScore?: number | null;
}

export interface CompareResult {
  winner: "A" | "B" | "tie";
  comparison: { category: string; winner: "A" | "B" | "tie"; explanation: string }[];
  combinedRedFlags: string[];
  bestChoiceFor: { growth: "A" | "B" | "tie"; pay: "A" | "B" | "tie"; culture: "A" | "B" | "tie"; learning: "A" | "B" | "tie" };
}

export const isDepth = (v: unknown): v is Depth => v === "basic" || v === "deep";

// ── Prompts ──
export function buildDecodePrompt(jobDescription: string, depth: Depth, hasResume: boolean, resume: string): { system: string; user: string } {
  const system =
    "You are a blunt, experienced career insider who decodes job postings — translating corporate jargon to plain English, spotting red flags, and revealing what employers actually want. You are candid but fair (not cynical for its own sake). Output ONLY valid JSON, no markdown.";

  if (depth === "basic") {
    return {
      system,
      user: `Decode this job posting (BASIC). Return ONLY:
{
  "jargon": [ { "phrase": "buzzword from the posting", "translation": "what it really means", "severity": "info|warning|danger" } ],
  "redFlags": [ { "title": "short flag", "explanation": "why it's a concern", "severity": <1-3>, "interviewTip": "how to ask about this in the interview" } ]
}
Include 4-8 jargon items actually present in the text, and EXACTLY the 3 most important red flags.

JOB POSTING:
${jobDescription.slice(0, 6000)}`,
    };
  }

  return {
    system,
    user: `Decode this job posting (DEEP — full analysis). Return ONLY:
{
  "jargon": [ { "phrase": "...", "translation": "...", "severity": "info|warning|danger" } ],
  "redFlags": [ { "title": "...", "explanation": "...", "severity": <1-3>, "interviewTip": "..." } ],
  "hiddenRequirements": [ { "requirement": "what they want but didn't say plainly", "evidence": "the phrase that implies it" } ],
  "salaryIntel": { "listed": <bool>, "assessment": "Below market|Market rate|Competitive|Unknown", "estimatedRange": "e.g. $95k – $120k", "leverage": ["negotiation leverage points from the JD"], "breakdown": "base + bonus + equity + benefits estimate" },
  "cultureSignals": { "signals": [ { "phrase": "...", "meaning": "what it actually means" } ], "cultureScore": <0-100, higher=healthier>, "questions": ["questions to verify culture in the interview"] },
  "realAsk": { "summary": "What they actually need is someone who can X because Y", "emphasize": ["3 things to emphasize in the application based on the hidden needs"] }${hasResume ? ',\n  "fitScore": <0-100 — how well the RESUME matches the REAL ask, not just posted requirements>' : ""}
}
Base everything on the posting. Include all present jargon (up to 10) and all real red flags.

JOB POSTING:
${jobDescription.slice(0, 6000)}
${hasResume ? `\nCANDIDATE RESUME (for fitScore + emphasize):\n${resume.slice(0, 3000)}` : ""}`,
  };
}

export function buildComparePrompt(jobA: string, jobB: string, resume: string): { system: string; user: string } {
  return {
    system: "You compare two job postings for a candidate and give a candid verdict. Output ONLY valid JSON, no markdown.",
    user: `Compare Job A and Job B. Return ONLY:
{
  "winner": "A|B|tie",
  "comparison": [ { "category": "e.g. Compensation", "winner": "A|B|tie", "explanation": "one line" } ],
  "combinedRedFlags": ["notable red flags across either posting"],
  "bestChoiceFor": { "growth": "A|B|tie", "pay": "A|B|tie", "culture": "A|B|tie", "learning": "A|B|tie" }
}
Cover 4-6 comparison categories (compensation, growth, culture, role clarity, stability, work-life).
${resume ? "Weigh fit against the candidate's résumé where relevant." : ""}

JOB A:
${jobA.slice(0, 4000)}

JOB B:
${jobB.slice(0, 4000)}
${resume ? `\nRÉSUMÉ:\n${resume.slice(0, 2500)}` : ""}`,
  };
}

// ── Normalizers ──
const clamp100 = (n: unknown) => Math.max(0, Math.min(100, Math.round(Number(n) || 0)));
const strArr = (v: unknown, n: number) => (Array.isArray(v) ? v.map((x) => String(x).trim()).filter(Boolean).slice(0, n) : []);
const sev = (v: unknown): Severity => (["info", "warning", "danger"].includes(String(v)) ? (v as Severity) : "warning");
const abWinner = (v: unknown): "A" | "B" | "tie" => (v === "A" || v === "B" ? v : "tie");

export function normalizeDecode(raw: unknown, depth: Depth): DecodeResult | null {
  if (!raw || typeof raw !== "object") return null;
  const r = raw as Record<string, unknown>;
  const jargon = (Array.isArray(r.jargon) ? (r.jargon as Record<string, unknown>[]) : [])
    .map((j) => ({ phrase: String(j.phrase || "").trim(), translation: String(j.translation || "").trim(), severity: sev(j.severity) }))
    .filter((j) => j.phrase && j.translation).slice(0, 12);
  let redFlags = (Array.isArray(r.redFlags) ? (r.redFlags as Record<string, unknown>[]) : [])
    .map((f) => ({ title: String(f.title || "").trim(), explanation: String(f.explanation || "").trim(), severity: Math.max(1, Math.min(3, Math.round(Number(f.severity) || 1))), interviewTip: String(f.interviewTip || "").trim() }))
    .filter((f) => f.title).slice(0, 12);
  if (depth === "basic") redFlags = redFlags.slice(0, 3);
  if (!jargon.length && !redFlags.length) return null;

  const result: DecodeResult = { jargon, redFlags };
  if (depth === "deep") {
    const hidden = (Array.isArray(r.hiddenRequirements) ? (r.hiddenRequirements as Record<string, unknown>[]) : [])
      .map((h) => ({ requirement: String(h.requirement || "").trim(), evidence: String(h.evidence || "").trim() })).filter((h) => h.requirement).slice(0, 8);
    if (hidden.length) result.hiddenRequirements = hidden;

    const s = r.salaryIntel as Record<string, unknown> | undefined;
    if (s) result.salaryIntel = { listed: !!s.listed, assessment: String(s.assessment || "Unknown").trim(), estimatedRange: String(s.estimatedRange || "").trim(), leverage: strArr(s.leverage, 6), breakdown: String(s.breakdown || "").trim() };

    const c = r.cultureSignals as Record<string, unknown> | undefined;
    if (c) {
      const signals = (Array.isArray(c.signals) ? (c.signals as Record<string, unknown>[]) : [])
        .map((x) => ({ phrase: String(x.phrase || "").trim(), meaning: String(x.meaning || "").trim() })).filter((x) => x.phrase).slice(0, 10);
      result.cultureSignals = { signals, cultureScore: clamp100(c.cultureScore), questions: strArr(c.questions, 6) };
    }
    const ra = r.realAsk as Record<string, unknown> | undefined;
    if (ra) result.realAsk = { summary: String(ra.summary || "").trim(), emphasize: strArr(ra.emphasize, 5) };
    if (typeof r.fitScore === "number") result.fitScore = clamp100(r.fitScore);
  }
  return result;
}

export function normalizeCompare(raw: unknown): CompareResult | null {
  if (!raw || typeof raw !== "object") return null;
  const r = raw as Record<string, unknown>;
  const comparison = (Array.isArray(r.comparison) ? (r.comparison as Record<string, unknown>[]) : [])
    .map((c) => ({ category: String(c.category || "").trim(), winner: abWinner(c.winner), explanation: String(c.explanation || "").trim() })).filter((c) => c.category).slice(0, 8);
  if (!comparison.length) return null;
  const bc = (r.bestChoiceFor || {}) as Record<string, unknown>;
  return {
    winner: abWinner(r.winner),
    comparison,
    combinedRedFlags: strArr(r.combinedRedFlags, 10),
    bestChoiceFor: { growth: abWinner(bc.growth), pay: abWinner(bc.pay), culture: abWinner(bc.culture), learning: abWinner(bc.learning) },
  };
}
