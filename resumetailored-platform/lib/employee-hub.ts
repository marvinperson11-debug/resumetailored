/**
 * Employee Hub — shared types, constants and pure validators (no DB, no
 * network). Mirrors the `employer-ai.ts` convention of colocating the domain
 * types with their type guards so both the stores and the route handlers import
 * from one place.
 */

// ── A. Employees ─────────────────────────────────────────────────────────────
export const EMPLOYEE_STATUSES = ["active", "on_leave", "offboarded"] as const;
export type EmployeeStatus = (typeof EMPLOYEE_STATUSES)[number];
export const isEmployeeStatus = (v: unknown): v is EmployeeStatus =>
  (EMPLOYEE_STATUSES as readonly string[]).includes(String(v));

export const EMPLOYEE_STATUS_LABELS: Record<EmployeeStatus, string> = {
  active: "Active",
  on_leave: "On leave",
  offboarded: "Offboarded",
};

export interface Employee {
  id: number;
  name: string;
  email: string;
  role: string;
  startDate: string; // YYYY-MM-DD, or ""
  status: EmployeeStatus;
  createdAt: string;
  updatedAt: string;
}

// ── B. Training documents ────────────────────────────────────────────────────
export const DOC_KINDS = ["sop", "safety", "policy", "training"] as const;
export type DocKind = (typeof DOC_KINDS)[number];
export const isDocKind = (v: unknown): v is DocKind => (DOC_KINDS as readonly string[]).includes(String(v));

export const DOC_KIND_LABELS: Record<DocKind, string> = {
  sop: "SOP",
  safety: "Safety",
  policy: "Policy",
  training: "Training",
};

export interface TrainingDoc {
  id: number;
  title: string;
  docKind: DocKind;
  bodyHtml: string;
  sourceDocumentId: number | null;
  pdfUrl: string | null;
  assignTo: string; // "all" or a role name
  requireSignature: boolean;
  libraryItemId: number | null; // set when created from the built-in Library
  createdAt: string;
}

// ── Built-in Training Library (US-government public-domain content) ───────────
export const LIBRARY_KINDS = ["video", "doc"] as const;
export type LibraryKind = (typeof LIBRARY_KINDS)[number];
export const isLibraryKind = (v: unknown): v is LibraryKind => (LIBRARY_KINDS as readonly string[]).includes(String(v));

export interface TrainingLibraryItem {
  id: number;
  category: string;
  title: string;
  kind: LibraryKind;
  provider: string; // OSHA / NIOSH / DOL / FEMA / CISA / FDA / USDA / CDC
  embedUrl: string | null; // official YouTube embed (videos)
  bodyHtml: string | null; // rendered content (docs)
  sourceUrl: string; // attribution link to the official source
  createdAt: string;
}

// ── B. Acknowledgments ───────────────────────────────────────────────────────
export const ACK_STATUSES = ["pending", "signed", "waived"] as const;
export type AckStatus = (typeof ACK_STATUSES)[number];
export const isAckStatus = (v: unknown): v is AckStatus => (ACK_STATUSES as readonly string[]).includes(String(v));

export interface Acknowledgment {
  id: number;
  trainingDocId: number;
  employeeId: number;
  envelopeId: string | null;
  status: AckStatus;
  dueAt: string | null;
  acknowledgedAt: string | null;
  score: number | null;
  attempts: number;
  createdAt: string;
}

/**
 * Effective compliance state for a single acknowledgment, given the current
 * time. `signed`/`waived` are terminal; a still-`pending` row is `overdue` once
 * its due_at is in the past, otherwise `pending`. Pure so the compliance grid
 * (server) and any client badge derive the same colour.
 */
export type ComplianceState = "signed" | "waived" | "pending" | "overdue";
export function complianceState(ack: Pick<Acknowledgment, "status" | "dueAt">, now: number = Date.now()): ComplianceState {
  if (ack.status === "signed") return "signed";
  if (ack.status === "waived") return "waived";
  if (ack.dueAt && new Date(ack.dueAt).getTime() < now) return "overdue";
  return "pending";
}

export const COMPLIANCE_TONE: Record<ComplianceState, "teal" | "gold" | "red" | "neutral"> = {
  signed: "teal",
  waived: "neutral",
  pending: "gold",
  overdue: "red",
};

/** An employee row joined with its acknowledgment for one training doc — the
 *  cell shape used by the compliance grid and the per-employee checklist. */
export interface AckCell {
  employee: Employee;
  ack: Acknowledgment | null;
}
