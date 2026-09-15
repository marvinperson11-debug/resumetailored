import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import type { DocusignEnvelope, DocusignConnection, DocusignStatus, OfferTerms, DocType, EsignTemplate, EditableDocType } from "./employer-ai";
import { isDocusignStatus, isDocusignTerminal, isDocType, EDITABLE_DOC_TYPES } from "./employer-ai";
import {
  encryptToken,
  decryptToken,
  refreshAccessToken,
  DEFAULT_TEMPLATES,
  type DocusignAccountInfo,
} from "./docusign";

/**
 * DocuSign persistence (Employer Portal Phase 1B). Mirrors employer-store.ts:
 * one service-role client, every query scoped by employer_id. The two tables
 * (docusign_connections, docusign_envelopes) are service-role-only with RLS, so
 * tokens never leave the server. Best-effort throughout — an unconfigured or
 * unreachable Supabase resolves to empty reads / false writes, never a throw.
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

// ── Connections (OAuth token cache) ───────────────────────────────────────────
interface ConnectionRow {
  employer_id: string;
  account_id: string | null;
  account_name: string | null;
  account_email: string | null;
  base_uri: string | null;
  access_token: string | null;
  access_token_expires_at: string | null;
  refresh_token: string | null;
}

/** Persist a fresh connection (after consent) or refreshed tokens. The refresh
 *  token is encrypted at rest. */
export async function saveConnection(
  employerId: string,
  info: DocusignAccountInfo,
  tokens: { accessToken: string; refreshToken: string; expiresIn: number }
): Promise<boolean> {
  const c = db();
  if (!c || !employerId) return false;
  try {
    const expiresAt = new Date(Date.now() + tokens.expiresIn * 1000).toISOString();
    const { error } = await c.from("docusign_connections").upsert(
      {
        employer_id: employerId,
        account_id: info.accountId,
        account_name: info.accountName,
        account_email: info.email,
        base_uri: info.baseUri,
        access_token: tokens.accessToken,
        access_token_expires_at: expiresAt,
        refresh_token: encryptToken(tokens.refreshToken),
        updated_at: new Date().toISOString(),
      },
      { onConflict: "employer_id" }
    );
    return !error;
  } catch {
    return false;
  }
}

/** Update only the token columns after a refresh (keeps account metadata). */
async function updateTokens(
  employerId: string,
  tokens: { accessToken: string; refreshToken: string; expiresIn: number }
): Promise<void> {
  const c = db();
  if (!c) return;
  try {
    await c
      .from("docusign_connections")
      .update({
        access_token: tokens.accessToken,
        access_token_expires_at: new Date(Date.now() + tokens.expiresIn * 1000).toISOString(),
        // Refresh-token rotation: persist the new one when DocuSign returns it.
        ...(tokens.refreshToken ? { refresh_token: encryptToken(tokens.refreshToken) } : {}),
        updated_at: new Date().toISOString(),
      })
      .eq("employer_id", employerId);
  } catch {
    /* best-effort */
  }
}

async function getConnectionRow(employerId: string): Promise<ConnectionRow | null> {
  const c = db();
  if (!c || !employerId) return null;
  try {
    const { data } = await c
      .from("docusign_connections")
      .select("employer_id, account_id, account_name, account_email, base_uri, access_token, access_token_expires_at, refresh_token")
      .eq("employer_id", employerId)
      .maybeSingle();
    return (data as ConnectionRow) || null;
  } catch {
    return null;
  }
}

/** Client-safe connection status for the status page (never exposes tokens). */
export async function getConnectionStatus(employerId: string): Promise<DocusignConnection> {
  const row = await getConnectionRow(employerId);
  const connected = !!(row && row.refresh_token);
  return {
    connected,
    accountName: (row?.account_name as string) || "",
    accountEmail: (row?.account_email as string) || "",
  };
}

