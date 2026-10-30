import type { TrackerStage } from "./tracker-core";

/**
 * Pure decision rules for the legacy-applications -> tracked_applications
 * backfill (Taylor Combined Build v5, Section F). The actual data pass runs
 * as hand-applied SQL (supabase/migrations/0081_migrate_legacy_applications.sql)
 * — this module is the documented, directly-unit-testable specification of
 * that SQL's status map, dedupe key, unmappable predicate, and note text, so
 * the mapping rules have real test coverage even though this module never
 * runs in production itself. scripts/test-application-tracker.cjs also
 * parses 0081's SQL text and cross-checks its CASE statement against
 * `LEGACY_STATUS_TO_STAGE` below, to catch drift between the two.
 */

// Against the REAL `applications.status` check constraint (migration 0004):
// 'Applied','Phone Screen','Interview','Offer','Rejected','Ghosted','Withdrawn'.
// Anything not a key here (including 'Ghosted', null, empty, or a future
// status the constraint doesn't even know about yet) falls back to 'Clipped'
// — never guessed into a more "resolved" stage than the data supports.
export const LEGACY_STATUS_TO_STAGE: Record<string, TrackerStage> = {
  Applied: "Applied",
  "Phone Screen": "Interviewing",
  Interview: "Interviewing",
  Offer: "Offer",
  Rejected: "Rejected",
  Withdrawn: "Withdrawn",
};

export function mapLegacyStatusToStage(status: string | null | undefined): TrackerStage {
  if (!status) return "Clipped";
  return LEGACY_STATUS_TO_STAGE[status] ?? "Clipped";
}

// Stages a legacy row's `applied_at` is honest to carry forward — a card
// that lands as Clipped was never actually "applied" in the new model, so
// backfilling applied_at for it would assert something the status mapping
// itself doesn't support.
const APPLIED_ISH_STAGES: ReadonlySet<TrackerStage> = new Set<TrackerStage>(["Applied", "Interviewing", "Offer", "Rejected", "Withdrawn"]);
export function isAppliedIshStage(stage: TrackerStage): boolean {
  return APPLIED_ISH_STAGES.has(stage);
}

export interface LegacyApplicationRow {
  id: number;
  user_id: string;
  company: string | null;
  role: string | null;
  status: string | null;
  contact_name?: string | null;
  contact_email?: string | null;
  salary?: string | null;
  location?: string | null;
  url?: string | null;
  notes?: string | null;
  resume_id?: string | null;
  follow_up_date?: string | null;
  applied_at?: string | null;
  updated_at?: string | null;
}

/** Nothing to identify the application by — never guessed, always flagged
 *  rather than migrated with an invented title/company. */
export function isUnmappableLegacyRow(row: LegacyApplicationRow): boolean {
  return !(row.role ?? "").trim() && !(row.company ?? "").trim();
}

/** Legacy fields with no destination column on tracked_applications
 *  (salary, contact, follow-up date, resume id, free-text notes) plus the
 *  original status when the mapping wasn't a direct 1:1 — preserved
 *  verbatim as one system note rather than silently dropped. Returns ""
 *  when there is nothing extra to carry (a plain Applied/Offer/etc. row
 *  with no salary/contact/notes needs no note at all). */
export function buildLegacyNoteText(row: LegacyApplicationRow, chosenStage: TrackerStage): string {
  const lines: string[] = [];
  if (row.status !== chosenStage) {
    lines.push(`Migrated from legacy tracker. Original status: ${row.status || "(none)"}.`);
  }
  if ((row.salary ?? "").trim()) lines.push(`Salary (legacy): ${row.salary}`);
  const contactName = (row.contact_name ?? "").trim();
  const contactEmail = (row.contact_email ?? "").trim();
  if (contactName || contactEmail) {
    lines.push(`Contact (legacy): ${contactName}${contactEmail ? ` <${contactEmail}>` : ""}`.trim());
  }
  if (row.follow_up_date) lines.push(`Follow-up date (legacy): ${row.follow_up_date}`);
  if ((row.resume_id ?? "").trim()) lines.push(`Resume used (legacy id): ${row.resume_id}`);
  if ((row.notes ?? "").trim()) lines.push(`Notes (legacy): ${row.notes}`);
  return lines.join("\n");
}

