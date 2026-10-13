import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import type { Vacancy } from "./types";

/** Supabase access for the document pipeline (service role; every row scoped by Clerk user_id). */
export const DOCS_BUCKET = "generated-documents";

let cached: SupabaseClient | null = null;
export function docsDb(): SupabaseClient | null {
  if (cached) return cached;
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SERVICE_KEY;
  if (!url || !key) return null;
  cached = createClient(url, key, { auth: { persistSession: false } });
  return cached;
}

type Row = { id: string; employer: string; position: string; description: string; employer_address: string[] | null };
const toVacancy = (r: Row): Vacancy => ({
  id: r.id, employer: r.employer, position: r.position, description: r.description || "", employerAddress: r.employer_address?.length ? r.employer_address : undefined,
});

export async function createVacancy(userId: string, v: { employer: string; position: string; description: string; employerAddress?: string[] }): Promise<Vacancy | null> {
  const c = docsDb();
  if (!c) return null;
  const { data, error } = await c
    .from("vacancies")
    .insert({ user_id: userId, employer: v.employer.trim(), position: v.position.trim(), description: v.description, employer_address: v.employerAddress || [] })
    .select("id, employer, position, description, employer_address")
    .single();
  if (error || !data) { console.error("[docs] vacancy insert", error?.message); return null; }
  return toVacancy(data as Row);
}

/** A FRESH read of the vacancy by id, scoped to its owner. The only place a run learns the employer's name. */
export async function getVacancy(userId: string, id: string): Promise<Vacancy | null> {
  const c = docsDb();
  if (!c) return null;
  const { data, error } = await c.from("vacancies").select("id, employer, position, description, employer_address").eq("user_id", userId).eq("id", id).maybeSingle();
  return error || !data ? null : toVacancy(data as Row);
}

/** Employer names on the user's OTHER vacancies — what a wrong-company mix-up would come from. */
export async function otherEmployers(userId: string, excludeId: string): Promise<string[]> {
  const c = docsDb();
  if (!c) return [];
  const { data } = await c.from("vacancies").select("employer").eq("user_id", userId).neq("id", excludeId).order("created_at", { ascending: false }).limit(200);
  return Array.from(new Set((data || []).map((r) => String((r as { employer: string }).employer)).filter(Boolean)));
}

/** The candidate's stored career evidence: their most recently saved resume text. */
export async function latestProfileText(userId: string): Promise<string> {
  const c = docsDb();
  if (!c) return "";
  const { data } = await c.from("resume_drafts").select("content").eq("user_id", userId).order("updated_at", { ascending: false }).limit(5);
  for (const r of data || []) {
    const t = String(((r as { content?: { resumeText?: string } }).content || {}).resumeText || "").trim();
    if (t) return t;
  }
  return "";
}

let bucketReady = false;
async function ensureBucket(c: SupabaseClient) {
  if (bucketReady) return;
  const { error } = await c.storage.createBucket(DOCS_BUCKET, { public: false });
  if (error && !/already exists|duplicate/i.test(error.message)) console.warn("[docs] bucket", error.message);
  bucketReady = true;
}

export async function putFile(path: string, bytes: Buffer | Uint8Array, contentType: string): Promise<boolean> {
  const c = docsDb();
  if (!c) return false;
  await ensureBucket(c);
  const { error } = await c.storage.from(DOCS_BUCKET).upload(path, bytes, { contentType, upsert: true });
  if (error) console.error("[docs] upload", error.message);
  return !error;
}
export async function getFile(path: string): Promise<Buffer | null> {
  const c = docsDb();
  if (!c) return null;
  const { data, error } = await c.storage.from(DOCS_BUCKET).download(path);
  return error || !data ? null : Buffer.from(await data.arrayBuffer());
}
export async function signedUrl(path: string, downloadAs: string, seconds = 3600): Promise<string | null> {
  const c = docsDb();
  if (!c) return null;
  const { data, error } = await c.storage.from(DOCS_BUCKET).createSignedUrl(path, seconds, { download: downloadAs });
  return error || !data ? null : data.signedUrl;
}
