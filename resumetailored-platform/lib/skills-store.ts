import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import type { Skill, EmployeeSkill } from "./skills-hub";

/**
 * Skills Matrix persistence — employer_id-scoped, service-role, best-effort
 * (same contract as cert-store.ts).
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

function mapSkill(r: Record<string, unknown>): Skill {
  return { id: r.id as number, name: (r.name as string) || "", createdAt: (r.created_at as string) || "" };
}

function mapCell(r: Record<string, unknown>): EmployeeSkill {
  return {
    employeeId: r.employee_id as number,
    skillId: r.skill_id as number,
    level: r.level as number,
    updatedAt: (r.updated_at as string) || "",
  };
}

export async function listSkills(employerId: string): Promise<Skill[]> {
  const c = db();
  if (!c || !employerId) return [];
  try {
    const { data } = await c.from("skills").select("id, name, created_at").eq("employer_id", employerId).order("name", { ascending: true });
    return (data || []).map(mapSkill);
  } catch {
    return [];
  }
}

export async function createSkill(employerId: string, name: string): Promise<Skill | null> {
  const c = db();
  if (!c || !employerId || !name.trim()) return null;
  try {
    const { data, error } = await c
      .from("skills")
      .insert({ employer_id: employerId, name: name.trim().slice(0, 100) })
      .select("id, name, created_at")
      .single();
    if (error || !data) {
      console.error("[createSkill]", error);
      return null;
    }
    return mapSkill(data);
  } catch (e) {
    console.error("[createSkill]", e);
    return null;
  }
}

/** Every rated cell across the whole employer — the matrix's data set. */
export async function listEmployeeSkills(employerId: string): Promise<EmployeeSkill[]> {
  const c = db();
  if (!c || !employerId) return [];
  try {
    const { data } = await c.from("employee_skills").select("employee_id, skill_id, level, updated_at").eq("employer_id", employerId);
    return (data || []).map(mapCell);
  } catch {
    return [];
  }
}

/** One employee's own rated skills — the read-only Profile view. */
export async function listSkillsForEmployee(employerId: string, employeeId: number): Promise<(EmployeeSkill & { name: string })[]> {
  const c = db();
  if (!c || !employerId || !employeeId) return [];
  try {
    const { data } = await c
      .from("employee_skills")
      .select("employee_id, skill_id, level, updated_at, skills(name)")
      .eq("employer_id", employerId)
      .eq("employee_id", employeeId);
    return (data || []).map((r: Record<string, unknown>) => ({
      ...mapCell(r),
      name: ((r.skills as { name?: string } | null)?.name as string) || "",
    }));
  } catch {
    return [];
  }
}

/** Set (or clear, when level is null) one employee's level for one skill. */
export async function setEmployeeSkillLevel(
  employerId: string,
  employeeId: number,
  skillId: number,
  level: number | null
): Promise<boolean> {
  const c = db();
  if (!c || !employerId || !employeeId || !skillId) return false;
  try {
    if (level === null) {
      const { error } = await c
        .from("employee_skills")
        .delete()
        .eq("employer_id", employerId)
        .eq("employee_id", employeeId)
        .eq("skill_id", skillId);
      return !error;
    }
    const { error } = await c
      .from("employee_skills")
      .upsert(
        { employer_id: employerId, employee_id: employeeId, skill_id: skillId, level, updated_at: new Date().toISOString() },
        { onConflict: "employee_id,skill_id" }
      );
    return !error;
  } catch (e) {
    console.error("[setEmployeeSkillLevel]", e);
    return false;
  }
}
