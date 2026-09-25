import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import {
  DEFAULT_CHECKLIST_NAME,
  DEFAULT_CHECKLIST_ITEMS,
  type ChecklistTemplate,
  type ChecklistTemplateItem,
  type ChecklistTemplateWithItems,
  type EmployeeChecklist,
  type EmployeeChecklistItem,
  type EmployeeChecklistWithItems,
} from "./checklist-hub";

/**
 * Onboarding Checklists persistence — templates (employer-editable) and their
 * per-employee instantiated copies. Service-role, employer_id scoped,
 * best-effort (same contract as the other employer stores).
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

const TEMPLATE_COLS = "id, name, is_default, created_at, updated_at";
const TEMPLATE_ITEM_COLS = "id, template_id, label, sort_order";
const CHECKLIST_COLS = "id, employee_id, template_id, name, created_at";
const CHECKLIST_ITEM_COLS = "id, checklist_id, label, done, sort_order, done_at";

function mapTemplate(r: Record<string, unknown>): ChecklistTemplate {
  return {
    id: r.id as number,
    name: (r.name as string) || "",
    isDefault: !!r.is_default,
    createdAt: (r.created_at as string) || "",
    updatedAt: (r.updated_at as string) || "",
  };
}
function mapTemplateItem(r: Record<string, unknown>): ChecklistTemplateItem {
  return {
    id: r.id as number,
    templateId: r.template_id as number,
    label: (r.label as string) || "",
    sortOrder: (r.sort_order as number) || 0,
  };
}
function mapChecklist(r: Record<string, unknown>): EmployeeChecklist {
  return {
    id: r.id as number,
    employeeId: r.employee_id as number,
    templateId: (r.template_id as number) ?? null,
    name: (r.name as string) || "",
    createdAt: (r.created_at as string) || "",
  };
}
function mapChecklistItem(r: Record<string, unknown>): EmployeeChecklistItem {
  return {
    id: r.id as number,
    checklistId: r.checklist_id as number,
    label: (r.label as string) || "",
    done: !!r.done,
    sortOrder: (r.sort_order as number) || 0,
    doneAt: (r.done_at as string) || null,
  };
}

// ── Templates ────────────────────────────────────────────────────────────────
export async function listTemplates(employerId: string): Promise<ChecklistTemplate[]> {
  const c = db();
  if (!c || !employerId) return [];
  try {
    const { data } = await c
      .from("checklist_templates")
      .select(TEMPLATE_COLS)
      .eq("employer_id", employerId)
      .order("is_default", { ascending: false })
      .order("created_at", { ascending: true });
    return (data || []).map(mapTemplate);
  } catch {
    return [];
  }
}

export async function getTemplateWithItems(employerId: string, id: number): Promise<ChecklistTemplateWithItems | null> {
  const c = db();
  if (!c || !employerId || !id) return null;
  try {
    const { data: tpl } = await c.from("checklist_templates").select(TEMPLATE_COLS).eq("employer_id", employerId).eq("id", id).maybeSingle();
    if (!tpl) return null;
    const { data: items } = await c
      .from("checklist_template_items")
      .select(TEMPLATE_ITEM_COLS)
      .eq("employer_id", employerId)
      .eq("template_id", id)
      .order("sort_order", { ascending: true });
    return { ...mapTemplate(tpl), items: (items || []).map(mapTemplateItem) };
  } catch {
    return null;
  }
}

/** Create a template with its items in one call (used by both the default
 *  seed and "create custom template"). */
export async function createTemplate(
  employerId: string,
  name: string,
  itemLabels: string[],
  isDefault = false
): Promise<ChecklistTemplateWithItems | null> {
  const c = db();
  if (!c || !employerId) return null;
  const cleanName = (name || "").trim().slice(0, 200);
  if (!cleanName) return null;
  try {
    const { data: tpl, error } = await c
      .from("checklist_templates")
      .insert({ employer_id: employerId, name: cleanName, is_default: isDefault })
      .select(TEMPLATE_COLS)
      .single();
    if (error || !tpl) {
      console.error("[createTemplate]", error);
      return null;
    }
    if (itemLabels.length) {
      const rows = itemLabels.map((label, i) => ({ employer_id: employerId, template_id: tpl.id, label, sort_order: i }));
      await c.from("checklist_template_items").insert(rows);
    }
    return getTemplateWithItems(employerId, tpl.id as number);
  } catch (e) {
    console.error("[createTemplate]", e);
    return null;
  }
}

export async function updateTemplate(employerId: string, id: number, name: string): Promise<ChecklistTemplate | null> {
  const c = db();
  if (!c || !employerId || !id) return null;
  const cleanName = (name || "").trim().slice(0, 200);
  if (!cleanName) return null;
  try {
    const { data, error } = await c
      .from("checklist_templates")
      .update({ name: cleanName, updated_at: new Date().toISOString() })
      .eq("employer_id", employerId)
      .eq("id", id)
      .select(TEMPLATE_COLS)
      .single();
    if (error || !data) return null;
    return mapTemplate(data);
  } catch {
    return null;
  }
}

