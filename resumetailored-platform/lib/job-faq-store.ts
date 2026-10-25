import { createClient, type SupabaseClient } from "@supabase/supabase-js";

/**
 * Per-job Candidate Q&A store (`job_faqs`, migration 0067) — Prompt 6,
 * Section 1. One row per job holding the employer-approved FAQ content
 * (`faq`) and the separate enable switch (`enabled`/`last_enabled_at`) that
 * gates whether the assistant may actually answer a real candidate's email.
 * Same enable-clock pattern as lib/assistant-ack-settings.ts: `last_enabled_at`
 * moves on every (re-)enable so a question that arrived while Q&A was off is
 * never answered retroactively just because it happens to be unread once
 * it's turned back on.
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

export interface JobFaqPair {
  question: string;
  answer: string;
}

export interface JobFaqRow {
  jobId: number;
  employerId: string;
  faq: JobFaqPair[];
  enabled: boolean;
  lastEnabledAt: string | null;
  actorUserId: string;
  actorEmail: string | null;
  createdAt: string;
}

const COLS = "job_id, employer_id, faq, enabled, last_enabled_at, actor_user_id, actor_email, created_at, updated_at";

function mapRow(r: Record<string, unknown>): JobFaqRow {
  const faq = Array.isArray(r.faq) ? r.faq : [];
  return {
    jobId: r.job_id as number,
    employerId: (r.employer_id as string) || "",
    faq: faq.map((p) => ({ question: String((p as JobFaqPair)?.question || ""), answer: String((p as JobFaqPair)?.answer || "") })).filter((p) => p.question && p.answer),
    enabled: !!r.enabled,
    lastEnabledAt: (r.last_enabled_at as string) ?? null,
    actorUserId: (r.actor_user_id as string) || "",
    actorEmail: (r.actor_email as string) ?? null,
    createdAt: (r.created_at as string) || "",
  };
}

export async function getJobFaq(employerId: string, jobId: number): Promise<JobFaqRow | null> {
  const c = db();
  if (!c || !employerId || !jobId) return null;
  try {
    // A plain list + "take the newest" rather than `.maybeSingle()` on a
    // single-row-expected query: `job_id` is the real primary key (one row
    // per job, enforced by Postgres on every write below via `upsert(...,
    // {onConflict:"job_id"})`), but reading it back as "the last row by
    // created_at" is harmless there (there's only ever one) and is what
    // makes this resilient if ever queried through a path that could see
    // more than one candidate row.
    const { data } = await c.from("job_faqs").select(COLS).eq("employer_id", employerId).eq("job_id", jobId).order("created_at", { ascending: true }).limit(50);
    if (!data || !data.length) return null;
    return mapRow(data[data.length - 1]);
  } catch (e) {
    console.error("[job-faq-store] getJobFaq threw", { jobId, error: e });
    return null;
  }
}

/** Merge `pairs` into the job's existing FAQ list — a question matching an
 *  existing one (case-insensitive, trimmed) is REPLACED (an edit), every
 *  other question is appended. Creates the row if none exists yet, carrying
 *  over `enabled`/`last_enabled_at` unchanged when it did (adding/editing
 *  FAQ content never flips the enable switch either way — enabling is the
 *  separate sample-first gate). */
