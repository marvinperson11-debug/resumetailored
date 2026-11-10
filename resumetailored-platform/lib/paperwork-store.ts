import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { encryptBankField, last4, paperworkEncryptionConfigured } from "./paperwork-crypto";

/**
 * Onboarding paperwork packet persistence (W-4, I-9, direct deposit — the
 * offer letter lives in docusign_envelopes and the handbook acknowledgment
 * lives in `acknowledgments`, see migration 0096's header). Service-role,
 * employer_id-scoped, best-effort, same contract as the other employer
 * stores.
 *
 * Paperwork honesty, enforced here rather than just in copy: nothing in this
 * module ever calls out to the IRS, a state new-hire-reporting API, or
 * E-Verify. `status` only ever moves between 'not_started' / 'submitted' /
 * 'verified' — there is no 'filed' state, because V1 files nothing with any
 * government agency.
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

export const PAPERWORK_KINDS = ["w4", "i9", "direct_deposit"] as const;
export type PaperworkKind = (typeof PAPERWORK_KINDS)[number];
export const isPaperworkKind = (v: unknown): v is PaperworkKind => (PAPERWORK_KINDS as readonly string[]).includes(String(v));

export const PAPERWORK_STATUSES = ["not_started", "submitted", "verified"] as const;
export type PaperworkStatus = (typeof PAPERWORK_STATUSES)[number];

export interface PaperworkRow {
  id: number;
  employeeId: number;
  kind: PaperworkKind;
  status: PaperworkStatus;
  data: Record<string, unknown>;
  last4: string | null;
  submittedAt: string | null;
  verifiedAt: string | null;
  verifiedBy: string | null;
  createdAt: string;
  updatedAt: string;
}

const COLS = "id, employee_id, kind, status, data, last4, submitted_at, verified_at, verified_by, created_at, updated_at";

function mapRow(r: Record<string, unknown>): PaperworkRow {
  return {
    id: r.id as number,
    employeeId: r.employee_id as number,
    kind: (isPaperworkKind(r.kind) ? r.kind : "w4") as PaperworkKind,
    status: (r.status as PaperworkStatus) || "not_started",
    data: (r.data as Record<string, unknown>) || {},
    last4: (r.last4 as string) || null,
    submittedAt: (r.submitted_at as string) || null,
    verifiedAt: (r.verified_at as string) || null,
    verifiedBy: (r.verified_by as string) || null,
    createdAt: (r.created_at as string) || "",
    updatedAt: (r.updated_at as string) || "",
  };
}

/** All three kinds for one employee, as a map — a kind with no row yet is
 *  simply absent (the caller treats that as 'not_started'). */
export async function getPaperworkForEmployee(employerId: string, employeeId: number): Promise<Record<PaperworkKind, PaperworkRow | null>> {
  const empty = { w4: null, i9: null, direct_deposit: null } as Record<PaperworkKind, PaperworkRow | null>;
  const c = db();
  if (!c || !employerId || !employeeId) return empty;
  try {
    const { data } = await c.from("onboarding_paperwork").select(COLS).eq("employer_id", employerId).eq("employee_id", employeeId);
    for (const row of data || []) {
      const mapped = mapRow(row);
      empty[mapped.kind] = mapped;
    }
    return empty;
  } catch {
    return empty;
  }
}

async function upsertStatus(employerId: string, employeeId: number, kind: PaperworkKind, patch: Record<string, unknown>): Promise<PaperworkRow | null> {
  const c = db();
  if (!c || !employerId || !employeeId) return null;
  try {
    const { data, error } = await c
      .from("onboarding_paperwork")
      .upsert({ employer_id: employerId, employee_id: employeeId, kind, ...patch, updated_at: new Date().toISOString() }, { onConflict: "employer_id,employee_id,kind" })
      .select(COLS)
      .single();
    if (error || !data) {
      console.error("[paperwork-store] upsert failed", { employeeId, kind, error });
      return null;
    }
    return mapRow(data);
  } catch (e) {
    console.error("[paperwork-store] upsert threw", { employeeId, kind, error: e });
    return null;
  }
}

/** The employee's own W-4 submission. Deliberately does NOT collect a Social
 *  Security Number — V1's form captures the withholding elections only,
 *  which is the part that actually changes based on the employee's answers;
 *  SSN collection for a field this sensitive is left to the employer's own
 *  paper/HR process rather than added to this app's attack surface. */
export interface W4Input {
  filingStatus: "single" | "married_jointly" | "head_of_household";
  multipleJobsOrSpouseWorks: boolean;
  claimDependentsCents: number;
  otherIncomeCents: number;
  deductionsCents: number;
  extraWithholdingCents: number;
  signatureName: string;
}
export async function submitW4(employerId: string, employeeId: number, input: W4Input): Promise<PaperworkRow | null> {
  if (!input.signatureName.trim()) return null;
  return upsertStatus(employerId, employeeId, "w4", {
    status: "submitted",
    data: { ...input, signatureName: input.signatureName.trim() },
    submitted_at: new Date().toISOString(),
  });
}

