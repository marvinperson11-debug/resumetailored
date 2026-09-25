/**
 * Onboarding Checklists — shared types, the default template's content, and
 * pure helpers (no DB, no network). Mirrors the `employee-hub.ts` /
 * `training-library-seed.ts` convention: the seed content lives in app code,
 * not in a migration, so it inserts idempotently through a code-seed route
 * instead of pasted SQL.
 */

export const DEFAULT_CHECKLIST_NAME = "Default onboarding checklist";

/** The six starter items, in display order. Seeded once per employer by
 *  GET /api/employer/checklist-templates/seed?do=1 (never SQL). */
export const DEFAULT_CHECKLIST_ITEMS: readonly string[] = [
  "ID collected",
  "W-4 signed",
  "Safety training done",
  "Emergency contact on file",
  "Direct-deposit info collected",
  "Uniform issued",
];

export interface ChecklistTemplate {
  id: number;
  name: string;
  isDefault: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface ChecklistTemplateItem {
  id: number;
  templateId: number;
  label: string;
  sortOrder: number;
}

export interface ChecklistTemplateWithItems extends ChecklistTemplate {
  items: ChecklistTemplateItem[];
}

export interface EmployeeChecklist {
  id: number;
  employeeId: number;
  templateId: number | null;
  name: string;
  createdAt: string;
}

export interface EmployeeChecklistItem {
  id: number;
  checklistId: number;
  label: string;
  done: boolean;
  sortOrder: number;
  doneAt: string | null;
}

export interface EmployeeChecklistWithItems extends EmployeeChecklist {
  items: EmployeeChecklistItem[];
}

/** Percent complete, 0-100 (rounded), 0 for an empty checklist rather than
 *  NaN or a divide-by-zero. */
export function checklistProgress(items: Pick<EmployeeChecklistItem, "done">[]): number {
  if (items.length === 0) return 0;
  const done = items.filter((i) => i.done).length;
  return Math.round((done / items.length) * 100);
}

/** Clean + cap a raw list of item labels (from the template editor's textarea
 *  or item rows) — trims, drops blanks, caps length and count. */
export function normalizeItemLabels(raw: string[]): string[] {
  return raw
    .map((s) => (s || "").trim().slice(0, 200))
    .filter(Boolean)
    .slice(0, 50);
}