export async function upsertJobFaqContent(input: { employerId: string; jobId: number; pairs: JobFaqPair[]; actorUserId: string; actorEmail: string | null }): Promise<JobFaqRow | null> {
  const c = db();
  if (!c || !input.employerId || !input.jobId) return null;
  try {
    const existing = await getJobFaq(input.employerId, input.jobId);
    const merged = [...(existing?.faq || [])];
    for (const incoming of input.pairs) {
      const q = incoming.question.trim();
      if (!q) continue;
      const idx = merged.findIndex((p) => p.question.trim().toLowerCase() === q.toLowerCase());
      const pair = { question: q, answer: incoming.answer.trim() };
      if (idx >= 0) merged[idx] = pair;
      else merged.push(pair);
    }
    const { data, error } = await c
      .from("job_faqs")
      .upsert(
        {
          job_id: input.jobId,
          employer_id: input.employerId,
          faq: merged,
          enabled: existing?.enabled ?? false,
          last_enabled_at: existing?.lastEnabledAt ?? null,
          actor_user_id: input.actorUserId,
          actor_email: input.actorEmail,
          created_at: existing?.createdAt || new Date().toISOString(),
          updated_at: new Date().toISOString(),
        },
        { onConflict: "job_id" }
      )
      .select(COLS)
      .single();
    if (error || !data) {
      console.error("[job-faq-store] upsertJobFaqContent failed", { jobId: input.jobId, error });
      return null;
    }
    return mapRow(data);
  } catch (e) {
    console.error("[job-faq-store] upsertJobFaqContent threw", { jobId: input.jobId, error: e });
    return null;
  }
}

/** Flip the enable switch. `enabled: true` always stamps `last_enabled_at`
 *  to now (the enable clock) — called ONLY on the sample-first approval
 *  (lib/assistant-mutations.ts `executeEnableCandidateQa`). `enabled: false`
 *  is instant (lib/assistant-mutations.ts `disableCandidateQa`), no approval,
 *  same reasoning as lib/assistant-ack-settings.ts: removing a future
 *  automated send is strictly safer than adding one. Creates the row (with
 *  an empty FAQ list) if none exists yet, so enabling never requires an
 *  add_job_faq call first. */
export async function setJobFaqEnabled(input: { employerId: string; jobId: number; enabled: boolean; actorUserId: string; actorEmail: string | null }): Promise<JobFaqRow | null> {
  const c = db();
  if (!c || !input.employerId || !input.jobId) return null;
  try {
    const existing = await getJobFaq(input.employerId, input.jobId);
    const { data, error } = await c
      .from("job_faqs")
      .upsert(
        {
          job_id: input.jobId,
          employer_id: input.employerId,
          faq: existing?.faq || [],
          enabled: input.enabled,
          last_enabled_at: input.enabled ? new Date().toISOString() : (existing?.lastEnabledAt ?? null),
          actor_user_id: input.actorUserId,
          actor_email: input.actorEmail,
          created_at: existing?.createdAt || new Date().toISOString(),
          updated_at: new Date().toISOString(),
        },
        { onConflict: "job_id" }
      )
      .select(COLS)
      .single();
    if (error || !data) {
      console.error("[job-faq-store] setJobFaqEnabled failed", { jobId: input.jobId, error });
      return null;
    }
    return mapRow(data);
  } catch (e) {
    console.error("[job-faq-store] setJobFaqEnabled threw", { jobId: input.jobId, error: e });
    return null;
  }
}

export interface RecordFaqAnswerInput {
  employerId: string;
  jobId: number;
  applicantId: number;
  question: string;
  answer: string;
  covered: boolean;
  groundingSources: string[];
  sent: boolean;
}

/** One append-only row per candidate question (migration 0067's
 *  `job_faq_answers`), whether it was answered, uncovered, or capped — the
 *  "every answer logged (audit row with question + grounding sources)"
 *  requirement. Best-effort: a logging failure never blocks the caller's
 *  own send/notify decision, but is loud in the server log. */
export async function recordFaqAnswer(input: RecordFaqAnswerInput): Promise<void> {
  const c = db();
  if (!c || !input.employerId || !input.jobId) return;
  try {
    const { error } = await c.from("job_faq_answers").insert({
      employer_id: input.employerId,
      job_id: input.jobId,
      applicant_id: input.applicantId,
      question: input.question.slice(0, 4000),
      answer: input.answer.slice(0, 4000),
      covered: input.covered,
      grounding_sources: input.groundingSources,
      sent: input.sent,
    });
    if (error) console.error("[job-faq-store] recordFaqAnswer failed", { jobId: input.jobId, error });
  } catch (e) {
    console.error("[job-faq-store] recordFaqAnswer threw", { jobId: input.jobId, error: e });
  }
}
