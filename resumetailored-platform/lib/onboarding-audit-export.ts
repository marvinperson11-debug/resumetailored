import type { EmployeeChecklistWithItems } from "./checklist-hub";
import type { PaperworkStatus } from "./paperwork-store";

/**
 * The Corporate-only onboarding audit export (prompt item: "export the
 * whole onboarding trail for a hire"). Pure — no DB, no network — so the
 * route (app/api/employer/employees/[id]/onboarding/export) just gathers
 * the already-fetched data the onboarding page itself uses and hands it
 * here; this module only decides how to render it as a plain-text file.
 */
export interface AuditExportInput {
  employeeName: string;
  employeeEmail: string;
  startDateDisplay: string;
  generatedAt: string;
  plan: {
    status: string;
    firstWeekSchedule: { label: string; dateDisplay: string }[];
    paperwork: { item: string; dueDateDisplay: string }[];
  } | null;
  checklist: EmployeeChecklistWithItems | null;
  dayOneTasks: { label: string; done: boolean; doneAt: string | null }[];
  paperworkStatus: {
    w4: { status: PaperworkStatus; submittedAt: string | null } | null;
    i9: { status: PaperworkStatus; submittedAt: string | null; verifiedAt: string | null; verifiedBy: string | null } | null;
    direct_deposit: { status: PaperworkStatus; submittedAt: string | null } | null;
  };
  offer: { status: string; sentAt: string; completedAt: string | null } | null;
  handbook: { docTitle: string; status: string; acknowledgedAt: string | null; signedVersion: number | null; currentVersion: number };
  reminders: { whenLabel: string; sendAt: string; status: string; sentAt: string | null }[];
}

function line(label: string, value: string): string {
  return `  ${label}: ${value}`;
}

/** Renders the trail as a readable plain-text report — a downloadable file
 *  needs no particular format here, and plain text keeps this dependency-
 *  free (no PDF/CSV library) while still being easy to read or paste
 *  elsewhere. */
export function buildOnboardingAuditText(input: AuditExportInput): string {
  const out: string[] = [];
  out.push(`Onboarding audit trail — ${input.employeeName || "Unnamed hire"}`);
  out.push(`Generated ${input.generatedAt}`);
  out.push("");
  out.push(`Employee: ${input.employeeName || "—"} <${input.employeeEmail || "no email on file"}>`);
  out.push(`Start date: ${input.startDateDisplay || "—"}`);
  out.push("");

  out.push("PLAN");
  if (!input.plan) {
    out.push("  No onboarding plan was ever drafted or approved for this hire.");
  } else {
    out.push(line("Status", input.plan.status));
    out.push("  First-week schedule:");
    for (const s of input.plan.firstWeekSchedule) out.push(`    - ${s.label} — ${s.dateDisplay}`);
    out.push("  Paperwork due dates (as planned):");
    for (const p of input.plan.paperwork) out.push(`    - ${p.item} — due ${p.dueDateDisplay}`);
  }
  out.push("");

  out.push("CHECKLIST");
  if (!input.checklist || input.checklist.items.length === 0) {
    out.push("  No checklist was ever started for this hire.");
  } else {
    out.push(`  ${input.checklist.name}`);
    for (const item of input.checklist.items) {
      out.push(`    [${item.done ? "x" : " "}] ${item.label}${item.doneAt ? ` — completed ${item.doneAt}` : ""}`);
    }
  }
  out.push("");

  out.push("DAY-ONE TASKS");
  if (input.dayOneTasks.length === 0) {
    out.push("  None recorded.");
  } else {
    for (const task of input.dayOneTasks) out.push(`    [${task.done ? "x" : " "}] ${task.label}${task.doneAt ? ` — completed ${task.doneAt}` : ""}`);
  }
  out.push("");

  out.push("PAPERWORK");
  out.push(line("Offer letter", input.offer ? `${input.offer.status} (sent ${input.offer.sentAt}${input.offer.completedAt ? `, completed ${input.offer.completedAt}` : ""})` : "not sent"));
  out.push(line("W-4", input.paperworkStatus.w4 ? `${input.paperworkStatus.w4.status}${input.paperworkStatus.w4.submittedAt ? ` (submitted ${input.paperworkStatus.w4.submittedAt})` : ""}` : "not_started"));
  out.push(
    line(
      "I-9",
      input.paperworkStatus.i9
        ? `${input.paperworkStatus.i9.status}${input.paperworkStatus.i9.submittedAt ? ` (submitted ${input.paperworkStatus.i9.submittedAt})` : ""}${
            input.paperworkStatus.i9.verifiedAt ? `, verified ${input.paperworkStatus.i9.verifiedAt} by ${input.paperworkStatus.i9.verifiedBy || "—"}` : ""
          }`
        : "not_started"
    )
  );
  out.push(
    line(
      "Direct deposit",
      input.paperworkStatus.direct_deposit
        ? `${input.paperworkStatus.direct_deposit.status}${input.paperworkStatus.direct_deposit.submittedAt ? ` (submitted ${input.paperworkStatus.direct_deposit.submittedAt})` : ""}`
        : "not_started"
    )
  );
  out.push(
    line(
      `Handbook (${input.handbook.docTitle || "Employee Handbook"})`,
      `${input.handbook.status}${input.handbook.acknowledgedAt ? ` (signed ${input.handbook.acknowledgedAt}` : ""}${
        input.handbook.signedVersion != null ? `, version ${input.handbook.signedVersion}${input.handbook.acknowledgedAt ? ")" : ""}` : input.handbook.acknowledgedAt ? ")" : ""
      } — current version ${input.handbook.currentVersion}`
    )
  );
  out.push("");

  out.push("REMINDERS SENT (candidate-facing, via the approved plan)");
  if (input.reminders.length === 0) {
    out.push("  None.");
  } else {
    for (const r of input.reminders) out.push(`    - [${r.whenLabel}] scheduled ${r.sendAt} — ${r.status}${r.sentAt ? ` (sent ${r.sentAt})` : ""}`);
  }

  return out.join("\n") + "\n";
}