export async function deleteConnection(employerId: string): Promise<boolean> {
  const c = db();
  if (!c || !employerId) return false;
  try {
    const { error } = await c.from("docusign_connections").delete().eq("employer_id", employerId);
    return !error;
  } catch {
    return false;
  }
}

export interface AccessContext {
  accessToken: string;
  baseUri: string;
  accountId: string;
}

/**
 * Return a valid access token for this employer, refreshing (and persisting the
 * rotated refresh token) when the cached one is expired or about to expire.
 * `null` when not connected or the refresh fails (the caller re-prompts consent).
 */
export async function getValidAccessToken(employerId: string): Promise<AccessContext | null> {
  const row = await getConnectionRow(employerId);
  if (!row || !row.refresh_token || !row.account_id) return null;

  const baseUri = row.base_uri || "";
  const accountId = row.account_id;
  const notExpired =
    row.access_token &&
    row.access_token_expires_at &&
    new Date(row.access_token_expires_at).getTime() - Date.now() > 60_000; // 60s skew

  if (notExpired && row.access_token) {
    return { accessToken: row.access_token, baseUri, accountId };
  }

  const refreshToken = decryptToken(row.refresh_token);
  if (!refreshToken) return null;
  const tokens = await refreshAccessToken(refreshToken);
  if (!tokens) return null;
  await updateTokens(employerId, tokens);
  return { accessToken: tokens.accessToken, baseUri, accountId };
}

// ── Monthly usage ─────────────────────────────────────────────────────────────
/** Count offer-letter sends by this employer in the current calendar month (UTC). */
export async function monthlySendCount(employerId: string): Promise<number> {
  const c = db();
  if (!c || !employerId) return 0;
  try {
    const now = new Date();
    const monthStart = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1)).toISOString();
    const { count } = await c
      .from("docusign_envelopes")
      .select("id", { count: "exact", head: true })
      .eq("employer_id", employerId)
      .gte("sent_at", monthStart);
    return count || 0;
  } catch {
    return 0;
  }
}

// ── Envelopes ─────────────────────────────────────────────────────────────────
const ENV_COLS =
  "id, doc_type, document_name, applicant_id, shortlist_member_id, envelope_id, subject, message, status, offer, candidate_name, candidate_email, sent_by, sent_at, completed_at, created_at";

function mapOffer(v: unknown): OfferTerms {
  const o = (v && typeof v === "object" ? v : {}) as Record<string, unknown>;
  return {
    position: String(o.position || ""),
    salary: String(o.salary || ""),
    startDate: String(o.startDate || o.start_date || ""),
    extraTerms: o.extraTerms || o.extra_terms ? String(o.extraTerms || o.extra_terms) : "",
  };
}

function mapEnvelope(r: Record<string, unknown>): DocusignEnvelope {
  const status = isDocusignStatus(r.status) ? r.status : "sent";
  return {
    id: r.id as number,
    docType: isDocType(r.doc_type) ? r.doc_type : "offer",
    documentName: (r.document_name as string) || "",
    applicantId: (r.applicant_id as number) ?? null,
    shortlistMemberId: (r.shortlist_member_id as number) ?? null,
    envelopeId: (r.envelope_id as string) || "",
    subject: (r.subject as string) || "",
    message: (r.message as string) || "",
    status,
    offer: mapOffer(r.offer),
    candidateName: (r.candidate_name as string) || "",
    candidateEmail: (r.candidate_email as string) || "",
    sentBy: (r.sent_by as string) || "",
    sentAt: (r.sent_at as string) || "",
    completedAt: (r.completed_at as string) || null,
    createdAt: (r.created_at as string) || "",
  };
}

