import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import type { CareerProfile, CareerGoal, CareerMilestone, GoalCategory, Priority, GoalStatus, MilestoneType } from "./career-ai";

/** Career Hub persistence (career_profiles / career_goals / career_milestones).
 *  Service-role client, scoped by Clerk user_id. Best-effort throughout. */
let cached: SupabaseClient | null = null;
function db(): SupabaseClient | null {
  if (cached) return cached;
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SERVICE_KEY;
  if (!url || !key) return null;
  cached = createClient(url, key, { auth: { persistSession: false } });
  return cached;
}

// ── Profile ──
export async function getProfile(userId: string): Promise<CareerProfile | null> {
  const c = db();
  if (!c || !userId) return null;
  try {
    const { data } = await c.from("career_profiles").select("current_role, target_role, industry, years_experience").eq("user_id", userId).maybeSingle();
    if (!data) return null;
    return {
      currentRole: (data.current_role as string) || "",
      targetRole: (data.target_role as string) || "",
      industry: (data.industry as string) || "",
      yearsExperience: typeof data.years_experience === "number" ? data.years_experience : null,
    };
  } catch { return null; }
}
export async function saveProfile(userId: string, p: CareerProfile): Promise<boolean> {
  const c = db();
  if (!c || !userId) return false;
  try {
    const { error } = await c.from("career_profiles").upsert(
      { user_id: userId, current_role: p.currentRole || null, target_role: p.targetRole || null, industry: p.industry || null, years_experience: p.yearsExperience, updated_at: new Date().toISOString() },
      { onConflict: "user_id" }
    );
    return !error;
  } catch { return false; }
}

// ── Goals ──
function mapGoal(r: Record<string, unknown>): CareerGoal {
  return {
    id: r.id as number, title: (r.title as string) || "", category: (r.category as GoalCategory) || "skill",
    priority: (r.priority as Priority) || "medium", targetDate: (r.target_date as string) ?? null,
    status: (r.status as GoalStatus) || "not_started", progress: (r.progress as number) ?? 0, notes: (r.notes as string) ?? null,
  };
}
export async function listGoals(userId: string): Promise<CareerGoal[]> {
  const c = db();
  if (!c || !userId) return [];
  try {
    const { data, error } = await c.from("career_goals").select("id, title, category, priority, target_date, status, progress, notes").eq("user_id", userId).order("created_at", { ascending: true }).limit(200);
    if (error || !data) return [];
    return data.map(mapGoal);
  } catch { return []; }
}
export async function countGoals(userId: string): Promise<number> {
  const c = db();
  if (!c || !userId) return 0;
  try {
    const { count } = await c.from("career_goals").select("id", { count: "exact", head: true }).eq("user_id", userId);
    return count || 0;
  } catch { return 0; }
}
export async function addGoal(userId: string, g: Partial<CareerGoal>): Promise<CareerGoal | null> {
  const c = db();
  if (!c || !userId) return null;
  try {
    const { data, error } = await c.from("career_goals").insert({
      user_id: userId, title: (g.title || "").slice(0, 200), category: g.category || "skill", priority: g.priority || "medium",
      target_date: g.targetDate || null, status: g.status || "not_started", progress: Math.max(0, Math.min(100, g.progress ?? 0)), notes: g.notes || null,
    }).select("id, title, category, priority, target_date, status, progress, notes").single();
    if (error || !data) return null;
    return mapGoal(data);
  } catch { return null; }
}
export async function updateGoal(userId: string, id: number, patch: Partial<CareerGoal>): Promise<boolean> {
  const c = db();
  if (!c || !userId) return false;
  const p: Record<string, unknown> = { updated_at: new Date().toISOString() };
  if (typeof patch.title === "string") p.title = patch.title.slice(0, 200);
  if (patch.category) p.category = patch.category;
  if (patch.priority) p.priority = patch.priority;
  if (patch.targetDate !== undefined) p.target_date = patch.targetDate || null;
  if (patch.status) p.status = patch.status;
  if (typeof patch.progress === "number") p.progress = Math.max(0, Math.min(100, patch.progress));
  if (patch.notes !== undefined) p.notes = patch.notes || null;
  try {
    const { error } = await c.from("career_goals").update(p).eq("user_id", userId).eq("id", id);
    return !error;
  } catch { return false; }
}
export async function deleteGoal(userId: string, id: number): Promise<boolean> {
  const c = db();
  if (!c || !userId) return false;
  try { const { error } = await c.from("career_goals").delete().eq("user_id", userId).eq("id", id); return !error; } catch { return false; }
}

// ── Milestones ──
function mapMs(r: Record<string, unknown>): CareerMilestone {
  return { id: r.id as number, type: (r.type as MilestoneType) || "job", title: (r.title as string) || "", date: (r.date as string) || "", description: (r.description as string) ?? null, impact: (r.impact as string) ?? null };
}
export async function listMilestones(userId: string): Promise<CareerMilestone[]> {
  const c = db();
  if (!c || !userId) return [];
  try {
    const { data, error } = await c.from("career_milestones").select("id, type, title, date, description, impact").eq("user_id", userId).order("date", { ascending: false }).limit(200);
    if (error || !data) return [];
    return data.map(mapMs);
  } catch { return []; }
}
export async function addMilestone(userId: string, m: Partial<CareerMilestone>): Promise<CareerMilestone | null> {
  const c = db();
  if (!c || !userId || !m.date) return null;
  try {
    const { data, error } = await c.from("career_milestones").insert({
      user_id: userId, type: m.type || "job", title: (m.title || "").slice(0, 200), date: m.date, description: m.description || null, impact: m.impact || null,
    }).select("id, type, title, date, description, impact").single();
    if (error || !data) return null;
    return mapMs(data);
  } catch { return null; }
}
export async function deleteMilestone(userId: string, id: number): Promise<boolean> {
  const c = db();
  if (!c || !userId) return false;
  try { const { error } = await c.from("career_milestones").delete().eq("user_id", userId).eq("id", id); return !error; } catch { return false; }
}
