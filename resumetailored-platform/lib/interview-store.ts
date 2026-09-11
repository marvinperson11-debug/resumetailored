import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import type { InterviewType, Difficulty, MockReport, QA } from "./interview-ai";

/** Best-effort persistence for mock-interview sessions (interview_sessions). */
let cached: SupabaseClient | null = null;
function db(): SupabaseClient | null {
  if (cached) return cached;
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SERVICE_KEY;
  if (!url || !key) return null;
  cached = createClient(url, key, { auth: { persistSession: false } });
  return cached;
}

export async function saveInterviewSession(
  userId: string,
  v: {
    jobDescription?: string;
    resumeText?: string;
    interviewType: InterviewType;
    difficulty: Difficulty;
    qas: QA[];
    report: MockReport;
  }
): Promise<void> {
  const c = db();
  if (!c || !userId) return;
  try {
    await c.from("interview_sessions").insert({
      user_id: userId,
      job_description: (v.jobDescription || "").slice(0, 8000) || null,
      resume_text: (v.resumeText || "").slice(0, 8000) || null,
      interview_type: v.interviewType,
      difficulty: v.difficulty,
      questions: v.qas.map((q) => q.question),
      answers: v.qas.map((q) => q.answer),
      overall_score: v.report.overallScore,
      report: v.report,
    });
  } catch {
    /* best-effort */
  }
}
