/**
 * Anthropic client + prompt builders. The prompts are ported verbatim from the
 * old site's `/api/tailor` and `/api/ats-scan` handlers (server.js) so the new
 * app produces identical output. Model: claude-sonnet-4-6 (per project docs).
 *
 * The key lives only on the server (ANTHROPIC_API_KEY). If it's unset the
 * routes return a clear `not_configured` error rather than throwing.
 */
import Anthropic from "@anthropic-ai/sdk";
import type { Mode } from "./resume-templates";

export const CLAUDE_MODEL = "claude-sonnet-4-6";

export function getAnthropic(): Anthropic | null {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) return null;
  return new Anthropic({ apiKey });
}

const CHINESE_PLATFORM_HINTS = [
  "zhipin.com",
  "liepin.com",
  "zhaopin.com",
  "boss直聘",
  "bosszhipin",
  "猎聘",
  "智联招聘",
  "lagou.com",
  "拉勾",
];

export function buildTailorPrompts(args: { resume?: string; jobPosting: string; mode: Mode }): {
  system: string;
  user: string;
} {
  const { resume = "", jobPosting, mode } = args;
  const isChineseMarket = CHINESE_PLATFORM_HINTS.some((h) => jobPosting.toLowerCase().includes(h.toLowerCase()));

  const system = `You are a senior professional resume writer and executive career strategist with 20+ years placing candidates at Fortune 500 companies, elite startups, and leading multinational corporations (MNCs) across global markets. Your writing is indistinguishable from a human expert — specific, grounded, and free of AI clichés.

DEEP ANALYSIS PROTOCOL — apply to every job posting before writing:
1. Extract the CORE COMPETENCIES: the 3–5 capabilities the hiring manager truly needs (not just listed requirements).
2. Identify PROOF POINTS the job signals: specific metrics, scale indicators, tools, methodologies, and team dynamics they describe.
3. Note LANGUAGE FINGERPRINTS: exact phrases, industry jargon, and verbs the job posting uses — mirror these precisely.
4. Assess the SENIORITY SIGNAL: leadership scope, strategic vs. tactical balance, budget/team ownership expectations.
5. Flag any DIFFERENTIATOR GAPS the candidate can address with their strongest achievements.
6. MULTINATIONAL CORPORATION (MNC) DETECTION: If the posting is from or targets a global/multinational company, identify and prioritize:
   - Cross-border collaboration and global stakeholder management keywords
   - Compliance standards (ISO, SOX, GDPR, local regulatory frameworks)
   - International market expansion, P&L ownership across geographies
   - Keywords valued by leading MNCs: "cross-functional", "matrixed organization", "global alignment", "go-to-market", "OKRs/KPIs at scale"
   - For Chinese technology MNCs (Alibaba/阿里巴巴, Tencent/腾讯, Baidu/百度, Huawei/华为, ByteDance/字节跳动, Xiaomi/小米, JD.com/京东, NetEase/网易, Meituan/美团, DiDi/滴滴): emphasize digital ecosystem thinking, rapid iteration, product-market fit in high-growth markets, operational efficiency at massive scale, and data-driven decision-making
   - For Western MNCs hiring in Asian markets: cultural bridge capabilities, local market expertise, bilingual communication skills${
     isChineseMarket
       ? "\n7. CHINESE JOB MARKET: This posting appears to be from a Chinese job platform (Boss直聘, 猎聘, or 智联招聘). Optimize for Chinese market expectations: emphasize team collaboration (团队协作), results-orientation (结果导向), continuous learning (持续学习), and align keywords with common Chinese HR screening criteria."
       : ""
   }

WRITING STANDARDS — non-negotiable:
- Every bullet must contain a measurable outcome OR a clear scope indicator (e.g. "across 12 markets", "for 200K+ users", "$4M portfolio")
- Use the job's exact language where the candidate's experience warrants it — do not invent synonyms
- Strip all weak openers: never start a bullet with "Responsible for", "Helped", "Assisted", "Worked on", "Involved in", "Supported", "Contributed to", or any passive construction
- No filler phrases: no "leveraged", "utilized", "spearheaded synergies", "dynamic environment", "results-driven", "detail-oriented", "team player", "hard worker", or similar hollow clichés
- Every bullet must begin with a powerful past-tense action verb that implies ownership: Led, Built, Drove, Grew, Cut, Launched, Engineered, Negotiated, Redesigned, Secured, Scaled, Automated, Trained, Managed, Delivered
- Summaries must be specific to this exact role — not generic career overviews. Name the role and company type if known.
- The output must read as if a real senior career coach wrote it, not an AI`;

  let user = "";

  if (mode === "resume" || mode === "both") {
    user += `## Task: Deeply tailor the resume below to the specific job posting.

A resume is a FACTUAL CREDENTIAL DOCUMENT — not a narrative, not a letter. It uses implied third-person (no "I"), bullet points, and quantified achievements. It answers "What has this person accomplished?" in a scannable, ATS-optimized format. No storytelling, no motivation, no personality — just clean, powerful facts.

**Step 1 — Analyze the job posting:**
Before writing, silently identify: (a) the 3 most critical competencies this role demands, (b) the measurable proof points the hiring manager wants to see, (c) the exact vocabulary and keywords they use.

**Step 2 — Tailor the resume:**
Rules (all mandatory):
- Include EVERY job, position, and role from the original resume — never omit or merge entries
- Never fabricate experience, credentials, or metrics — only reframe what the candidate actually did
- Rewrite every bullet to foreground measurable impact and mirror the job's language
- Prioritize and reorder bullets within each job: most relevant achievements first
- Rewrite the summary to speak directly to this specific role and company type
- Every bullet starts with a strong past-tense action verb (never "Responsible for", "Helped", etc.)
- Quantify results wherever possible: %, $, headcount, timeframes, scale
- No periods at end of bullets (standard resume convention)
- ALL section headers in ALL CAPS: EXPERIENCE, EDUCATION, SKILLS, SUMMARY, CERTIFICATIONS
- Plain text output only — no markdown, no asterisks, no hash symbols

## Output format (follow exactly — do not add extra blank lines or deviate):
[Full Name]
[City, State | Phone | Email]

SUMMARY
[2–3 sentences targeting this specific role — specific, not generic]

EXPERIENCE
[Job Title]
[Company | Start – End]
• [bullet with action verb + measurable outcome]
• [bullet with action verb + measurable outcome]

[Repeat for ALL jobs in the original resume — every position must appear]

EDUCATION
[Degree]
[School | Year]

SKILLS
[comma-separated list using the job posting's terminology where applicable]

## Candidate Resume:
${resume}

## Job Posting:
${jobPosting}

---
OUTPUT: Tailored Resume
`;
  }

  if (mode === "cover_letter" || mode === "both") {
    if (mode === "both") user += "\n\n===COVER_LETTER_START===\n\n";
    user += `## Task: Write a cover letter that COMPLEMENTS — not repeats — the attached resume.

FUNDAMENTAL DIFFERENCE between these two documents:
- The RESUME (already written) is a factual credential inventory: bullet points, no "I", quantified metrics, implied third-person, ATS keywords. It answers "What have you done?"
- The COVER LETTER (your task now) is a personal first-person argument. It answers "Why do you want THIS role at THIS company, and why should they choose you as a person?" It adds motivation, personality, and narrative context that a resume structurally cannot provide.

**Step 1 — Analyze before writing:**
(a) What is THIS company's specific mission, product, or industry challenge — what makes them different?
(b) What ONE achievement from the candidate's background is the strongest match for the core need of this role?
(c) What is the posting's tone — technical startup, enterprise, creative, analytical? Match it precisely.

**Step 2 — Write the letter using this exact 4-paragraph structure:**

PARAGRAPH 1 — OPENING HOOK (2–3 sentences):
Why THIS company, why THIS role, why now. Reference something specific and real about the company — their product, market position, a problem they're solving, or the industry context. This must be impossible to copy-paste to another application. NEVER start with "I am writing to express my interest" or any variation of that phrase.

PARAGRAPH 2 — ACHIEVEMENT STORY (3–5 sentences):
Pick the ONE achievement from the candidate's background that most directly maps to what this role needs. Tell it as a brief narrative story — describe the situation or challenge, what the candidate did, and the specific outcome. Do NOT list multiple achievements like a resume. Write it as a person speaking, not as a bullet point expanded into prose. Use concrete numbers or scope only where they add meaning to the story.

PARAGRAPH 3 — BROADER FIT & MOTIVATION (3–4 sentences):
Why is this candidate right for this role beyond that one story? Connect their broader skills, working style, or values to what this company needs. This paragraph should feel personal and genuine — it should reveal something about who they are as a professional, not just repeat more credentials. Tie their career direction to this specific opportunity.

PARAGRAPH 4 — CLOSING (2–3 sentences):
A direct, confident close. State briefly what they would bring on day one. Invite a conversation — not "I hope to hear from you" (that's passive and weak), but something forward-leaning and assured.

CRITICAL RULES — the cover letter must read like a different document from the resume:
- Write entirely in first person throughout ("I", "my", "I've built", "I believe") — this is the clearest signal it's a different document
- NEVER copy resume bullet text verbatim or near-verbatim — paraphrase into natural conversational prose
- Do NOT produce a list of multiple achievements; tell one story well
- Show genuine enthusiasm for this specific company — not a generic "I am passionate about opportunities"
- Warm, confident, human tone — not stiff corporate-speak, not buzzword-heavy
- Every sentence must be grammatically complete with correct punctuation
- No bullet points, no section headers inside the letter body
- Plain text output only — no markdown symbols

## Output format (follow exactly):
[Full Name]
[City, State | Phone | Email]

[Paragraph 1]

[Paragraph 2]

[Paragraph 3]

[Paragraph 4]

Sincerely,
[Full Name]

## Candidate Resume:
${resume}

## Job Posting:
${jobPosting}

---
OUTPUT: Cover Letter
`;
  }

  return { system, user };
}

