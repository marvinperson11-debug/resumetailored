/**
 * Interview Coach — pure prompt builders + types for question generation,
 * answer feedback (with STAR check), and the stateful mock-interview flow.
 * No DB, no network — routes call Anthropic and parse with extractJson.
 */

export type InterviewType = "behavioral" | "technical" | "situational" | "culture" | "salary";
export type Difficulty = "entry" | "mid" | "senior" | "executive";

export const INTERVIEW_TYPES: { id: InterviewType; label: string }[] = [
  { id: "behavioral", label: "Behavioral (STAR)" },
  { id: "technical", label: "Technical" },
  { id: "situational", label: "Situational" },
  { id: "culture", label: "Culture fit" },
  { id: "salary", label: "Salary negotiation" },
];
export const DIFFICULTIES: { id: Difficulty; label: string }[] = [
  { id: "entry", label: "Entry" },
  { id: "mid", label: "Mid" },
  { id: "senior", label: "Senior" },
  { id: "executive", label: "Executive" },
];

export function isInterviewType(v: unknown): v is InterviewType {
  return ["behavioral", "technical", "situational", "culture", "salary"].includes(String(v));
}
export function isDifficulty(v: unknown): v is Difficulty {
  return ["entry", "mid", "senior", "executive"].includes(String(v));
}
const typeLabel = (t: InterviewType) => INTERVIEW_TYPES.find((x) => x.id === t)?.label || "Behavioral";

export interface InterviewQuestion {
  id: string;
  text: string;
  category: string;
  difficulty: number; // 1-3 dots
  expectedKeywords: string[];
}
export interface InterviewCoaching {
  commonMistakes: string[];
  topMentions: string[];
}
export interface StarCheck {
  situation: boolean;
  task: boolean;
  action: boolean;
  result: boolean;
}
export interface InterviewFeedback {
  score: number;
  strengths: string[];
  improvements: string[];
  modelAnswer: string;
  starCheck: StarCheck;
}
export interface MockReport {
  overallScore: number;
  strongest: string;
  weakest: string;
  practice: string[];
}
export interface QA {
  question: string;
  answer: string;
}

function ctx(resume: string, jobDescription: string): string {
  return `JOB DESCRIPTION:\n${(jobDescription || "").slice(0, 4000)}\n\nCANDIDATE RESUME:\n${(resume || "(not provided)").slice(0, 4000)}`;
}

export function buildQuestionsPrompt(args: {
  resume: string;
  jobDescription: string;
  type: InterviewType;
  difficulty: Difficulty;
  count: number;
}): { system: string; user: string } {
  const { resume, jobDescription, type, difficulty, count } = args;
  return {
    system:
      "You are a senior interviewer and interview coach. You generate realistic, role-specific interview questions and concise coaching. Output ONLY valid JSON, no markdown.",
    user: `Generate ${count} ${typeLabel(type)} interview questions at ${difficulty}-level for this role, plus coaching. Return ONLY:
{
  "questions": [
    { "id": "q1", "text": "the question", "category": "${type}", "difficulty": <1-3>, "expectedKeywords": ["what a strong answer should mention"] }
  ],
  "coaching": {
    "commonMistakes": ["3 common mistakes candidates make for THIS role"],
    "topMentions": ["3 things this candidate should be sure to mention, drawn from the job description keywords"]
  }
}
Make questions specific to the role and seniority (never generic filler). Exactly ${count} questions. 3 items in each coaching array.

${ctx(resume, jobDescription)}`,
  };
}

export function buildFeedbackPrompt(args: {
  question: string;
  answer: string;
  type: InterviewType;
  jobDescription: string;
  resume: string;
  detailed: boolean;
}): { system: string; user: string } {
  const { question, answer, type, jobDescription, resume, detailed } = args;
  const star = type === "behavioral" || type === "situational";
  return {
    system:
      "You are an expert interview coach giving candid, specific, encouraging feedback on interview answers. Output ONLY valid JSON, no markdown.",
    user: `Score and coach this ${typeLabel(type)} interview answer. Return ONLY:
{
  "score": <0-100>,
  "strengths": [${detailed ? "2-4 specific things done well" : "exactly 1 thing done well"}],
  "improvements": [${detailed ? "2-4 concrete improvements" : "exactly 1 top improvement"}],
  "modelAnswer": ${detailed ? '"a strong ~120-word example answer for comparison"' : '""'},
  "starCheck": ${star ? '{ "situation": <bool>, "task": <bool>, "action": <bool>, "result": <bool> }' : '{ "situation": false, "task": false, "action": false, "result": false }'}
}
${star ? "Judge the STAR booleans honestly against the answer (did they cover Situation, Task, Action, Result?)." : "STAR is not relevant here; set all four booleans to false."}
${detailed ? "" : "Keep it brief — this is the free tier: exactly one strength, one improvement, and an empty modelAnswer."}

QUESTION: ${question.slice(0, 800)}
ANSWER: ${answer.slice(0, 3000)}

${ctx(resume, jobDescription)}`,
  };
}

