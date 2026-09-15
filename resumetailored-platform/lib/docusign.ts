/**
 * DocuSign eSignature client (Employer Portal Phase 1B, feature #10).
 *
 * Server-only. Uses the DocuSign OAuth **Authorization Code Grant** and the raw
 * REST API v2.1 over `fetch` — no SDK, no new npm dependency. Nothing here ever
 * runs in the browser: tokens are exchanged, cached, and used entirely on the
 * server, and this module has no client-safe export.
 *
 * Flow:
 *   1. `buildConsentUrl(state)` → redirect the employer to DocuSign consent.
 *   2. `exchangeCode(code)` on the callback → access + refresh tokens.
 *   3. `getUserInfo(token)` → the connected account id, base_uri, name, email.
 *   4. `refreshAccessToken(refreshToken)` → mint a new access token when it
 *      expires (refresh-token rotation: DocuSign returns a fresh refresh token).
 *   5. `createEnvelope` / `getEnvelope` / `getCertificate` for the send + status
 *      + certificate-of-completion download.
 *
 * The persistence + "give me a valid access token" orchestration lives in
 * lib/docusign-store.ts; this file is the protocol layer.
 *
 * Env (already set in Railway):
 *   DOCUSIGN_INTEGRATION_KEY, DOCUSIGN_SECRET_KEY, DOCUSIGN_ACCOUNT_ID,
 *   DOCUSIGN_USER_ID, DOCUSIGN_BASE_URL (default demo), DOCUSIGN_AUTH_SERVER
 *   (default account-d), DOCUSIGN_WEBHOOK_SECRET (Connect HMAC key),
 *   DOCUSIGN_REDIRECT_URI (optional override), DOCUSIGN_TOKEN_ENC_KEY (optional
 *   — a dedicated key for refresh-token encryption; falls back to
 *   DOCUSIGN_SECRET_KEY so encryption works out of the box).
 */
import crypto from "crypto";
import { appUrl } from "./subdomain";
import type { OfferTerms, EditableDocType, WriteupFields } from "./employer-ai";
import { escapeHtml } from "./email";

const DEFAULT_AUTH_SERVER = "https://account-d.docusign.com";
const DEFAULT_BASE_URL = "https://demo.docusign.net/restapi";

export interface DocusignConfig {
  integrationKey: string;
  secretKey: string;
  authServer: string; // e.g. https://account-d.docusign.com (no trailing slash)
  baseUrl: string; // e.g. https://demo.docusign.net/restapi
  accountId: string; // default account id from env (userinfo may override)
  redirectUri: string;
}

export function docusignConfig(): DocusignConfig {
  return {
    integrationKey: process.env.DOCUSIGN_INTEGRATION_KEY || "",
    secretKey: process.env.DOCUSIGN_SECRET_KEY || "",
    authServer: (process.env.DOCUSIGN_AUTH_SERVER || DEFAULT_AUTH_SERVER).replace(/\/+$/, ""),
    baseUrl: (process.env.DOCUSIGN_BASE_URL || DEFAULT_BASE_URL).replace(/\/+$/, ""),
    accountId: process.env.DOCUSIGN_ACCOUNT_ID || "",
    redirectUri: process.env.DOCUSIGN_REDIRECT_URI || appUrl("/api/employer/docusign/callback"),
  };
}

/** True when the integration key + secret are present (the minimum to connect). */
export function isDocusignConfigured(): boolean {
  const c = docusignConfig();
  return !!(c.integrationKey && c.secretKey);
}

// ── Refresh-token encryption at rest (AES-256-GCM) ────────────────────────────
// The long-lived refresh token is encrypted before it touches the database. The
// key is derived (scrypt) from DOCUSIGN_TOKEN_ENC_KEY, or DOCUSIGN_SECRET_KEY as
// a fallback so encryption works with the credentials already in Railway. If
// neither is set, we store plaintext (the table is service-role-only with RLS, a
// documented acceptable alternative) and say so via `enc:` prefix absence.
const ENC_PREFIX = "enc:v1:";