export async function createEnvelopeRecord(
  employerId: string,
  v: {
    docType: DocType;
    documentName?: string;
    applicantId: number | null;
    shortlistMemberId?: number | null;
    envelopeId: string;
    subject: string;
    message: string;
    status: DocusignStatus;
    offer: OfferTerms;
    candidateName: string;
    candidateEmail: string;
    sentBy: string;
  }
): Promise<DocusignEnvelope | null> {
  const c = db();
  if (!c || !employerId) return null;
  try {
    const { data, error } = await c
      .from("docusign_envelopes")
      .insert({
        employer_id: employerId,
        doc_type: v.docType,
        document_name: v.documentName || null,
        applicant_id: v.applicantId,
        shortlist_member_id: v.shortlistMemberId ?? null,
        envelope_id: v.envelopeId,
        subject: v.subject,
        message: v.message,
        status: v.status,
        offer: v.offer,
        candidate_name: v.candidateName,
        candidate_email: v.candidateEmail,
        sent_by: v.sentBy,
      })
      .select(ENV_COLS)
      .single();
    if (error || !data) {
      console.error("[createEnvelopeRecord] insert failed", { employerId, error });
      return null;
    }
    return mapEnvelope(data);
  } catch (e) {
    console.error("[createEnvelopeRecord] threw", { employerId, error: e });
    return null;
  }
}

// ── Applicant status sync (offer letters) ─────────────────────────────────────
/** When an OFFER is sent, advance the applicant to "offer extended" — but never
 *  downgrade someone already "hired". Only for doc_type 'offer'. Best-effort. */
export async function advanceApplicantOnSend(applicantId: number | null, docType: DocType): Promise<void> {
  const c = db();
  if (!c || docType !== "offer" || !applicantId) return;
  try {
    await c.from("applicants").update({ status: "offer extended" }).eq("id", applicantId).neq("status", "hired");
  } catch (e) {
    console.error("[advanceApplicantOnSend] failed", { applicantId, error: e });
  }
}

/** When an OFFER envelope completes, mark its applicant "hired". Reads the
 *  envelope's own applicant_id + doc_type, so it works from the webhook path
 *  (no employer scope). Best-effort. */
async function markHiredIfCompletedOffer(c: SupabaseClient, envelopeId: string): Promise<void> {
  try {
    const { data } = await c
      .from("docusign_envelopes")
      .select("applicant_id, doc_type")
      .eq("envelope_id", envelopeId)
      .maybeSingle();
    if (!data) return;
    const docType = (data.doc_type as string) || "offer";
    const applicantId = data.applicant_id as number | null;
    if (docType === "offer" && applicantId) {
      await c.from("applicants").update({ status: "hired" }).eq("id", applicantId);
    }
  } catch (e) {
    console.error("[markHiredIfCompletedOffer] failed", { envelopeId, error: e });
  }
}

export async function listEnvelopes(employerId: string): Promise<DocusignEnvelope[]> {
  const c = db();
  if (!c || !employerId) return [];
  try {
    const { data } = await c
      .from("docusign_envelopes")
      .select(ENV_COLS)
      .eq("employer_id", employerId)
      .order("sent_at", { ascending: false })
      .limit(500);
    return (data || []).map(mapEnvelope);
  } catch {
    return [];
  }
}

export async function getEnvelopeRecord(employerId: string, id: number): Promise<DocusignEnvelope | null> {
  const c = db();
  if (!c || !employerId) return null;
  try {
    const { data } = await c
      .from("docusign_envelopes")
      .select(ENV_COLS)
      .eq("employer_id", employerId)
      .eq("id", id)
      .maybeSingle();
    return data ? mapEnvelope(data) : null;
  } catch {
    return null;
  }
}

/** Envelopes that are not yet in a terminal state — candidates for a status poll. */
export async function listPollableEnvelopes(employerId: string): Promise<DocusignEnvelope[]> {
  return (await listEnvelopes(employerId)).filter((e) => e.envelopeId && !isDocusignTerminal(e.status));
}

