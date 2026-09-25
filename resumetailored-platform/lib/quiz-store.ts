import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { sanitizeQuizQuestions, sanitizePassThreshold, type TrainingQuiz, type QuizQuestion } from "./quiz-hub";

/**
 * Training quiz persistence — one quiz per training_doc_id (unique fk),
 * employer_id scoped, service-role, best-effort.
 */
let cached: SupabaseClient | null = null;
function db(): SupabaseClient | null {
  if (cached) return cached;
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SERVICE_KEY;
  if (!url || !key) return null;
  cached = createClient(url, key, { auth: { persistSession: false } });
  return cached;
}

const COLS = "id, training_doc_id, questions, pass_threshold";

function mapQuiz(r: Record<string, unknown>): TrainingQuiz {
  return {
    id: r.id as number,
    trainingDocId: r.training_doc_id as number,
    questions: Array.isArray(r.questions) ? (r.questions as QuizQuestion[]) : [],
    passThreshold: (r.pass_threshold as number) || 80,
  };
}

export async function getQuizForDoc(employerId: string, trainingDocId: number): Promise<TrainingQuiz | null> {
  const c = db();
  if (!c || !employerId || !trainingDocId) return null;
  try {
    const { data } = await c
      .from("training_quizzes")
      .select(COLS)
      .eq("employer_id", employerId)
      .eq("training_doc_id", trainingDocId)
      .maybeSingle();
    return data ? mapQuiz(data) : null;
  } catch {
    return null;
  }
}

/** Which of the given training doc ids have a quiz — a cheap existence check
 *  for list views (My training, the employer's rollup). */
export async function docIdsWithQuiz(employerId: string, trainingDocIds: number[]): Promise<Set<number>> {
  const c = db();
  if (!c || !employerId || !trainingDocIds.length) return new Set();
  try {
    const { data } = await c.from("training_quizzes").select("training_doc_id").eq("employer_id", employerId).in("training_doc_id", trainingDocIds);
    return new Set((data || []).map((r) => r.training_doc_id as number));
  } catch {
    return new Set();
  }
}

/** Create or replace the quiz for a training doc (the builder always saves
 *  the whole set — there's no partial edit). Passing an empty question list
 *  removes the quiz. */
export async function upsertQuiz(
  employerId: string,
  trainingDocId: number,
  rawQuestions: unknown,
  rawPassThreshold: unknown
): Promise<TrainingQuiz | null> {
  const c = db();
  if (!c || !employerId || !trainingDocId) return null;
  const questions = sanitizeQuizQuestions(rawQuestions);
  if (questions.length === 0) {
    await c.from("training_quizzes").delete().eq("employer_id", employerId).eq("training_doc_id", trainingDocId);
    return null;
  }
  const passThreshold = sanitizePassThreshold(rawPassThreshold);
  try {
    const { data, error } = await c
      .from("training_quizzes")
      .upsert(
        { employer_id: employerId, training_doc_id: trainingDocId, questions, pass_threshold: passThreshold, updated_at: new Date().toISOString() },
        { onConflict: "training_doc_id" }
      )
      .select(COLS)
      .single();
    if (error || !data) {
      console.error("[upsertQuiz]", error);
      return null;
    }
    return mapQuiz(data);
  } catch (e) {
    console.error("[upsertQuiz]", e);
    return null;
  }
}
