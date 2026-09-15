import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import type { DocusignEnvelope, DocusignConnection, DocusignStatus, OfferTerms } from "./employer-ai";
import { isDocusignStatus, isDocusignTerminal } from "./employer-ai";
import {
  encryptToken,
  decryptToken,
  refreshAccessToken,
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
  "id, applicant_id, shortlist_member_id, envelope_id, subject, message, status, offer, candidate_name, candidate_email, sent_by, sent_at, completed_at, created_at";

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
    if (error || !data) return null;
    return mapEnvelope(data);
  } catch {
    return null;
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
    return true;
  } catch {
    return false;
  }
}