async function applyStatus(c: SupabaseClient, envelopeId: string, status: DocusignStatus): Promise<void> {
  const patch: Record<string, unknown> = { status };
  if (status === "completed") patch.completed_at = new Date().toISOString();
  await c.from("docusign_envelopes").update(patch).eq("envelope_id", envelopeId);
  if (status === "completed") await markHiredIfCompletedOffer(c, envelopeId);
}

/** Update by envelope id (webhook path — the envelope id is globally unique, so
 *  no employer scope is needed). No-op on an unknown status/envelope. */
export async function updateStatusByEnvelopeId(envelopeId: string, status: string): Promise<boolean> {
  const c = db();
  if (!c || !envelopeId || !isDocusignStatus(status)) return false;
  try {
    await applyStatus(c, envelopeId, status);
    return true;
  } catch {
    return false;
  }
}

/** Update by employer + envelope id (poll path — scoped to the owner). */
export async function updateStatusOwned(employerId: string, envelopeId: string, status: string): Promise<boolean> {
  const c = db();
  if (!c || !employerId || !envelopeId || !isDocusignStatus(status)) return false;
  try {
    const patch: Record<string, unknown> = { status };
    if (status === "completed") patch.completed_at = new Date().toISOString();
    await c.from("docusign_envelopes").update(patch).eq("employer_id", employerId).eq("envelope_id", envelopeId);
    if (status === "completed") await markHiredIfCompletedOffer(c, envelopeId);
    return true;
  } catch {
    return false;
  }
}

// ── Custom-document storage (esign-documents private bucket) ───────────────────
const ESIGN_BUCKET = "esign-documents";
export const MAX_ESIGN_PDF_BYTES = 10 * 1024 * 1024; // 10 MB

function sanitizeDocFilename(name: string): string {
  const base = (name || "document").toLowerCase().replace(/\.[a-z0-9]+$/i, "");
  return base.replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 60) || "document";
}

/** Upload a PDF into the employer's own folder; returns its storage path. */
export async function uploadEsignDocument(
  employerId: string,
  file: { data: ArrayBuffer | Uint8Array; filename: string }
): Promise<{ path: string } | null> {
  const c = db();
  if (!c || !employerId) return null;
  const path = `${employerId}/${Date.now()}-${sanitizeDocFilename(file.filename)}.pdf`;
  try {
    const { error } = await c.storage
      .from(ESIGN_BUCKET)
      .upload(path, file.data, { contentType: "application/pdf", upsert: false });
    if (error) {
      console.error("[uploadEsignDocument]", error);
      return null;
    }
    return { path };
  } catch (e) {
    console.error("[uploadEsignDocument]", e);
    return null;
  }
}

/** Download a previously uploaded PDF as base64 — only within the caller's own
 *  folder (path must start with `${employerId}/`). */
export async function downloadEsignDocumentBase64(employerId: string, path: string): Promise<string | null> {
  const c = db();
  if (!c || !employerId || !path || !path.startsWith(`${employerId}/`)) return null;
  try {
    const { data, error } = await c.storage.from(ESIGN_BUCKET).download(path);
    if (error || !data) {
      console.error("[downloadEsignDocumentBase64]", error);
      return null;
    }
    const buf = Buffer.from(await data.arrayBuffer());
    return buf.length ? buf.toString("base64") : null;
  } catch (e) {
    console.error("[downloadEsignDocumentBase64]", e);
    return null;
  }
}

// ── Editable document templates (esign_templates) ─────────────────────────────
function mapTemplate(r: Record<string, unknown>): EsignTemplate {
  const docType = (r.doc_type as EditableDocType) || "offer";
  const def = DEFAULT_TEMPLATES[docType];
  return {
    docType,
    name: (r.name as string) || def?.name || docType,
    subject: (r.subject as string) ?? def?.subject ?? "",
    bodyHtml: (r.body_html as string) ?? def?.body ?? "",
    updatedAt: (r.updated_at as string) || "",
  };
}

