import { createClient, type SupabaseClient } from "@supabase/supabase-js";

/**
 * Day-one task list persistence — a per-employee, checkable copy of the
 * onboarding plan's static `dayOneChecklist` text (lib/onboarding-plan.ts).
 * The plan itself never tracks completion; this table is what turns "send
 * accounts, add to calendar, line up a buddy" into something the employer
 * actually works through on day one (prompt item 5). Employer-only — these
 * are operational tasks about the new hire, not for the new hire to do.
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

const COLS = "id, employee_id, label, done, done_at, sort_order, created_at";

export interface DayOneTask {
  id: number;
  employeeId: number;
  label: string;
  done: boolean;
  doneAt: string | null;
  sortOrder: number;
  createdAt: string;
}

function mapRow(r: Record<string, unknown>): DayOneTask {
  return {
    id: r.id as number,
    employeeId: r.employee_id as number,
    label: (r.label as string) || "",
    done: !!r.done,
    doneAt: (r.done_at as string) || null,
    sortOrder: (r.sort_order as number) || 0,
    createdAt: (r.created_at as string) || "",
  };
}

export async function listDayOneTasks(employerId: string, employeeId: number): Promise<DayOneTask[]> {
  const c = db();
  if (!c || !employerId || !employeeId) return [];
  try {
    const { data } = await c
      .from("day_one_tasks")
      .select(COLS)
      .eq("employer_id", employerId)
      .eq("employee_id", employeeId)
      .order("sort_order", { ascending: true });
    return (data || []).map(mapRow);
  } catch {
    return [];
  }
}

/** Idempotent: seeds the task rows from the plan's day-one checklist text
 *  only if this employee has none yet. Safe to call every time the
 *  onboarding page loads. */
export async function ensureDayOneTasks(employerId: string, employeeId: number, labels: string[]): Promise<DayOneTask[]> {
  const c = db();
  if (!c || !employerId || !employeeId) return [];
  const existing = await listDayOneTasks(employerId, employeeId);
  if (existing.length > 0 || labels.length === 0) return existing;
  try {
    const rows = labels.map((label, i) => ({ employer_id: employerId, employee_id: employeeId, label, sort_order: i }));
    await c.from("day_one_tasks").insert(rows);
    return listDayOneTasks(employerId, employeeId);
  } catch (e) {
    console.error("[ensureDayOneTasks]", e);
    return [];
  }
}

export async function setDayOneTaskDone(employerId: string, taskId: number, done: boolean): Promise<DayOneTask | null> {
  const c = db();
  if (!c || !employerId || !taskId) return null;
  try {
    const { data, error } = await c
      .from("day_one_tasks")
      .update({ done, done_at: done ? new Date().toISOString() : null })
      .eq("employer_id", employerId)
      .eq("id", taskId)
      .select(COLS)
      .single();
    if (error || !data) return null;
    return mapRow(data);
  } catch {
    return null;
  }
}
