import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { isCertAddedBy, type EmployeeCert, type CertAddedBy } from "./cert-hub";

/**
 * Certifications persistence — employer_id-scoped, service-role, best-effort
 * (same contract as the other employer stores). Optional files live in the
 * private "employee-certs" Storage bucket, same shape as the
 * envelope-attachments bucket in docusign-store.ts.
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

const COLS =
  "id, employee_id, name, issued_date, expiry_date, file_url, added_by, reminder_30_sent_at, reminder_7_sent_at, created_at";

function mapCert(r: Record<string, unknown>): EmployeeCert {
  return {
    id: r.id as number,
    employeeId: r.employee_id as number,
    name: (r.name as string) || "",
    issuedDate: (r.issued_date as string) || null,
    expiryDate: (r.expiry_date as string) || null,
    fileUrl: (r.file_url as string) || null,
    addedBy: (isCertAddedBy(r.added_by) ? r.added_by : "employer") as CertAddedBy,
    reminder30SentAt: (r.reminder_30_sent_at as string) || null,
    reminder7SentAt: (r.reminder_7_sent_at as string) || null,
    createdAt: (r.created_at as string) || "",
  };
}

export interface CertInput {
  name: string;
  issuedDate?: string | null;
  expiryDate?: string | null;
  fileUrl?: string | null;
  addedBy?: CertAddedBy;
}

export async function listCertsForEmployer(employerId: string): Promise<EmployeeCert[]> {
  const c = db();
  if (!c || !employerId) return [];
  try {
    const { data } = await c.from("employee_certs").select(COLS).eq("employer_id", employerId).order("expiry_date", { ascending: true, nullsFirst: false });
    return (data || []).map(mapCert);
  } catch {
    return [];
  }
}

export async function listCertsForEmployee(employerId: string, employeeId: number): Promise<EmployeeCert[]> {
  const c = db();
  if (!c || !employerId || !employeeId) return [];
  try {
    const { data } = await c
      .from("employee_certs")
      .select(COLS)
      .eq("employer_id", employerId)
      .eq("employee_id", employeeId)
      .order("expiry_date", { ascending: true, nullsFirst: false });
    return (data || []).map(mapCert);
  } catch {
    return [];
  }
}

export async function getCert(employerId: string, id: number): Promise<EmployeeCert | null> {
  const c = db();
  if (!c || !employerId || !id) return null;
  try {
    const { data } = await c.from("employee_certs").select(COLS).eq("employer_id", employerId).eq("id", id).maybeSingle();
    return data ? mapCert(data) : null;
  } catch {
    return null;
  }
}

export async function createCert(employerId: string, employeeId: number, input: CertInput): Promise<EmployeeCert | null> {
  const c = db();
  if (!c || !employerId || !employeeId) return null;
  const name = (input.name || "").trim().slice(0, 200);
  if (!name) return null;
  try {
    const { data, error } = await c
      .from("employee_certs")
      .insert({
        employer_id: employerId,
        employee_id: employeeId,
        name,
        issued_date: input.issuedDate || null,
        expiry_date: input.expiryDate || null,
        file_url: input.fileUrl || null,
        added_by: input.addedBy === "employee" ? "employee" : "employer",
      })
      .select(COLS)
      .single();
    if (error || !data) {
      console.error("[createCert]", error);
      return null;
    }
    return mapCert(data);
  } catch (e) {
    console.error("[createCert]", e);
    return null;
  }
}

export async function updateCert(
  employerId: string,
  id: number,
  input: Partial<Pick<CertInput, "name" | "issuedDate" | "expiryDate" | "fileUrl">>
): Promise<EmployeeCert | null> {
  const c = db();
  if (!c || !employerId || !id) return null;
  const row: Record<string, unknown> = { updated_at: new Date().toISOString() };
  if (input.name !== undefined) row.name = input.name.trim().slice(0, 200);
  if (input.issuedDate !== undefined) row.issued_date = input.issuedDate || null;
  if (input.expiryDate !== undefined) {
    row.expiry_date = input.expiryDate || null;
    // A new expiry date means the old reminder schedule no longer applies.
    row.reminder_30_sent_at = null;
    row.reminder_7_sent_at = null;
  }
  if (input.fileUrl !== undefined) row.file_url = input.fileUrl || null;
  try {
    const { data, error } = await c.from("employee_certs").update(row).eq("employer_id", employerId).eq("id", id).select(COLS).single();
    if (error || !data) return null;
    return mapCert(data);
  } catch {
    return null;
  }
}

export async function deleteCert(employerId: string, id: number): Promise<boolean> {
  const c = db();
  if (!c || !employerId || !id) return false;
  try {
    const { error } = await c.from("employee_certs").delete().eq("employer_id", employerId).eq("id", id);
    return !error;
  } catch {
    return false;
  }
}

// ── File storage (private "employee-certs" bucket) ─────────────────────────
const CERT_BUCKET = "employee-certs";
export const MAX_CERT_FILE_BYTES = 10 * 1024 * 1024; // 10 MB

export const CERT_FILE_EXT: Record<string, string> = {
  pdf: "application/pdf",
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  png: "image/png",
  doc: "application/msword",
  docx: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
};

function sanitizeFileName(name: string): string {
  const dot = name.lastIndexOf(".");
  const base = (dot > 0 ? name.slice(0, dot) : name).toLowerCase();
  return base.replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 60) || "file";
}

export function certFileExt(filename: string, mime?: string): string | null {
  const dot = filename.lastIndexOf(".");
  const ext = dot >= 0 ? filename.slice(dot + 1).toLowerCase() : "";
  if (ext && CERT_FILE_EXT[ext]) return ext;
  const byMime = Object.entries(CERT_FILE_EXT).find(([, m]) => m === mime);
  return byMime ? byMime[0] : null;
}

/** Upload into `{employerId}/{employeeId}/…`; returns the storage path. */
export async function uploadCertFile(
  employerId: string,
  employeeId: number,
  file: { data: Buffer | Uint8Array; filename: string; ext: string }
): Promise<{ path: string } | null> {
  const c = db();
  if (!c || !employerId || !employeeId) return null;
  const contentType = CERT_FILE_EXT[file.ext] || "application/octet-stream";
  const path = `${employerId}/${employeeId}/${Date.now()}-${sanitizeFileName(file.filename)}.${file.ext}`;
  try {
    const { error } = await c.storage.from(CERT_BUCKET).upload(path, file.data, { contentType, upsert: false });
    if (error) {
      console.error("[uploadCertFile]", error);
      return null;
    }
    return { path };
  } catch (e) {
    console.error("[uploadCertFile]", e);
    return null;
  }
}