/** A default (unsaved) template row for a type, from the built-in defaults. */
function defaultTemplate(docType: EditableDocType): EsignTemplate {
  const def = DEFAULT_TEMPLATES[docType];
  return { docType, name: def.name, subject: def.subject, bodyHtml: def.body, updatedAt: "" };
}

/**
 * List an employer's editable templates for every editable doc type, seeding
 * any missing row with the built-in default (so "first use" persists a copy the
 * employer can then edit or reset). Falls back to in-memory defaults if the DB
 * is unavailable.
 */
export async function listTemplates(employerId: string): Promise<EsignTemplate[]> {
  const c = db();
  if (!c || !employerId) return EDITABLE_DOC_TYPES.map(defaultTemplate);
  try {
    const { data } = await c
      .from("esign_templates")
      .select("doc_type, name, subject, body_html, updated_at")
      .eq("employer_id", employerId);
    const byType = new Map<string, Record<string, unknown>>();
    for (const r of data || []) byType.set(r.doc_type as string, r);

    const missing = EDITABLE_DOC_TYPES.filter((t) => !byType.has(t));
    if (missing.length) {
      const rows = missing.map((t) => ({
        employer_id: employerId,
        doc_type: t,
        name: DEFAULT_TEMPLATES[t].name,
        subject: DEFAULT_TEMPLATES[t].subject,
        body_html: DEFAULT_TEMPLATES[t].body,
        updated_at: new Date().toISOString(),
      }));
      const { data: seeded } = await c
        .from("esign_templates")
        .upsert(rows, { onConflict: "employer_id,doc_type" })
        .select("doc_type, name, subject, body_html, updated_at");
      for (const r of seeded || []) byType.set(r.doc_type as string, r);
    }
    return EDITABLE_DOC_TYPES.map((t) => (byType.has(t) ? mapTemplate(byType.get(t)!) : defaultTemplate(t)));
  } catch (e) {
    console.error("[listTemplates]", e);
    return EDITABLE_DOC_TYPES.map(defaultTemplate);
  }
}

/** The template used to render a send. Saved row if present, else the built-in
 *  default (no write). */
export async function getTemplateForSend(employerId: string, docType: EditableDocType): Promise<EsignTemplate> {
  const c = db();
  if (!c || !employerId) return defaultTemplate(docType);
  try {
    const { data } = await c
      .from("esign_templates")
      .select("doc_type, name, subject, body_html, updated_at")
      .eq("employer_id", employerId)
      .eq("doc_type", docType)
      .maybeSingle();
    return data ? mapTemplate(data) : defaultTemplate(docType);
  } catch (e) {
    console.error("[getTemplateForSend]", e);
    return defaultTemplate(docType);
  }
}

/** Save (upsert) an employer's template for one type. */
export async function saveTemplate(
  employerId: string,
  docType: EditableDocType,
  v: { name?: string; subject: string; bodyHtml: string }
): Promise<EsignTemplate | null> {
  const c = db();
  if (!c || !employerId) return null;
  try {
    const { data, error } = await c
      .from("esign_templates")
      .upsert(
        {
          employer_id: employerId,
          doc_type: docType,
          name: v.name || DEFAULT_TEMPLATES[docType].name,
          subject: v.subject,
          body_html: v.bodyHtml,
          updated_at: new Date().toISOString(),
        },
        { onConflict: "employer_id,doc_type" }
      )
      .select("doc_type, name, subject, body_html, updated_at")
      .single();
    if (error || !data) {
      console.error("[saveTemplate]", error);
      return null;
    }
    return mapTemplate(data);
  } catch (e) {
    console.error("[saveTemplate]", e);
    return null;
  }
}

/** Reset a type back to its built-in default (writes the default values). */
export async function resetTemplate(employerId: string, docType: EditableDocType): Promise<EsignTemplate | null> {
  const def = DEFAULT_TEMPLATES[docType];
  return saveTemplate(employerId, docType, { name: def.name, subject: def.subject, bodyHtml: def.body });
}