export function buildAtsPrompt(resume: string, jobPosting: string): string {
  return `You are an expert ATS (Applicant Tracking System) analyst. Analyze how well this resume matches the job description.

Return ONLY valid JSON in this exact format — no markdown, no explanation, nothing else:
{
  "score": <integer 0-100>,
  "verdict": "<exactly one of: Strong Match, Good Match, Fair Match, Weak Match>",
  "matched": [<array of strings — keywords and phrases found in both resume and job description, max 20>],
  "missing": [<array of strings — critical keywords from the job description missing from the resume, max 15>],
  "suggestions": [<array of 4-5 strings — specific, actionable rewrite suggestions referencing exact words from the job posting>]
}

Scoring guide:
- 80-100: Strong Match — most required skills and keywords are present
- 60-79: Good Match — many key requirements covered, minor gaps
- 40-59: Fair Match — partial match, significant missing keywords
- 0-39: Weak Match — poor match, major gaps

Be specific in suggestions — name the exact keyword and where to add it.

RESUME:
${resume.slice(0, 4000)}

JOB DESCRIPTION:
${jobPosting.slice(0, 4000)}`;
}

export interface AtsResult {
  score: number;
  verdict: string;
  matched: string[];
  missing: string[];
  suggestions: string[];
  fallback?: boolean;
}

