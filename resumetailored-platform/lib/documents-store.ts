import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import type { EmployerDocument } from "./employer-ai";

/**
 * Document Creator persistence — one `documents` row per composed document,
 * owner-scoped by employer_id (Clerk user id, TEXT). Same service-role pattern
 * as the other employer stores; best-effort (unconfigured/unreachable Supabase
 * resolves to empty reads / null writes, never a throw).
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

const COLS = "id, title, body_html, created_at, updated_at";

function mapDoc(r: Record<string, unknown>): EmployerDocument {
  return {
    id: r.id as number,
    title: (r.title as string) || "Untitled document",
    bodyHtml: (r.body_html as string) || "",
    createdAt: (r.created_at as string) || "",
    updatedAt: (r.updated_at as string) || "",
  };
}

/**
 * Minimal HTML sanitizer for stored document bodies. The content is the
 * employer's own, but it is later rendered (editor preview) and embedded into a
 * DocuSign HTML document, so strip anything executable: <script>/<style>, event
 * handler attributes, and javascript: URLs. Not a full sanitizer — a safety net
 * over first-party content.
 */
export function sanitizeDocumentHtml(html: string): string {
  let out = String(html || "");
  out = out.replace(/<\/?(?:script|style|iframe|object|embed|link|meta)\b[^>]*>/gi, "");
  out = out.replace(/\son\w+\s*=\s*"[^"]*"/gi, "");
  out = out.replace(/\son\w+\s*=\s*'[^']*'/gi, "");
  out = out.replace(/\son\w+\s*=\s*[^\s>]+/gi, "");
  out = out.replace(/(href|src)\s*=\s*("|')\s*javascript:[^"']*\2/gi, '$1="#"');
  return out.slice(0, 200000);
}

export async function listDocuments(employerId: string): Promise<EmployerDocument[]> {
  const c = db();
  if (!c || !employerId) return [];
  try {
    const { data, error } = await c
      .from("documents")
      .select(COLS)
      .eq("employer_id", employerId)
      .order("updated_at", { ascending: false })
      .limit(500);
    if (error || !data) return [];
    return data.map(mapDoc);
  } catch {
    return [];
  }
}

export async function getDocument(employerId: string, id: number): Promise<EmployerDocument | null> {
  const c = db();
  if (!c || !employerId || !id) return null;
  try {
    const { data } = await c.from("documents").select(COLS).eq("employer_id", employerId).eq("id", id).maybeSingle();
    return data ? mapDoc(data) : null;
  } catch {
    return null;
  }
}

export async function createDocument(employerId: string, v: { title: string; bodyHtml: string }): Promise<EmployerDocument | null> {
  const c = db();
  if (!c || !employerId) return null;
  try {
    const { data, error } = await c
      .from("documents")
      .insert({ employer_id: employerId, title: (v.title || "Untitled document").slice(0, 200), body_html: sanitizeDocumentHtml(v.bodyHtml) })
      .select(COLS)
      .single();
    if (error || !data) {
      console.error("[createDocument]", error);
      return null;
    }
    return mapDoc(data);
  } catch (e) {
    console.error("[createDocument]", e);
    return null;
  }
}

export async function updateDocument(
  employerId: string,
  id: number,
  v: { title?: string; bodyHtml?: string }
): Promise<EmployerDocument | null> {
  const c = db();
  if (!c || !employerId || !id) return null;
  const row: Record<string, unknown> = { updated_at: new Date().toISOString() };
  if (v.title !== undefined) row.title = (v.title || "Untitled document").slice(0, 200);
  if (v.bodyHtml !== undefined) row.body_html = sanitizeDocumentHtml(v.bodyHtml);
  try {
    const { data, error } = await c
      .from("documents")
      .update(row)
      .eq("employer_id", employerId)
      .eq("id", id)
      .select(COLS)
      .single();
    if (error || !data) return null;
    return mapDoc(data);
  } catch {
    return null;
  }
}

export async function deleteDocument(employerId: string, id: number): Promise<boolean> {
  const c = db();
  if (!c || !employerId || !id) return false;
  try {
    const { error } = await c.from("documents").delete().eq("employer_id", employerId).eq("id", id);
    return !error;
  } catch {
    return false;
  }
}
