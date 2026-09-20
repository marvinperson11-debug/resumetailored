import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { isEmployeeStatus, type Employee, type EmployeeStatus } from "./employee-hub";

/**
 * Employees persistence — one `employees` row per person on the employer's
 * workforce, owner-scoped by employer_id (Clerk user id, TEXT). Same
 * service-role pattern as the other employer stores; best-effort
 * (unconfigured/unreachable Supabase resolves to empty reads / null writes,
 * never a throw).
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

const COLS = "id, name, email, role, start_date, status, created_at, updated_at";

function mapEmployee(r: Record<string, unknown>): Employee {
  return {
    id: r.id as number,
    name: (r.name as string) || "",
    email: (r.email as string) || "",
    role: (r.role as string) || "",
    startDate: (r.start_date as string) || "",
    status: (isEmployeeStatus(r.status) ? r.status : "active") as EmployeeStatus,
    createdAt: (r.created_at as string) || "",
    updatedAt: (r.updated_at as string) || "",
  };
}

export async function listEmployees(employerId: string): Promise<Employee[]> {
  const c = db();
  if (!c || !employerId) return [];
  try {
    const { data, error } = await c
      .from("employees")
      .select(COLS)
      .eq("employer_id", employerId)
      .order("created_at", { ascending: false })
      .limit(2000);
    if (error || !data) return [];
    return data.map(mapEmployee);
  } catch {
    return [];
  }
}

export async function getEmployee(employerId: string, id: number): Promise<Employee | null> {
  const c = db();
  if (!c || !employerId || !id) return null;
  try {
    const { data } = await c.from("employees").select(COLS).eq("employer_id", employerId).eq("id", id).maybeSingle();
    return data ? mapEmployee(data) : null;
  } catch {
    return null;
  }
}

export interface EmployeeInput {
  name: string;
  email?: string;
  role?: string;
  startDate?: string;
  status?: EmployeeStatus;
}

/** Normalize a raw start-date string to YYYY-MM-DD or null (a bad date is
 *  dropped rather than rejected — the form already constrains it). */
function normDate(v?: string): string | null {
  const s = (v || "").trim();
  if (!s) return null;
  return /^\d{4}-\d{2}-\d{2}$/.test(s) ? s : null;
}

export async function createEmployee(employerId: string, v: EmployeeInput): Promise<Employee | null> {
  const c = db();
  if (!c || !employerId) return null;
  const name = (v.name || "").trim().slice(0, 200);
  if (!name) return null;
  try {
    const { data, error } = await c
      .from("employees")
      .insert({
        employer_id: employerId,
        name,
        email: (v.email || "").trim().slice(0, 200) || null,
        role: (v.role || "").trim().slice(0, 200) || null,
        start_date: normDate(v.startDate),
        status: isEmployeeStatus(v.status) ? v.status : "active",
      })
      .select(COLS)
      .single();
    if (error || !data) {
      console.error("[createEmployee]", error);
      return null;
    }
    return mapEmployee(data);
  } catch (e) {
    console.error("[createEmployee]", e);
    return null;
  }
}

export async function updateEmployee(employerId: string, id: number, v: Partial<EmployeeInput>): Promise<Employee | null> {
  const c = db();
  if (!c || !employerId || !id) return null;
  const row: Record<string, unknown> = { updated_at: new Date().toISOString() };
  if (v.name !== undefined) row.name = (v.name || "").trim().slice(0, 200);
  if (v.email !== undefined) row.email = (v.email || "").trim().slice(0, 200) || null;
  if (v.role !== undefined) row.role = (v.role || "").trim().slice(0, 200) || null;
  if (v.startDate !== undefined) row.start_date = normDate(v.startDate);
  if (v.status !== undefined && isEmployeeStatus(v.status)) row.status = v.status;
  try {
    const { data, error } = await c.from("employees").update(row).eq("employer_id", employerId).eq("id", id).select(COLS).single();
    if (error || !data) return null;
    return mapEmployee(data);
  } catch {
    return null;
  }
}

export async function deleteEmployee(employerId: string, id: number): Promise<boolean> {
  const c = db();
  if (!c || !employerId || !id) return false;
  try {
    const { error } = await c.from("employees").delete().eq("employer_id", employerId).eq("id", id);
    return !error;
  } catch {
    return false;
  }
}

/** Distinct role names in use — feeds the "assign to a role" picker. */
export async function listRoles(employerId: string): Promise<string[]> {
  const employees = await listEmployees(employerId);
  return Array.from(new Set(employees.map((e) => e.role).filter(Boolean))).sort();
}