export async function deleteTemplate(employerId: string, id: number): Promise<boolean> {
  const c = db();
  if (!c || !employerId || !id) return false;
  try {
    const { error } = await c.from("checklist_templates").delete().eq("employer_id", employerId).eq("id", id);
    return !error; // items cascade; in-progress employee checklists keep their snapshot (template_id set null)
  } catch {
    return false;
  }
}

export async function setTemplateItems(employerId: string, templateId: number, itemLabels: string[]): Promise<boolean> {
  const c = db();
  if (!c || !employerId || !templateId) return false;
  try {
    await c.from("checklist_template_items").delete().eq("employer_id", employerId).eq("template_id", templateId);
    if (itemLabels.length) {
      const rows = itemLabels.map((label, i) => ({ employer_id: employerId, template_id: templateId, label, sort_order: i }));
      const { error } = await c.from("checklist_template_items").insert(rows);
      if (error) return false;
    }
    await c.from("checklist_templates").update({ updated_at: new Date().toISOString() }).eq("employer_id", employerId).eq("id", templateId);
    return true;
  } catch {
    return false;
  }
}

/** Idempotent: creates the one default template (+ its six items) for this
 *  employer if it doesn't already have one. Safe to call on every load of the
 *  Onboarding tab, and via the manual GET ?do=1 route — same shape as the
 *  Training Library's admin seed. */
export async function ensureDefaultTemplate(employerId: string): Promise<{ created: boolean; template: ChecklistTemplateWithItems | null }> {
  const c = db();
  if (!c || !employerId) return { created: false, template: null };
  try {
    const { data: existing } = await c
      .from("checklist_templates")
      .select(TEMPLATE_COLS)
      .eq("employer_id", employerId)
      .eq("is_default", true)
      .limit(1)
      .maybeSingle();
    if (existing) return { created: false, template: await getTemplateWithItems(employerId, existing.id as number) };
    const template = await createTemplate(employerId, DEFAULT_CHECKLIST_NAME, [...DEFAULT_CHECKLIST_ITEMS], true);
    return { created: !!template, template };
  } catch (e) {
    console.error("[ensureDefaultTemplate]", e);
    return { created: false, template: null };
  }
}

// ── Per-employee checklists ─────────────────────────────────────────────────
/** The employee's most recently started checklist, with items — or null if
 *  none has been started yet. */
export async function getLatestEmployeeChecklist(employerId: string, employeeId: number): Promise<EmployeeChecklistWithItems | null> {
  const c = db();
  if (!c || !employerId || !employeeId) return null;
  try {
    const { data: checklist } = await c
      .from("employee_checklists")
      .select(CHECKLIST_COLS)
      .eq("employer_id", employerId)
      .eq("employee_id", employeeId)
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    if (!checklist) return null;
    const { data: items } = await c
      .from("employee_checklist_items")
      .select(CHECKLIST_ITEM_COLS)
      .eq("employer_id", employerId)
      .eq("checklist_id", checklist.id)
      .order("sort_order", { ascending: true });
    return { ...mapChecklist(checklist), items: (items || []).map(mapChecklistItem) };
  } catch {
    return null;
  }
}

/** Instantiate a checklist for an employee from a template — a snapshot of its
 *  items at this moment, so later template edits never rewrite work already in
 *  progress. */
export async function startEmployeeChecklist(
  employerId: string,
  employeeId: number,
  templateId: number
): Promise<EmployeeChecklistWithItems | null> {
  const c = db();
  if (!c || !employerId || !employeeId || !templateId) return null;
  const template = await getTemplateWithItems(employerId, templateId);
  if (!template) return null;
  try {
    const { data: checklist, error } = await c
      .from("employee_checklists")
      .insert({ employer_id: employerId, employee_id: employeeId, template_id: templateId, name: template.name })
      .select(CHECKLIST_COLS)
      .single();
    if (error || !checklist) {
      console.error("[startEmployeeChecklist]", error);
      return null;
    }
    if (template.items.length) {
      const rows = template.items.map((it, i) => ({
        employer_id: employerId,
        checklist_id: checklist.id,
        label: it.label,
        sort_order: i,
      }));
      await c.from("employee_checklist_items").insert(rows);
    }
    return getLatestEmployeeChecklist(employerId, employeeId);
  } catch (e) {
    console.error("[startEmployeeChecklist]", e);
    return null;
  }
}

/** Toggle one item done/not-done (employer action). */
export async function setChecklistItemDone(employerId: string, itemId: number, done: boolean): Promise<EmployeeChecklistItem | null> {
  const c = db();
  if (!c || !employerId || !itemId) return null;
  try {
    const { data, error } = await c
      .from("employee_checklist_items")
      .update({ done, done_at: done ? new Date().toISOString() : null })
      .eq("employer_id", employerId)
      .eq("id", itemId)
      .select(CHECKLIST_ITEM_COLS)
      .single();
    if (error || !data) return null;
    return mapChecklistItem(data);
  } catch {
    return null;
  }
}