export function buildMockPrompt(args: {
  resume: string;
  jobDescription: string;
  type: InterviewType;
  difficulty: Difficulty;
  previousQAs: QA[];
  maxQuestions: number;
}): { system: string; user: string } {
  const { resume, jobDescription, type, difficulty, previousQAs, maxQuestions } = args;
  const asked = previousQAs.length;
  const transcript = previousQAs.map((qa, i) => `Q${i + 1}: ${qa.question}\nA${i + 1}: ${qa.answer}`).join("\n\n") || "(none yet)";
  const shouldFinish = asked >= maxQuestions;
  return {
    system:
      "You are conducting a realistic mock interview, one question at a time, adapting to the candidate's previous answers. Output ONLY valid JSON, no markdown.",
    user: `You are running a ${typeLabel(type)} mock interview at ${difficulty}-level (max ${maxQuestions} questions). ${asked} answered so far.

${shouldFinish ? "The interview is COMPLETE. Do not ask another question." : "Ask the NEXT single question (build on their previous answers; do not repeat)."}

Return ONLY:
{
  "nextQuestion": ${shouldFinish ? '""' : '"the next question"'},
  "isFinal": ${shouldFinish ? "true" : "false"},
  "report": ${shouldFinish
    ? '{ "overallScore": <0-100>, "strongest": "which answer was strongest and why (1 sentence)", "weakest": "which was weakest and why (1 sentence)", "practice": ["3 things to practice"] }'
    : "null"}
}

TRANSCRIPT SO FAR:
${transcript}

${ctx(resume, jobDescription)}`,
  };
}

// ── Normalizers (defensive so a slightly-off model reply still renders) ──
const clamp100 = (n: unknown) => Math.max(0, Math.min(100, Math.round(Number(n) || 0)));
const strArr = (v: unknown, max: number): string[] =>
  Array.isArray(v) ? v.map((x) => String(x).trim()).filter(Boolean).slice(0, max) : [];

export function normalizeQuestions(raw: unknown): { questions: InterviewQuestion[]; coaching: InterviewCoaching } {
  const r = (raw || {}) as Record<string, unknown>;
  const qs = Array.isArray(r.questions) ? (r.questions as Record<string, unknown>[]) : [];
  const questions = qs
    .map((q, i) => ({
      id: String(q.id || `q${i + 1}`),
      text: String(q.text || "").trim(),
      category: String(q.category || "behavioral").trim(),
      difficulty: Math.max(1, Math.min(3, Math.round(Number(q.difficulty) || 2))),
      expectedKeywords: strArr(q.expectedKeywords, 8),
    }))
    .filter((q) => q.text);
  const c = (r.coaching || {}) as Record<string, unknown>;
  return {
    questions,
    coaching: { commonMistakes: strArr(c.commonMistakes, 4), topMentions: strArr(c.topMentions, 4) },
  };
}

export function normalizeFeedback(raw: unknown): InterviewFeedback | null {
  if (!raw || typeof raw !== "object") return null;
  const r = raw as Record<string, unknown>;
  const s = (r.starCheck || {}) as Record<string, unknown>;
  const strengths = strArr(r.strengths, 4);
  const improvements = strArr(r.improvements, 4);
  if (!strengths.length && !improvements.length && typeof r.score !== "number") return null;
  return {
    score: clamp100(r.score),
    strengths,
    improvements,
    modelAnswer: String(r.modelAnswer || "").trim(),
    starCheck: { situation: !!s.situation, task: !!s.task, action: !!s.action, result: !!s.result },
  };
}

export function normalizeMock(raw: unknown): { nextQuestion: string; isFinal: boolean; report: MockReport | null } {
  const r = (raw || {}) as Record<string, unknown>;
  const isFinal = !!r.isFinal;
  let report: MockReport | null = null;
  if (r.report && typeof r.report === "object") {
    const rep = r.report as Record<string, unknown>;
    report = {
      overallScore: clamp100(rep.overallScore),
      strongest: String(rep.strongest || "").trim(),
      weakest: String(rep.weakest || "").trim(),
      practice: strArr(rep.practice, 5),
    };
  }
  return { nextQuestion: String(r.nextQuestion || "").trim(), isFinal, report };
}