/** I-9 Section 1 — the employee's own attestation + their uploaded ID/work-
 *  authorization document. `idDocPath` is a private Storage path (see
 *  uploadIdDocument), never a public URL. */
export interface I9Section1Input {
  citizenshipStatus: "citizen" | "noncitizen_national" | "lawful_permanent_resident" | "authorized_alien";
  fullLegalName: string;
  signatureName: string;
  idDocPath: string;
}
export async function submitI9Section1(employerId: string, employeeId: number, input: I9Section1Input): Promise<PaperworkRow | null> {
  if (!input.signatureName.trim() || !input.idDocPath) return null;
  return upsertStatus(employerId, employeeId, "i9", {
    status: "submitted",
    data: { ...input, signatureName: input.signatureName.trim() },
    submitted_at: new Date().toISOString(),
  });
}

/** I-9 Section 2 — the employer confirms they examined the document and
 *  recorded it. This is the ONLY step V1 does for I-9: no E-Verify call, no
 *  submission anywhere. `verified` is the terminal "on file" state. */
export async function verifyI9Section2(employerId: string, employeeId: number, verifiedBy: string, documentTitle: string): Promise<PaperworkRow | null> {
  const existing = (await getPaperworkForEmployee(employerId, employeeId)).i9;
  if (!existing || existing.status !== "submitted") return null; // Section 1 must exist first
  return upsertStatus(employerId, employeeId, "i9", {
    status: "verified",
    data: { ...existing.data, documentTitle: (documentTitle || "").trim().slice(0, 200) },
    verified_at: new Date().toISOString(),
    verified_by: verifiedBy,
  });
}

/** Direct deposit — the only form with a truly sensitive field. Fails
 *  closed if PAPERWORK_ENC_KEY isn't configured rather than ever storing a
 *  bank/routing number unencrypted. */
export interface DirectDepositInput {
  bankName: string;
  accountType: "checking" | "savings";
  routingNumber: string;
  accountNumber: string;
  signatureName: string;
}
export type SubmitDirectDepositResult = { ok: true; row: PaperworkRow } | { ok: false; reason: "not_configured" | "invalid" | "save_failed" };
export async function submitDirectDeposit(employerId: string, employeeId: number, input: DirectDepositInput): Promise<SubmitDirectDepositResult> {
  if (!paperworkEncryptionConfigured()) return { ok: false, reason: "not_configured" };
  const routing = (input.routingNumber || "").replace(/\D/g, "");
  const account = (input.accountNumber || "").replace(/\s+/g, "");
  if (!input.signatureName.trim() || routing.length !== 9 || account.length < 4) return { ok: false, reason: "invalid" };
  const encBlob = encryptBankField(JSON.stringify({ routingNumber: routing, accountNumber: account }));
  const row = await upsertStatus(employerId, employeeId, "direct_deposit", {
    status: "submitted",
    data: { bankName: (input.bankName || "").trim().slice(0, 200), accountType: input.accountType, signatureName: input.signatureName.trim(), routingLast4: last4(routing) },
    enc_blob: encBlob,
    last4: last4(account),
    submitted_at: new Date().toISOString(),
  });
  if (!row) return { ok: false, reason: "save_failed" };
  return { ok: true, row };
}

// ── ID document upload (private Storage bucket) ──────────────────────────────
const ID_DOCS_BUCKET = "onboarding-id-docs";
export const MAX_ID_DOC_BYTES = 8 * 1024 * 1024;

export async function uploadIdDocument(employerId: string, employeeId: number, file: { data: Uint8Array; contentType: string }, ext: string): Promise<string | null> {
  const c = db();
  if (!c || !employerId || !employeeId) return null;
  const path = `${employerId}/${employeeId}-id-${Date.now()}.${ext}`;
  try {
    const { error } = await c.storage.from(ID_DOCS_BUCKET).upload(path, file.data, { contentType: file.contentType, upsert: false });
    if (error) {
      console.error("[uploadIdDocument]", error);
      return null;
    }
    return path;
  } catch (e) {
    console.error("[uploadIdDocument]", e);
    return null;
  }
}

/** A short-lived signed URL, owner-checked by the employer_id path prefix —
 *  same convention as lib/books-store.ts `signReceiptUrl`. */
export async function signIdDocumentUrl(employerId: string, path: string, seconds = 300): Promise<string | null> {
  const c = db();
  if (!c || !employerId || !path || !path.startsWith(`${employerId}/`)) return null;
  try {
    const { data, error } = await c.storage.from(ID_DOCS_BUCKET).createSignedUrl(path, seconds);
    return error || !data ? null : data.signedUrl;
  } catch {
    return null;
  }
}
