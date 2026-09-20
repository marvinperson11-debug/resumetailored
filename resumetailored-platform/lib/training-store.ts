import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import {
  isDocKind,
  isAckStatus,
  type TrainingDoc,
  type DocKind,
  type Acknowledgment,
  type AckStatus,
  type Employee,
  type AckCell,
} from "./employee-hub";
import { listEmployees } from "./employees-store";

/**
 * Training documents + acknowledgments persistence. Service-role, employer_id
 * scoped, best-effort (same contract as the other employer stores). The
 * DocuSign send that a signature-required assignment triggers is done in the
 * route (it needs the connected account); this store only owns the DB rows and
 * the envelope→acknowledgment linkage the webhook flips.
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

const DOC_COLS =
  "id, title, doc_kind, body_html, source_document_id, pdf_url, assign_to, require_signature, created_at";
const ACK_COLS =
  "id, training_doc_id, employee_id, envelope_id, status, due_at, acknowledged_at, score, attempts, created_at";

function mapDoc(r: Record<string, unknown>): TrainingDoc {
  return {
    id: r.id as number,
    title: (r.title as string) || "Untitled",
    docKind: (isDocKind(r.doc_kind) ? r.doc_kind : "policy") as DocKind,
    bodyHtml: (r.body_html as string) || "",
    sourceDocumentId: (r.source_document_id as number) ?? null,
    pdfUrl: (r.pdf_url as string) || null,
    assignTo: (r.assign_to as string) || "all",
    requireSignature: r.require_signature !== false,
    createdAt: (r.created_at as string) || "",
  };
}

function mapAck(r: Record<string, unknown>): Acknowledgment {
  return {
    id: r.id as number,
    trainingDocId: r.training_doc_id as number,
    employeeId: r.employee_id as number,
    envelopeId: (r.envelope_id as string) || null,
    status: (isAckStatus(r.status) ? r.status : "pending") as AckStatus,
    dueAt: (r.due_at as string) || null,
    acknowledgedAt: (r.acknowledged_at as string) || null,
    score: typeof r.score === "number" ? (r.score as number) : null,
    attempts: (r.attempts as number) || 0,
    createdAt: (r.created_at as string) || "",
  };
}

// ── Training docs ────────────────────────────────────────────────────────────
export async function listTrainingDocs(employerId: string): Promise<TrainingDoc[]> {
  const c = db();
  if (!c || !employerId) return [];
  try {
    const { data, error } = await c
      .from("training_docs")
      .select(DOC_COLS)
      .eq("employer_id", employerId)
      .order("created_at", { ascending: false })
      .limit(1000);
    if (error || !data) return [];
    return data.map(mapDoc);
  } catch {
    return [];
  }
}

export async function getTrainingDoc(employerId: string, id: number): Promise<TrainingDoc | null> {
  const c = db();
  if (!c || !employerId || !id) return null;
  try {
    const { data } = await c.from("training_docs").select(DOC_COLS).eq("employer_id", employerId).eq("id", id).maybeSingle();
    return data ? mapDoc(data) : null;
  } catch {
    return null;
  }
}

export interface TrainingDocInput {
  title: string;
  docKind?: DocKind;
  bodyHtml?: string;
  sourceDocumentId?: number | null;
  pdfUrl?: string | null;
  assignTo?: string;
  requireSignature?: boolean;
}

export async function createTrainingDoc(employerId: string, v: TrainingDocInput): Promise<TrainingDoc | null> {
  const c = db();
  if (!c || !employerId) return null;
  const title = (v.title || "").trim().slice(0, 200);
  if (!title) return null;
  try {
    const { data, error } = await c
      .from("training_docs")
      .insert({
        employer_id: employerId,
        title,
        doc_kind: isDocKind(v.docKind) ? v.docKind : "policy",
        body_html: (v.bodyHtml || "").slice(0, 200000) || null,
        source_document_id: v.sourceDocumentId ?? null,
        pdf_url: (v.pdfUrl || "").trim() || null,
        assign_to: (v.assignTo || "all").trim().slice(0, 200) || "all",
        require_signature: v.requireSignature !== false,
      })
      .select(DOC_COLS)
      .single();
    if (error || !data) {
      console.error("[createTrainingDoc]", error);
      return null;
    }
    return mapDoc(data);
  } catch (e) {
    console.error("[createTrainingDoc]", e);
    return null;
  }
}

export async function deleteTrainingDoc(employerId: string, id: number): Promise<boolean> {
  const c = db();
  if (!c || !employerId || !id) return false;
  try {
    const { error } = await c.from("training_docs").delete().eq("employer_id", employerId).eq("id", id);
    return !error; // acknowledgments cascade (FK on delete cascade)
  } catch {
    return false;
  }
}

// ── Acknowledgments ──────────────────────────────────────────────────────────
/** Employees a doc is assigned to: "all" → every non-offboarded employee;
 *  otherwise those whose role matches `assign_to` (case-insensitive). */