/** Download a cert file's bytes — only within the employer's own folder. */
export async function downloadCertFile(employerId: string, path: string): Promise<{ bytes: Buffer; contentType: string } | null> {
  const c = db();
  if (!c || !employerId || !path || !path.startsWith(`${employerId}/`)) return null;
  try {
    const { data, error } = await c.storage.from(CERT_BUCKET).download(path);
    if (error || !data) return null;
    const bytes = Buffer.from(await data.arrayBuffer());
    if (!bytes.length) return null;
    const ext = path.slice(path.lastIndexOf(".") + 1).toLowerCase();
    return { bytes, contentType: CERT_FILE_EXT[ext] || "application/octet-stream" };
  } catch (e) {
    console.error("[downloadCertFile]", e);
    return null;
  }
}

// ── Cross-employer reminder scan (used only by the reminder cron) ──────────
export interface CertWithEmployee extends EmployeeCert {
  employerId: string;
  employeeName: string;
  employeeEmail: string;
}

/** Every cert with an expiry date, joined to its employee — for the daily
 *  reminder scan. Not employer-scoped (the cron runs platform-wide); the
 *  service-role key is the only caller with access to this function. */
export async function listCertsForReminderScan(): Promise<CertWithEmployee[]> {
  const c = db();
  if (!c) return [];
  try {
    const { data, error } = await c
      .from("employee_certs")
      .select(`${COLS}, employer_id, employees(name, email)`)
      .not("expiry_date", "is", null)
      .limit(10000);
    if (error || !data) return [];
    return data.map((r: Record<string, unknown>) => {
      const emp = (r.employees as { name?: string; email?: string } | null) || null;
      return {
        ...mapCert(r),
        employerId: r.employer_id as string,
        employeeName: emp?.name || "",
        employeeEmail: emp?.email || "",
      };
    });
  } catch (e) {
    console.error("[listCertsForReminderScan]", e);
    return [];
  }
}

/** Stamp one or both reminder markers after sending (best-effort, fire once). */
export async function markCertReminded(id: number, which: "30" | "7"): Promise<void> {
  const c = db();
  if (!c || !id) return;
  try {
    await c
      .from("employee_certs")
      .update(which === "30" ? { reminder_30_sent_at: new Date().toISOString() } : { reminder_7_sent_at: new Date().toISOString() })
      .eq("id", id);
  } catch {
    /* best-effort */
  }
}
