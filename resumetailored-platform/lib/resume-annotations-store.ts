import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import {
  MAX_ANNOTATIONS_PER_RESUME,
  SIGNED_URL_TTL_SECONDS,
  type AnnotationInput,
  type AnnotationPatch,
  type ResumeAnnotation,
} from "./resume-annotations";

/**
 * Supabase implementation behind the employer resume viewer (migration 0049): the applicant → PDF link
 * (`applicant_resume_files`), 60-second signed URLs into the PRIVATE `applicant-resumes` bucket, and the
 * employer's own annotations (`resume_annotations`).
 *
 * Service-role access, like every employer store. EVERY query here is scoped by employer_id — and applicant
 * ownership is proven through the applicant's job (the same rule employer-store's getApplicant uses) before a
 * file, a URL or an annotation is touched. This is the only module that reads or writes resume_annotations:
 * nothing candidate-facing imports it, and test/test-resume-viewer.cjs scans the source to keep it that way.
 */
const BUCKET = "applicant-resumes";

let cached: SupabaseClient | null = null;
function db(): SupabaseClient | null {
  if (cached) return cached;
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SERVICE_KEY;
  if (!url || !key) return null;
  cached = createClient(url, key, { auth: { persistSession: false } });
  return cached;
}

export interface ApplicantResumeFile {
  id: string;
  applicantId: number;
  filename: string;
  sizeBytes: number;
}

interface FileRow {
  id: string;
  employer_id: string;
  applicant_id: number;
  storage_path: string;
  filename: string;
  size_bytes: number | string;
}

const fileOut = (r: FileRow): ApplicantResumeFile => ({ id: r.id, applicantId: r.applicant_id, filename: r.filename, sizeBytes: Number(r.size_bytes) || 0 });

/** Does this applicant belong to this employer (via the applicant's job)? */
export async function employerOwnsApplicant(employerId: string, applicantId: number): Promise<boolean> {
  const c = db();
  if (!c || !employerId || !Number.isInteger(applicantId) || applicantId < 1) return false;
  try {
    const { data: a } = await c.from("applicants").select("id, job_id").eq("id", applicantId).maybeSingle();
    if (!a) return false;
    const { data: job } = await c.from("job_postings").select("id").eq("id", a.job_id as number).eq("employer_id", employerId).maybeSingle();
    return !!job;
  } catch {
    return false;
  }
}

/** The PDF linked to an applicant, or null. Caller must have proven ownership first. */
export async function getResumeFile(employerId: string, applicantId: number): Promise<(ApplicantResumeFile & { storagePath: string }) | null> {
  const c = db();
  if (!c) return null;
  try {
    const { data } = await c.from("applicant_resume_files").select("id, employer_id, applicant_id, storage_path, filename, size_bytes").eq("employer_id", employerId).eq("applicant_id", applicantId).maybeSingle();
    if (!data) return null;
    const row = data as FileRow;
    return { ...fileOut(row), storagePath: row.storage_path };
  } catch {
    return null;
  }
}

/** Record (or replace) the PDF for an applicant. Called from add-applicant once the applicant exists. */
export async function linkResumeFile(
  employerId: string,
  applicantId: number,
  file: { storagePath: string; filename: string; sizeBytes: number }
): Promise<boolean> {
  const c = db();
  if (!c) return false;
  try {
    const { error } = await c.from("applicant_resume_files").upsert(
      { employer_id: employerId, applicant_id: applicantId, storage_path: file.storagePath, filename: file.filename.slice(0, 200), size_bytes: file.sizeBytes },
      { onConflict: "applicant_id" }
    );
    return !error;
  } catch {
    return false;
  }
}

/** A short-lived signed URL for the stored PDF. The bucket is private; this is the ONLY way a browser gets bytes. */
export async function signResumeUrl(storagePath: string, ttl: number = SIGNED_URL_TTL_SECONDS): Promise<string | null> {
  const c = db();
  if (!c) return null;
  try {
    const { data, error } = await c.storage.from(BUCKET).createSignedUrl(storagePath, ttl);
    if (error || !data?.signedUrl) return null;
    return data.signedUrl;
  } catch {
    return null;
  }
}

// ── annotations ──────────────────────────────────────────────────────────────

interface AnnRow {
  id: string;
  candidate_resume_id: string;
  page: number;
  x: number;
  y: number;
  w: number;
  h: number;
  kind: string;
  text: string;
  color: string;
  created_by: string;
  created_at: string;
  updated_at: string;
}
const COLS = "id, candidate_resume_id, page, x, y, w, h, kind, text, color, created_by, created_at, updated_at";

const annOut = (r: AnnRow): ResumeAnnotation => ({
  id: r.id,
  candidateResumeId: r.candidate_resume_id,
  page: r.page,
  x: Number(r.x),
  y: Number(r.y),
  w: Number(r.w),
  h: Number(r.h),
  kind: r.kind === "note" ? "note" : "highlight",
  text: r.text || "",
  color: (["yellow", "green", "blue", "pink"].includes(r.color) ? r.color : "yellow") as ResumeAnnotation["color"],
  createdBy: r.created_by,
  createdAt: r.created_at,
  updatedAt: r.updated_at,
});

export async function listAnnotations(employerId: string, resumeId: string): Promise<ResumeAnnotation[]> {
  const c = db();
  if (!c) return [];
  try {
    const { data } = await c.from("resume_annotations").select(COLS).eq("employer_id", employerId).eq("candidate_resume_id", resumeId).order("page", { ascending: true }).order("created_at", { ascending: true }).limit(MAX_ANNOTATIONS_PER_RESUME);
    return ((data as AnnRow[] | null) || []).map(annOut);
  } catch {
    return [];
  }
}

export type CreateResult = { ok: true; annotation: ResumeAnnotation } | { ok: false; error: "limit" | "failed" };

export async function createAnnotation(employerId: string, resumeId: string, createdBy: string, input: AnnotationInput): Promise<CreateResult> {
  const c = db();
  if (!c) return { ok: false, error: "failed" };
  try {
    const { count } = await c.from("resume_annotations").select("id", { count: "exact", head: true }).eq("employer_id", employerId).eq("candidate_resume_id", resumeId);
    if ((count ?? 0) >= MAX_ANNOTATIONS_PER_RESUME) return { ok: false, error: "limit" };
    const { data, error } = await c
      .from("resume_annotations")
      .insert({ employer_id: employerId, candidate_resume_id: resumeId, created_by: createdBy, ...input })
      .select(COLS)
      .single();
    if (error || !data) return { ok: false, error: "failed" };
    return { ok: true, annotation: annOut(data as AnnRow) };
  } catch {
    return { ok: false, error: "failed" };
  }
}

export async function updateAnnotation(employerId: string, resumeId: string, id: string, patch: AnnotationPatch): Promise<ResumeAnnotation | null> {
  const c = db();
  if (!c) return null;
  try {
    const { data, error } = await c
      .from("resume_annotations")
      .update({ ...patch, updated_at: new Date().toISOString() })
      .eq("id", id)
      .eq("employer_id", employerId)
      .eq("candidate_resume_id", resumeId)
      .select(COLS)
      .maybeSingle();
    if (error || !data) return null;
    return annOut(data as AnnRow);
  } catch {
    return null;
  }
}

export async function deleteAnnotation(employerId: string, resumeId: string, id: string): Promise<boolean> {
  const c = db();
  if (!c) return false;
  try {
    const { data, error } = await c.from("resume_annotations").delete().eq("id", id).eq("employer_id", employerId).eq("candidate_resume_id", resumeId).select("id");
    return !error && !!data && data.length > 0;
  } catch {
    return false;
  }
}