/** Deterministic keyword-overlap fallback when the AI provider is unavailable. */
export function localAtsFallback(resume: string, jobPosting: string): AtsResult {
  const tokenize = (text: string) => Array.from(new Set(String(text).toLowerCase().match(/[a-z][a-z0-9+#.-]{2,}/g) || []));
  const resumeWords = new Set(tokenize(resume));
  const jobWords = tokenize(jobPosting);
  const matched = jobWords.filter((w) => resumeWords.has(w)).slice(0, 20);
  const missing = jobWords.filter((w) => !resumeWords.has(w)).slice(0, 15);
  const score = Math.max(20, Math.min(95, Math.round((matched.length / Math.max(1, jobWords.length)) * 100)));
  const verdict = score >= 80 ? "Strong Match" : score >= 60 ? "Good Match" : score >= 40 ? "Fair Match" : "Weak Match";
  return {
    score,
    verdict,
    matched,
    missing,
    suggestions: [
      `Add ${missing.slice(0, 3).join(", ") || "the role's most important terms"} where they truthfully describe your experience.`,
      "Move the achievements most relevant to this job closer to the top of each role.",
      "Use measurable scope, results, or team size only where you can verify the facts.",
      "Mirror the job posting's terminology without copying full sentences.",
    ],
    fallback: true,
  };
}

/** True for provider errors we should soft-fall-back on (overload/5xx/network). */
export function isProviderUnavailable(err: unknown): boolean {
  const e = err as { status?: number; message?: string } | undefined;
  if (!e) return false;
  if (e.status && e.status >= 500) return true;
  const m = (e.message || "").toLowerCase();
  return m.includes("overloaded") || m.includes("timeout") || m.includes("econn") || m.includes("fetch failed");
}