export function assignees(doc: TrainingDoc, employees: Employee[]): Employee[] {
  const active = employees.filter((e) => e.status !== "offboarded");
  if (doc.assignTo === "all") return active;
  const want = doc.assignTo.trim().toLowerCase();
  return active.filter((e) => e.role.trim().toLowerCase() === want);
}

/**
 * Create the pending acknowledgment rows for a doc's assignees, idempotently
 * (the unique (training_doc_id, employee_id) constraint + upsert means a re-run
 * never duplicates and never clobbers a completed row). Returns the created /
 * existing rows for the assignees.
 */
export async function ensureAcknowledgments(
  employerId: string,
  doc: TrainingDoc,
  employees: Employee[],
  dueAt: string | null
): Promise<Acknowledgment[]> {
  const c = db();
  if (!c || !employerId) return [];
  const targets = assignees(doc, employees);
  if (!targets.length) return [];
  try {
    const rows = targets.map((e) => ({
      employer_id: employerId,
      training_doc_id: doc.id,
      employee_id: e.id,
      status: "pending",
      due_at: dueAt,
    }));
    // ignoreDuplicates keeps any already-signed row intact; only genuinely new
    // (doc, employee) pairs are inserted.
    await c.from("acknowledgments").upsert(rows, { onConflict: "training_doc_id,employee_id", ignoreDuplicates: true });
    const { data } = await c
      .from("acknowledgments")
      .select(ACK_COLS)
      .eq("employer_id", employerId)
      .eq("training_doc_id", doc.id);
    return (data || []).map(mapAck);
  } catch (e) {
    console.error("[ensureAcknowledgments]", e);
    return [];
  }
}

export async function getAcknowledgment(employerId: string, id: number): Promise<Acknowledgment | null> {
  const c = db();
  if (!c || !employerId || !id) return null;
  try {
    const { data } = await c.from("acknowledgments").select(ACK_COLS).eq("employer_id", employerId).eq("id", id).maybeSingle();
    return data ? mapAck(data) : null;
  } catch {
    return null;
  }
}

export async function listAcknowledgmentsForDoc(employerId: string, docId: number): Promise<Acknowledgment[]> {
  const c = db();
  if (!c || !employerId || !docId) return [];
  try {
    const { data } = await c.from("acknowledgments").select(ACK_COLS).eq("employer_id", employerId).eq("training_doc_id", docId);
    return (data || []).map(mapAck);
  } catch {
    return [];
  }
}

export async function listAcknowledgmentsForEmployee(employerId: string, employeeId: number): Promise<Acknowledgment[]> {
  const c = db();
  if (!c || !employerId || !employeeId) return [];
  try {
    const { data } = await c.from("acknowledgments").select(ACK_COLS).eq("employer_id", employerId).eq("employee_id", employeeId);
    return (data || []).map(mapAck);
  } catch {
    return [];
  }
}