export interface TrackedApplicationRef {
  id: string;
  user_id: string;
  posting_url: string | null;
}

export type MigrationOutcome = "migrated" | "merged" | "unmappable";

export interface MigrationPlanItem {
  legacyId: number;
  outcome: MigrationOutcome;
  stage?: TrackerStage;
  mergedInto?: string;
  noteText?: string;
}

export interface MigrationPlanSummary {
  migrated: number;
  merged: number;
  unmappable: number;
}

export function summarizeMigrationPlan(plan: MigrationPlanItem[]): MigrationPlanSummary {
  const summary: MigrationPlanSummary = { migrated: 0, merged: 0, unmappable: 0 };
  for (const item of plan) summary[item.outcome]++;
  return summary;
}

/** The row-by-row decision algorithm the SQL migration implements: status
 *  mapping, the unmappable predicate, the (user_id, posting_url) dedupe key,
 *  and the note text — mirrors 0081_migrate_legacy_applications.sql exactly.
 *  `alreadyHandledLegacyIds` is the idempotency guard (stands in for the SQL's
 *  `where not exists (select 1 from application_events where event in (...)
 *  and payload->>'legacy_id' = a.id::text)`): a legacy id in this set is
 *  skipped entirely, exactly as a second run of the migration would skip it. */
// ── Redirect (middleware.ts) ────────────────────────────────────────────────

/** One tracker surface: the old hand-entry applications list
 *  (/candidate/applications, migration 0004) is superseded by the Kanban
 *  tracker (/candidate/tracker, migrations 0078/0079). Every deep
 *  link/bookmark to the old list 301-redirects to the board rather than
 *  404ing or keeping a second surface. Lives here (not inline in
 *  middleware.ts) so it's directly unit-testable with no Clerk mocking. */
export function legacyApplicationsRedirectTarget(pathname: string): string | null {
  return pathname === "/candidate/applications" || pathname === "/candidate/applications/" ? "/candidate/tracker" : null;
}

export function planLegacyMigration(
  legacyRows: LegacyApplicationRow[],
  existingTracked: TrackedApplicationRef[],
  alreadyHandledLegacyIds: ReadonlySet<number> = new Set()
): MigrationPlanItem[] {
  const plan: MigrationPlanItem[] = [];
  // A row migrated earlier in THIS pass can itself be a merge target for a
  // later row in the same pass — mirrors the SQL re-reading
  // tracked_applications fresh on every loop iteration.
  const liveTracked = existingTracked.map((t) => ({ ...t }));

  for (const row of legacyRows) {
    if (alreadyHandledLegacyIds.has(row.id)) continue;

    if (isUnmappableLegacyRow(row)) {
      plan.push({ legacyId: row.id, outcome: "unmappable" });
      continue;
    }

    const stage = mapLegacyStatusToStage(row.status);
    const noteText = buildLegacyNoteText(row, stage);
    const url = (row.url ?? "").trim();
    const match = url ? liveTracked.find((t) => t.user_id === row.user_id && t.posting_url === url) : undefined;

    if (match) {
      plan.push({ legacyId: row.id, outcome: "merged", stage, mergedInto: match.id, noteText: noteText || undefined });
    } else {
      const newId = `migrated_${row.id}`;
      liveTracked.push({ id: newId, user_id: row.user_id, posting_url: url || null });
      plan.push({ legacyId: row.id, outcome: "migrated", stage, mergedInto: undefined, noteText: noteText || undefined });
    }
  }

  return plan;
}