function encKey(): Buffer | null {
  const material = process.env.DOCUSIGN_TOKEN_ENC_KEY || process.env.DOCUSIGN_SECRET_KEY;
  if (!material) return null;
  // Deterministic 32-byte key from the secret material + a fixed salt.
  return crypto.scryptSync(material, "docusign-refresh-token-v1", 32);
}

export function encryptToken(plain: string): string {
  if (!plain) return plain;
  const key = encKey();
  if (!key) return plain; // no key material → plaintext fallback (RLS-protected table)
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv("aes-256-gcm", key, iv);
  const ct = Buffer.concat([cipher.update(plain, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return ENC_PREFIX + [iv.toString("hex"), tag.toString("hex"), ct.toString("hex")].join(":");
}

export function decryptToken(stored: string | null | undefined): string {
  if (!stored) return "";
  if (!stored.startsWith(ENC_PREFIX)) return stored; // plaintext (pre-encryption or no key)
  const key = encKey();
  if (!key) return ""; // encrypted value but no key to read it — fail closed
  try {
    const [ivHex, tagHex, ctHex] = stored.slice(ENC_PREFIX.length).split(":");
    const decipher = crypto.createDecipheriv("aes-256-gcm", key, Buffer.from(ivHex, "hex"));
    decipher.setAuthTag(Buffer.from(tagHex, "hex"));
    return Buffer.concat([decipher.update(Buffer.from(ctHex, "hex")), decipher.final()]).toString("utf8");
  } catch {
    return "";
  }
}

// ── OAuth: consent, code exchange, refresh ────────────────────────────────────
/** Build the consent URL to redirect the employer to. `signature extended` is
 *  required to receive a refresh token. */
export function buildConsentUrl(state: string): string {
  const c = docusignConfig();
  const params = new URLSearchParams({
    response_type: "code",
    scope: "signature extended",
    client_id: c.integrationKey,
    redirect_uri: c.redirectUri,
    state,
  });
  return `${c.authServer}/oauth/auth?${params.toString()}`;
}

export interface TokenResponse {
  accessToken: string;
  refreshToken: string;
  /** Seconds until the access token expires. */
  expiresIn: number;
}

function basicAuthHeader(): string {
  const c = docusignConfig();
  return "Basic " + Buffer.from(`${c.integrationKey}:${c.secretKey}`).toString("base64");
}

async function tokenRequest(body: URLSearchParams): Promise<TokenResponse | null> {
  const c = docusignConfig();
  try {
    const res = await fetch(`${c.authServer}/oauth/token`, {
      method: "POST",
      headers: {
        Authorization: basicAuthHeader(),
        "Content-Type": "application/x-www-form-urlencoded",
      },
      body: body.toString(),
      signal: AbortSignal.timeout(15000),
    });
    if (!res.ok) return null;
    const d = (await res.json()) as { access_token?: string; refresh_token?: string; expires_in?: number };
    if (!d.access_token) return null;
    return {
      accessToken: d.access_token,
      refreshToken: d.refresh_token || "",
      expiresIn: typeof d.expires_in === "number" ? d.expires_in : 3600,
    };
  } catch {
    return null;
  }
}

/** Exchange an authorization code for tokens (callback step). */
export function exchangeCode(code: string): Promise<TokenResponse | null> {
  return tokenRequest(new URLSearchParams({ grant_type: "authorization_code", code }));
}

/** Mint a new access token from a refresh token (rotation: a fresh refresh token
 *  is returned and must be persisted). */
export function refreshAccessToken(refreshToken: string): Promise<TokenResponse | null> {
  return tokenRequest(new URLSearchParams({ grant_type: "refresh_token", refresh_token: refreshToken }));
}

export interface DocusignAccountInfo {
  accountId: string;
  accountName: string;
  baseUri: string; // e.g. https://demo.docusign.net (no /restapi)
  email: string;
  name: string;
}

/** Resolve the connected account (id + base_uri) and the user's name/email. */
export async function getUserInfo(accessToken: string): Promise<DocusignAccountInfo | null> {
  const c = docusignConfig();
  try {
    const res = await fetch(`${c.authServer}/oauth/userinfo`, {
      headers: { Authorization: `Bearer ${accessToken}` },
      signal: AbortSignal.timeout(15000),
    });
    if (!res.ok) return null;
    const d = (await res.json()) as {
      name?: string;
      email?: string;
      accounts?: { account_id: string; account_name: string; base_uri: string; is_default?: boolean }[];
    };
    const accounts = d.accounts || [];
    // Prefer the account id from env when it matches; else the default account.
    const chosen =
      accounts.find((a) => a.account_id === c.accountId) || accounts.find((a) => a.is_default) || accounts[0];
    if (!chosen) return null;
    return {
      accountId: chosen.account_id,
      accountName: chosen.account_name || "",
      baseUri: (chosen.base_uri || "").replace(/\/+$/, ""),
      email: d.email || "",
      name: d.name || "",
    };
  } catch {
    return null;
  }
}

// ── Envelopes ─────────────────────────────────────────────────────────────────
/** The REST base for a connected account: `${base_uri}/restapi/v2.1/accounts/{id}`. */
function accountApi(baseUri: string, accountId: string): string {
  const root = (baseUri || "").replace(/\/+$/, "");
  // base_uri from userinfo has no /restapi; env DOCUSIGN_BASE_URL includes it.
  const withRestapi = root.endsWith("/restapi") ? root : `${root}/restapi`;
  return `${withRestapi}/v2.1/accounts/${accountId}`;
}

export interface EnvelopeArgs {
  baseUri: string;
  accountId: string;
  accessToken: string;
}

export interface CreateEnvelopeResult {
  envelopeId: string;
  status: string;
}

// ── Document templates + rendering (E-Signatures) ─────────────────────────────
// Generated document types (offer/agreement/nda) render from an employer-editable
// template: HTML text with merge-field tokens. {{signature_block}} marks where the
// SignHere + DateSigned anchors go. Values are HTML-escaped on substitution; the
// template body itself is authored by the employer (their own account, their own
// signer) and passed through. Custom PDFs bypass templates entirely.

/** The merge tokens available in the template editor. */
export const MERGE_FIELDS: { token: string; label: string }[] = [
  { token: "{{candidate_name}}", label: "Candidate name" },
  { token: "{{position}}", label: "Position" },
  { token: "{{salary}}", label: "Salary" },
  { token: "{{start_date}}", label: "Start date" },
  { token: "{{company_name}}", label: "Company name" },
  { token: "{{message}}", label: "Personal message" },
  { token: "{{signature_block}}", label: "Signature block (required)" },
];

export const SIGNATURE_BLOCK_TOKEN = "{{signature_block}}";

/** Values that fill the merge tokens for a generated document. */
export interface MergeValues {
  candidate_name: string;
  position: string;
  salary: string;
  start_date: string;
  company_name: string;
  message: string;
}

export function offerToMergeValues(args: {
  offer: OfferTerms;
  candidateName: string;
  companyName: string;
  message: string;
}): MergeValues {
  return {
    candidate_name: args.candidateName || "",
    position: args.offer.position || "",
    salary: args.offer.salary || "",
    start_date: args.offer.startDate || "",
    company_name: args.companyName || "",
    message: args.message || "",
    // extraTerms isn't a first-class token; append it to the message so nothing
    // the employer typed is silently dropped when a template omits it.
    ...(args.offer.extraTerms?.trim()
      ? { message: [args.message, args.offer.extraTerms].filter(Boolean).join("\n\n") }
      : {}),
  };
}

const MERGE_KEYS: (keyof MergeValues)[] = [
  "candidate_name",
  "position",
  "salary",
  "start_date",
  "company_name",
  "message",
];

/** The signature area (invisible `/sig1/` + `/date1/` anchors DocuSign locates). */
export function renderSignatureBlock(signerName: string): string {
  const name = escapeHtml(signerName || "Signer");
  return `<div class="section" style="margin-top:40px">
    <div style="font-weight:600;margin-bottom:24px">Accepted and agreed:</div>
    <span class="anchor">/sig1/</span>
    <div class="sigline">Signature (${name})</div>
    <div style="margin-top:24px"><span class="anchor">/date1/</span><div class="sigline">Date</div></div>
  </div>`;
}

/** Substitute merge tokens into subject text (raw values — subject is plain text). */
export function renderTemplateSubject(subject: string, values: MergeValues): string {
  let out = subject || "";
  for (const k of MERGE_KEYS) out = out.split(`{{${k}}}`).join(values[k] || "");
  return out.trim();
}

/** Substitute merge tokens into the body (values HTML-escaped), expand the
 *  signature block, and return the inner HTML (unwrapped). */
export function renderTemplateBody(bodyHtml: string, values: MergeValues): string {
  let out = bodyHtml || "";
  for (const k of MERGE_KEYS) out = out.split(`{{${k}}}`).join(escapeHtml(values[k] || ""));
  out = out.split(SIGNATURE_BLOCK_TOKEN).join(renderSignatureBlock(values.candidate_name));
  return out;
}

/** Wrap inner document HTML in the print-styled page shell (fonts + anchor CSS). */
export function wrapDocumentHtml(innerHtml: string): string {
  const today = new Date().toLocaleDateString("en-US", { year: "numeric", month: "long", day: "numeric" });
  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8" />
<style>
  body { font-family: Georgia, "Times New Roman", serif; color:#111; line-height:1.6; margin:0; padding:48px 56px; font-size:14px; }
  h1 { font-size:22px; margin:0 0 4px; }
  h2 { font-size:16px; margin:20px 0 6px; }
  .muted { color:#666; font-size:12px; }
  .section { margin:18px 0; }
  table.terms { border-collapse:collapse; margin:8px 0; }
  .terms-box { border:1px solid #e5e5e5; border-radius:8px; padding:12px 18px; background:#fafafa; }
  /* Anchor markers: white on white — invisible on the page, present in the PDF
     text layer for DocuSign's anchorString matching. */
  .anchor { color:#ffffff; }
  .sigline { margin-top:8px; border-top:1px solid #333; width:280px; padding-top:4px; color:#555; font-size:12px; }
  .extra, .field-val { white-space:pre-wrap; }
  p { margin:10px 0; }
</style>
</head>
<body>
  <div class="muted" style="text-align:right">${escapeHtml(today)}</div>
  ${innerHtml}
</body>
</html>`;
}

/** Full generated-document HTML from an editable template + values. */
export function applyTemplate(bodyHtml: string, values: MergeValues): string {
  return wrapDocumentHtml(renderTemplateBody(bodyHtml, values));
}

// ── Default templates (seeded per employer on first use) ──────────────────────
export const DEFAULT_TEMPLATES: Record<EditableDocType, { name: string; subject: string; body: string }> = {
  offer: {
    name: "Offer letter",
    subject: "Your offer from {{company_name}}",
    body: `<h1>{{company_name}}</h1>
<div class="muted">Offer of Employment</div>

<p class="section">Dear {{candidate_name}},</p>

<p class="section">We are delighted to offer you the position of <strong>{{position}}</strong> at {{company_name}}. We were impressed by your background and believe you will be a valuable addition to our team. The key terms of your offer are set out below.</p>

<div class="section terms-box">
  <table class="terms">
    <tr><td style="padding:6px 16px 6px 0;color:#555;font-weight:600">Position</td><td style="padding:6px 0">{{position}}</td></tr>
    <tr><td style="padding:6px 16px 6px 0;color:#555;font-weight:600">Annual salary</td><td style="padding:6px 0">{{salary}}</td></tr>
    <tr><td style="padding:6px 16px 6px 0;color:#555;font-weight:600">Start date</td><td style="padding:6px 0">{{start_date}}</td></tr>
  </table>
</div>

<p class="section field-val">{{message}}</p>

<p class="section">This offer is contingent upon the terms above and any standard pre-employment conditions. To accept, please sign and date below. We look forward to welcoming you aboard.</p>

<p class="section">Sincerely,<br />{{company_name}}</p>

{{signature_block}}`,
  },
  agreement: {
    name: "Employment agreement",
    subject: "Employment agreement from {{company_name}}",
    body: `<h1>{{company_name}}</h1>
<div class="muted">Employment Agreement</div>

<p class="section">This Employment Agreement is entered into between {{company_name}} (the "Company") and {{candidate_name}} (the "Employee").</p>

<p><strong>1. Position.</strong> The Employee is employed as <strong>{{position}}</strong> and agrees to perform the duties reasonably associated with that role.</p>
<p><strong>2. Start date.</strong> Employment begins on {{start_date}}.</p>
<p><strong>3. Compensation.</strong> The Employee will be paid {{salary}}, subject to standard withholdings and the Company's payroll schedule.</p>
<p><strong>4. At-will employment.</strong> Unless otherwise required by law or a separate written agreement, employment is at-will and may be terminated by either party at any time.</p>

<p class="section field-val">{{message}}</p>

<p class="section">By signing below, the Employee accepts the terms of this Agreement.</p>

{{signature_block}}`,
  },
  nda: {
    name: "NDA",
    subject: "Non-disclosure agreement from {{company_name}}",
    body: `<h1>{{company_name}}</h1>
<div class="muted">Non-Disclosure Agreement</div>

<p class="section">This Non-Disclosure Agreement ("Agreement") is entered into between {{company_name}} (the "Company") and {{candidate_name}} (the "Recipient").</p>

<p><strong>1. Confidential Information.</strong> "Confidential Information" means any non-public information disclosed by the Company, whether oral, written, or electronic, including business plans, customer data, product information, and trade secrets.</p>
<p><strong>2. Obligations.</strong> The Recipient agrees to keep Confidential Information strictly confidential, to use it solely for the purpose of the parties' discussions or engagement, and not to disclose it to any third party without the Company's prior written consent.</p>
<p><strong>3. Term.</strong> These obligations survive for three (3) years from the date of disclosure.</p>
<p><strong>4. Return of materials.</strong> Upon request, the Recipient will return or destroy all materials containing Confidential Information.</p>

<p class="section field-val">{{message}}</p>

<p class="section">By signing below, the Recipient agrees to the terms of this Agreement.</p>

{{signature_block}}`,
  },
};

/** Employee write-up / disciplinary form — a built-in (non-editable) generated
 *  document. Signer is the employee (entered manually). */
export function renderWriteupHtml(args: { fields: WriteupFields; companyName: string; message?: string }): string {
  const { fields, companyName, message } = args;
  const company = escapeHtml(companyName || "the Company");
  const f = (v: string) => `<div class="field-val">${escapeHtml(v || "—")}</div>`;
  const inner = `<h1>${company}</h1>
<div class="muted">Employee Write-Up / Corrective Action Form</div>

<div class="section">
  <table class="terms">
    <tr><td style="padding:6px 16px 6px 0;color:#555;font-weight:600">Employee</td><td style="padding:6px 0">${escapeHtml(fields.employeeName || "—")}</td></tr>
    <tr><td style="padding:6px 16px 6px 0;color:#555;font-weight:600">Date of incident</td><td style="padding:6px 0">${escapeHtml(fields.dateOfIncident || "—")}</td></tr>
    <tr><td style="padding:6px 16px 6px 0;color:#555;font-weight:600">Policy violated</td><td style="padding:6px 0">${escapeHtml(fields.policyViolated || "—")}</td></tr>
  </table>
</div>

<h2>Description of incident</h2>
${f(fields.description)}

<h2>Corrective action</h2>
${f(fields.correctiveAction)}

${fields.additionalNotes?.trim() ? `<h2>Additional notes</h2>${f(fields.additionalNotes)}` : ""}
${message?.trim() ? `<div class="section field-val">${escapeHtml(message)}</div>` : ""}

<p class="section">By signing below, the employee acknowledges receipt of this write-up. A signature indicates receipt, not necessarily agreement.</p>

${renderSignatureBlock(fields.employeeName)}`;
  return wrapDocumentHtml(inner);
}

// ── Envelope assembly ─────────────────────────────────────────────────────────
/** Anchor-based signer tabs (generated HTML docs carry `/sig1/` + `/date1/`). */
function anchorSignerTabs(): Record<string, unknown> {
  return {
    signHereTabs: [{ anchorString: "/sig1/", anchorUnits: "pixels", anchorXOffset: "5", anchorYOffset: "-6" }],
    dateSignedTabs: [{ anchorString: "/date1/", anchorUnits: "pixels", anchorXOffset: "5", anchorYOffset: "-6" }],
  };
}

/** Fixed-position signer tabs for an uploaded PDF (no anchor text in it). Placed
 *  near the bottom-left of page 1 — a sensible default auto-placement. */
function fixedSignerTabs(): Record<string, unknown> {
  return {
    signHereTabs: [{ documentId: "1", pageNumber: "1", xPosition: "72", yPosition: "650" }],
    dateSignedTabs: [{ documentId: "1", pageNumber: "1", xPosition: "330", yPosition: "650" }],
  };
}

/**
 * Assemble an envelopeDefinition for one document + one signer. Pass
 * `documentHtml` for a generated document (anchor tabs) or `customPdfBase64` for
 * an uploaded PDF (fixed-position tabs). Pure e-signature — no payments.
 */
export function buildEnvelope(args: {
  documentHtml?: string;
  customPdfBase64?: string;
  documentName: string;
  subject: string;
  message: string;
  signerName: string;
  signerEmail: string;
}): Record<string, unknown> {
  const { documentHtml, customPdfBase64, documentName, subject, message, signerName, signerEmail } = args;
  const isPdf = !documentHtml && !!customPdfBase64;
  const documentEntry = isPdf
    ? { documentId: "1", name: (documentName || "Document").slice(0, 100), fileExtension: "pdf", documentBase64: customPdfBase64 }
    : { documentId: "1", name: (documentName || "Document").slice(0, 100), fileExtension: "html", documentBase64: Buffer.from(documentHtml || "", "utf8").toString("base64") };
  return {
    emailSubject: (subject || "Document to sign").slice(0, 100),
    emailBlurb: message || "",
    status: "sent",
    documents: [documentEntry],
    recipients: {
      signers: [{ email: signerEmail, name: signerName, recipientId: "1", routingOrder: "1", tabs: isPdf ? fixedSignerTabs() : anchorSignerTabs() }],
    },
  };
}

/** Create (and send) an envelope. Returns the DocuSign envelope id + status. */
export async function createEnvelope(
  args: EnvelopeArgs,
  definition: Record<string, unknown>
): Promise<CreateEnvelopeResult | { error: string }> {
  try {
    const res = await fetch(`${accountApi(args.baseUri, args.accountId)}/envelopes`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${args.accessToken}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(definition),
      signal: AbortSignal.timeout(30000),
    });
    const d = (await res.json().catch(() => ({}))) as {
      envelopeId?: string;
      status?: string;
      message?: string;
      errorCode?: string;
    };
    if (!res.ok || !d.envelopeId) {
      return { error: d.message || d.errorCode || `DocuSign returned ${res.status}` };
    }
    return { envelopeId: d.envelopeId, status: d.status || "sent" };
  } catch (e) {
    return { error: e instanceof Error ? e.message : "DocuSign request failed" };
  }
}

/** Fetch an envelope's current status (fallback poll). */
export async function getEnvelope(args: EnvelopeArgs, envelopeId: string): Promise<{ status: string } | null> {
  try {
    const res = await fetch(`${accountApi(args.baseUri, args.accountId)}/envelopes/${encodeURIComponent(envelopeId)}`, {
      headers: { Authorization: `Bearer ${args.accessToken}` },
      signal: AbortSignal.timeout(15000),
    });
    if (!res.ok) return null;
    const d = (await res.json()) as { status?: string };
    return { status: d.status || "" };
  } catch {
    return null;
  }
}

/** Download the certificate of completion (PDF bytes) for an envelope. */
export async function getCertificate(args: EnvelopeArgs, envelopeId: string): Promise<Buffer | null> {
  try {
    const res = await fetch(
      `${accountApi(args.baseUri, args.accountId)}/envelopes/${encodeURIComponent(envelopeId)}/documents/certificate`,
      {
        headers: { Authorization: `Bearer ${args.accessToken}`, Accept: "application/pdf" },
        signal: AbortSignal.timeout(30000),
      }
    );
    if (!res.ok) return null;
    const buf = Buffer.from(await res.arrayBuffer());
    return buf.length ? buf : null;
  } catch {
    return null;
  }
}

// ── Connect webhook ───────────────────────────────────────────────────────────
/**
 * Verify a DocuSign Connect webhook using the HMAC signature it sends in the
 * `X-DocuSign-Signature-1` header (base64 HMAC-SHA256 of the raw body, keyed by
 * the shared secret configured in DocuSign Connect = DOCUSIGN_WEBHOOK_SECRET).
 * Timing-safe. Returns false when the secret is unset (fail closed).
 */
export function verifyWebhookSignature(rawBody: string, signatureHeader: string | null, secret: string): boolean {
  if (!secret || !signatureHeader) return false;
  try {
    const expected = crypto.createHmac("sha256", secret).update(rawBody, "utf8").digest("base64");
    const a = Buffer.from(expected);
    const b = Buffer.from(signatureHeader);
    return a.length === b.length && crypto.timingSafeEqual(a, b);
  } catch {
    return false;
  }
}

/** Map a DocuSign envelope status string to our stored status set. */
export function normalizeEnvelopeStatus(raw: string | null | undefined): string {
  const s = (raw || "").toLowerCase();
  if (s === "created" || s === "sent") return "sent";
  if (s === "delivered") return "delivered";
  if (s === "viewed") return "viewed";
  if (s === "signed") return "signed";
  if (s === "declined") return "declined";
  if (s === "completed") return "completed";
  if (s === "voided") return "voided";
  return "";
}

/**
 * Extract { envelopeId, status } from a Connect webhook body. Handles both the
 * modern aggregate JSON shape (`{ event, data: { envelopeId, envelopeSummary:{
 * status } } }`) and the flatter `{ envelopeId, status }` shape.
 */
export function parseWebhookPayload(body: unknown): { envelopeId: string; status: string } | null {
  if (!body || typeof body !== "object") return null;
  const b = body as Record<string, unknown>;
  const data = (b.data as Record<string, unknown>) || {};
  const summary = (data.envelopeSummary as Record<string, unknown>) || {};
  const envelopeId = String(b.envelopeId || data.envelopeId || summary.envelopeId || "");
  const rawStatus = String(summary.status || data.envelopeStatus || b.status || b.event || "");
  const status = normalizeEnvelopeStatus(rawStatus);
  if (!envelopeId || !status) return null;
  return { envelopeId, status };
}