export async function listAllAcknowledgments(employerId: string): Promise<Acknowledgment[]> {
  const c = db();
  if (!c || !employerId) return [];
  try {
    const { data } = await c.from("acknowledgments").select(ACK_COLS).eq("employer_id", employerId).limit(10000);
    return (data || []).map(mapAck);
  } catch {
    return [];
  }
}

/** Attach an e-sign envelope to an acknowledgment (set at send time). */
export async function setAckEnvelope(employerId: string, ackId: number, envelopeId: string): Promise<boolean> {
  const c = db();
  if (!c || !employerId || !ackId) return false;
  try {
    const { error } = await c.from("acknowledgments").update({ envelope_id: envelopeId }).eq("employer_id", employerId).eq("id", ackId);
    return !error;
  } catch {
    return false;
  }
}

/**
 * The DocuSign webhook calls this when an envelope completes. It flips the
 * matching acknowledgment (matched by envelope_id, across all employers — the
 * webhook is not employer-scoped) to 'signed'. Best-effort and idempotent.
 * Returns true when a row was flipped (used only for logging).
 */
export async function markAckSignedByEnvelope(envelopeId: string): Promise<boolean> {
  const c = db();
  if (!c || !envelopeId) return false;
  try {
    const { data, error } = await c
      .from("acknowledgments")
      .update({ status: "signed", acknowledged_at: new Date().toISOString() })
      .eq("envelope_id", envelopeId)
      .neq("status", "signed")
      .select("id");
    if (error) return false;
    return !!(data && data.length);
  } catch {
    return false;
  }
}

/** Manually mark an acknowledgment signed / waived (owner action). */
export async function setAckStatus(employerId: string, ackId: number, status: AckStatus): Promise<Acknowledgment | null> {
  const c = db();
  if (!c || !employerId || !ackId) return null;
  const row: Record<string, unknown> = { status };
  row.acknowledged_at = status === "pending" ? null : new Date().toISOString();
  try {
    const { data, error } = await c.from("acknowledgments").update(row).eq("employer_id", employerId).eq("id", ackId).select(ACK_COLS).single();
    if (error || !data) return null;
    return mapAck(data);
  } catch {
    return null;
  }
}

/** Record a quiz attempt on the acknowledgment (Part E). Keeps the best score
 *  and increments attempts; a passing attempt is signalled by the caller via
 *  `completed` (which marks it signed when no separate signature is required). */
export async function recordQuizAttempt(
  employerId: string,
  ackId: number,
  score: number,
  completed: boolean
): Promise<Acknowledgment | null> {
  const c = db();
  if (!c || !employerId || !ackId) return null;
  const current = await getAcknowledgment(employerId, ackId);
  if (!current) return null;
  const best = Math.max(current.score ?? 0, Math.round(score));
  const row: Record<string, unknown> = { score: best, attempts: current.attempts + 1 };
  if (completed && current.status === "pending") {
    row.status = "signed";
    row.acknowledged_at = new Date().toISOString();
  }
  try {
    const { data, error } = await c.from("acknowledgments").update(row).eq("employer_id", employerId).eq("id", ackId).select(ACK_COLS).single();
    if (error || !data) return null;
    return mapAck(data);
  } catch {
    return null;
  }
}

/** Stamp reminded_at so the UI can show when the last nudge went out. */
export async function markReminded(employerId: string, ackIds: number[]): Promise<void> {
  const c = db();
  if (!c || !employerId || !ackIds.length) return;
  try {
    await c.from("acknowledgments").update({ reminded_at: new Date().toISOString() }).eq("employer_id", employerId).in("id", ackIds);
  } catch {
    /* best-effort */
  }
}

/** The compliance grid for one doc: every assignee joined with their ack. */
export async function complianceGrid(employerId: string, doc: TrainingDoc): Promise<AckCell[]> {
  const employees = await listEmployees(employerId);
  const acks = await listAcknowledgmentsForDoc(employerId, doc.id);
  const byEmployee = new Map(acks.map((a) => [a.employeeId, a] as const));
  return assignees(doc, employees).map((employee) => ({ employee, ack: byEmployee.get(employee.id) ?? null }));
}
