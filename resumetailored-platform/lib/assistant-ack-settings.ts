import { createClient, type SupabaseClient } from "@supabase/supabase-js";

/**
 * Standing auto-application-acknowledgment templates for the Employer
 * Portal AI Assistant (assistant_ack_settings, migration 0061). The
 * guardrail everywhere else in this feature is "no candidate-facing send
 * without approval" — a standing template IS that approval: the employer
 * approves the EXACT template text once (lib/assistant-mutations.ts
 * `executeSetAckTemplate`, via the normal pending-action card), and this
 * module is the only thing that writes a row here. lib/assistant-ack-worker.ts
 * then fires it automatically for every matching new applicant, with zero
 * further approvals and zero LLM calls.
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

export interface AckSettingRow {
  id: string;
  employerId: string;
  jobId: number | null;
  template: string;
  enabled: boolean;
  actorUserId: string;
  actorEmail: string | null;
  createdAt: string;
}

const ACK_COLS = "id, employer_id, job_id, template, enabled, actor_user_id, actor_email, created_at";

function mapRow(r: Record<string, unknown>): AckSettingRow {
  return {
    id: r.id as string,
    employerId: (r.employer_id as string) || "",
    jobId: typeof r.job_id === "number" ? r.job_id : null,
    template: (r.template as string) || "",
    enabled: !!r.enabled,
    actorUserId: (r.actor_user_id as string) || "",
    actorEmail: (r.actor_email as string) ?? null,
    createdAt: (r.created_at as string) || "",
  };
}

/** Every standing template this employer has ever approved (enabled or
 *  not), newest first — for the simple list+toggle on the assistant panel. */
export async function listAckSettings(employerId: string): Promise<AckSettingRow[]> {
  const c = db();
  if (!c || !employerId) return [];
  try {
    const { data, error } = await c.from("assistant_ack_settings").select(ACK_COLS).eq("employer_id", employerId).order("created_at", { ascending: false }).limit(200);
    if (error || !data) return [];
    return data.map(mapRow);
  } catch (e) {
    console.error("[assistant-ack-settings] listAckSettings threw", e);
    return [];
  }
}

/** The template that applies to `jobId` right now — a job-specific enabled
 *  row beats an account-wide one (job_id null), per the spec. Null if
 *  nothing is configured/enabled for this employer at all. */
export async function getActiveAckSetting(employerId: string, jobId: number): Promise<AckSettingRow | null> {
  const c = db();
  if (!c || !employerId) return null;
  try {
    const { data: jobSpecific } = await c
      .from("assistant_ack_settings")
      .select(ACK_COLS)
      .eq("employer_id", employerId)
      .eq("job_id", jobId)
      .eq("enabled", true)
      .maybeSingle();
    if (jobSpecific) return mapRow(jobSpecific);
    const { data: accountWide } = await c
      .from("assistant_ack_settings")
      .select(ACK_COLS)
      .eq("employer_id", employerId)
      .is("job_id", null)
      .eq("enabled", true)
      .maybeSingle();
    return accountWide ? mapRow(accountWide) : null;
  } catch (e) {
    console.error("[assistant-ack-settings] getActiveAckSetting threw", e);
    return null;
  }
}

/** The enabled row for EXACTLY this scope (job-specific if `jobId` is given,
 *  account-wide if null) — unlike `getActiveAckSetting`, there is no
 *  job-specific-beats-account-wide cascade here. Used by the chat disable
 *  path (lib/assistant-mutations.ts `disableSetAckTemplate`), which must
 *  turn off the scope the employer actually named rather than whichever
 *  template would end up winning for some job. */
export async function getActiveAckSettingForScope(employerId: string, jobId: number | null): Promise<AckSettingRow | null> {
  const c = db();
  if (!c || !employerId) return null;
  try {
    let q = c.from("assistant_ack_settings").select(ACK_COLS).eq("employer_id", employerId).eq("enabled", true);
    q = jobId === null ? q.is("job_id", null) : q.eq("job_id", jobId);
    const { data } = await q.maybeSingle();
    return data ? mapRow(data) : null;
  } catch (e) {
    console.error("[assistant-ack-settings] getActiveAckSettingForScope threw", e);
    return null;
  }
}

export interface CreateAckSettingInput {
  employerId: string;
  jobId: number | null;
  template: string;
  actorUserId: string;
  actorEmail: string | null;
}

/** Approves a NEW standing template: disables whatever was previously
 *  enabled for the SAME scope (employer + job_id, account-wide if null) —
 *  the partial unique indexes (migration 0061) only allow one enabled row
 *  per scope — then inserts the new one. This is how "editing" a template
 *  works: there is no in-place update of an approved row, only a new
 *  approval that supersedes the old one (same non-transactional
 *  disable-then-insert shape the personal-website "publish unpublishes the
 *  others" flow already uses in this codebase). */
export async function createAckSetting(input: CreateAckSettingInput): Promise<AckSettingRow | null> {
  const c = db();
  if (!c || !input.employerId || !input.template.trim()) return null;
  try {
    let q = c.from("assistant_ack_settings").update({ enabled: false }).eq("employer_id", input.employerId).eq("enabled", true);
    q = input.jobId === null ? q.is("job_id", null) : q.eq("job_id", input.jobId);
    await q;
    const { data, error } = await c
      .from("assistant_ack_settings")
      .insert({
        employer_id: input.employerId,
        job_id: input.jobId,
        template: input.template.slice(0, 4000),
        enabled: true,
        actor_user_id: input.actorUserId,
        actor_email: input.actorEmail,
      })
      .select(ACK_COLS)
      .single();
    if (error || !data) {
      console.error("[assistant-ack-settings] createAckSetting failed", { input, error });
      return null;
    }
    return mapRow(data);
  } catch (e) {
    console.error("[assistant-ack-settings] createAckSetting threw", { input, error: e });
    return null;
  }
}

/** Toggle an existing row on/off — the "simple list + toggle" management UI.
 *  Employer-scoped. Does NOT enforce the one-enabled-per-scope rule on
 *  re-enabling an old row (a deliberate simplification: the management UI
 *  only ever offers disabling the currently-active one, never re-enabling a
 *  superseded one, so this path can't create two enabled rows for the same
 *  scope in practice). */
export async function setAckSettingEnabled(employerId: string, id: string, enabled: boolean): Promise<boolean> {
  const c = db();
  if (!c || !employerId || !id) return false;
  try {
    const { error } = await c.from("assistant_ack_settings").update({ enabled }).eq("id", id).eq("employer_id", employerId);
    return !error;
  } catch (e) {
    console.error("[assistant-ack-settings] setAckSettingEnabled threw", { id, error: e });
    return false;
  }
}
