import { chatJSON } from "@/lib/openai";
import type {
  ResumeData,
  MatchResult,
  PreparedApplication,
} from "@/lib/types";

// ─────────────────────────────────────────────────────────────────────────
// 1. Parse an uploaded resume (plain text) into structured JSON.
// ─────────────────────────────────────────────────────────────────────────

const PARSE_SYSTEM = `You are a resume parser. Extract the resume into strict JSON.
Return ONLY an object matching this TypeScript type:
{
  "personalInfo": { "fullName": string, "email": string, "phone"?: string, "location"?: string, "linkedin"?: string, "portfolio"?: string, "website"?: string },
  "summary"?: string,
  "workExperience": [{ "company": string, "title": string, "location"?: string, "startDate"?: string, "endDate"?: string, "current"?: boolean, "bullets": string[] }],
  "education": [{ "school": string, "degree"?: string, "field"?: string, "startDate"?: string, "endDate"?: string, "gpa"?: string }],
  "skills": string[],
  "certifications"?: string[],
  "preferredSalary"?: string,
  "startDate"?: string
}
Rules: never invent facts. Omit fields you cannot find (do not use null). Keep bullet wording verbatim from the resume. Dates as written ("Mar 2021", "Present").`;

export async function parseResumeText(resumeText: string): Promise<ResumeData> {
  return chatJSON<ResumeData>({
    system: PARSE_SYSTEM,
    user: `Parse this resume:\n\n${resumeText.slice(0, 16000)}`,
    maxTokens: 2500,
    temperature: 0,
  });
}

// ─────────────────────────────────────────────────────────────────────────
// 2. Match score: resume vs. job description → 0-100 + breakdown.
// ─────────────────────────────────────────────────────────────────────────

const SCORE_SYSTEM = `You are an ATS-aware hiring analyst. Compare a candidate resume to a job description and score the fit.
Return ONLY JSON of this shape:
{
  "score": number,            // 0-100 overall fit
  "summary": string,          // 2-3 sentences, candid, what's strong and what's missing
  "breakdown": { "skills": number, "experience": number, "domain": number }, // each 0-100
  "missingKeywords": string[] // important JD keywords absent from the resume
}
Be realistic; do not inflate. The overall score should roughly reflect the three sub-scores.`;

export async function scoreMatch(
  resume: ResumeData,
  jobDescription: string
): Promise<MatchResult> {
  return chatJSON<MatchResult>({
    system: SCORE_SYSTEM,
    user: `RESUME (JSON):\n${JSON.stringify(resume).slice(0, 12000)}\n\nJOB DESCRIPTION:\n${jobDescription.slice(0, 12000)}`,
    maxTokens: 1200,
    temperature: 0.2,
  });
}

// ─────────────────────────────────────────────────────────────────────────
// 3. Prepare application: tailored resume + cover letter + suggested answers.
// ─────────────────────────────────────────────────────────────────────────

const PREPARE_SYSTEM = `You tailor a candidate's application to a specific job. You never fabricate experience, employers, dates, or credentials — you only rephrase and reprioritize what the resume already contains to surface relevance to the JD.
Return ONLY JSON of this shape:
{
  "tailoredResume": <same ResumeData shape as input, with reworded/reordered bullets emphasizing JD-relevant impact; keep companies, titles, and dates unchanged>,
  "coverLetter": string,      // 250-350 words, addressed to the hiring team, specific to the company/role, first person, no placeholders like [Company]
  "suggestedAnswers": [       // common application questions, answered from the resume
    { "question": "Why do you want to work here?", "answer": string },
    { "question": "What are your salary expectations?", "answer": string },
    { "question": "When can you start?", "answer": string },
    { "question": "Why are you a good fit for this role?", "answer": string }
  ]
}
Fill placeholders with real values from the resume/JD. If salary is unknown, give a market-reasonable range framed as flexible.`;

export async function prepareApplication(
  resume: ResumeData,
  companyName: string,
  roleTitle: string,
  jobDescription: string
): Promise<PreparedApplication> {
  return chatJSON<PreparedApplication>({
    system: PREPARE_SYSTEM,
    user: `COMPANY: ${companyName}\nROLE: ${roleTitle}\n\nRESUME (JSON):\n${JSON.stringify(resume).slice(0, 12000)}\n\nJOB DESCRIPTION:\n${jobDescription.slice(0, 12000)}`,
    maxTokens: 3000,
    temperature: 0.4,
  });
}
