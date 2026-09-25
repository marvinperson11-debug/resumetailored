/**
 * Training quizzes — shared types and pure helpers (no DB, no network). Mirrors
 * the `employee-hub.ts` convention.
 */

export const DEFAULT_PASS_THRESHOLD = 80;

export interface QuizQuestion {
  q: string;
  choices: string[];
  correctIndex: number;
}

/** What the employee's own GET route sends — never the answer key. */
export interface QuizQuestionPublic {
  q: string;
  choices: string[];
}

export interface TrainingQuiz {
  id: number;
  trainingDocId: number;
  questions: QuizQuestion[];
  passThreshold: number;
}

export function toPublicQuestions(questions: QuizQuestion[]): QuizQuestionPublic[] {
  return questions.map((q) => ({ q: q.q, choices: q.choices }));
}

/** Clean + validate question rows from the builder: trims text, drops blank
 *  choices, requires at least 2 choices and a valid correctIndex, caps
 *  counts. Malformed rows are dropped rather than saved half-broken. */
export function sanitizeQuizQuestions(raw: unknown): QuizQuestion[] {
  if (!Array.isArray(raw)) return [];
  const out: QuizQuestion[] = [];
  for (const item of raw.slice(0, 50)) {
    if (!item || typeof item !== "object") continue;
    const r = item as Record<string, unknown>;
    const q = typeof r.q === "string" ? r.q.trim().slice(0, 500) : "";
    const choices = Array.isArray(r.choices)
      ? r.choices.map((c) => (typeof c === "string" ? c.trim().slice(0, 200) : "")).filter(Boolean).slice(0, 8)
      : [];
    const correctIndex = Number(r.correctIndex);
    if (!q || choices.length < 2 || !Number.isInteger(correctIndex) || correctIndex < 0 || correctIndex >= choices.length) continue;
    out.push({ q, choices, correctIndex });
  }
  return out;
}

export function sanitizePassThreshold(v: unknown): number {
  const n = Number(v);
  if (!Number.isFinite(n)) return DEFAULT_PASS_THRESHOLD;
  return Math.min(100, Math.max(1, Math.round(n)));
}

export interface QuizResult {
  score: number; // 0-100
  correct: boolean[]; // per-question, in question order
  passed: boolean;
}

/** Score a submitted set of answers (by choice index, one per question, in
 *  question order) against the answer key. A missing/out-of-range answer for
 *  a question counts as wrong, never throws. */
export function scoreQuiz(questions: QuizQuestion[], answers: number[], passThreshold: number): QuizResult {
  if (questions.length === 0) return { score: 0, correct: [], passed: false };
  const correct = questions.map((question, i) => answers[i] === question.correctIndex);
  const rightCount = correct.filter(Boolean).length;
  const score = Math.round((rightCount / questions.length) * 100);
  return { score, correct, passed: score >= passThreshold };
}
