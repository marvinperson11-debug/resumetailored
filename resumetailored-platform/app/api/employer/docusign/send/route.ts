import { NextResponse } from "next/server";
import crypto from "crypto";
import { employerContext } from "@/lib/employer-auth";
import { getApplicant, getEmployerProfile } from "@/lib/employer-store";
import {
  getValidAccessToken,
  monthlySendCount,
  createEnvelopeRecord,
  advanceApplicantOnSend,
  downloadEsignDocumentBase64,
  getTemplateForSend,
  getEnvelopeByEnvelopeId,
} from "@/lib/docusign-store";
import { notifySignerOfDocRequest } from "@/lib/esign-delivery";
import { getDocument, sanitizeDocumentHtml } from "@/lib/documents-store";
import {
  isDocusignConfigured,
  buildEnvelope,
  applyTemplate,
  renderTemplateSubject,
  offerToMergeValues,
  renderWriteupHtml,
  renderSignatureBlock,
  wrapDocumentHtml,
  createEnvelope,
  normalizeEnvelopeStatus,
} from "@/lib/docusign";
import { checkSendAllowance } from "@/lib/employer-plan";
import {
  isDocType,
  isEditableDocType,
  DOC_TYPE_LABELS,
  type DocusignStatus,
  type DocType,
  type OfferTerms,
  type WriteupFields,
} from "@/lib/employer-ai";

export const runtime = "nodejs";

const EMAIL_RE = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;

/**
 * Send a document for e-signature. Document types:
 *  - offer / agreement / nda → rendered from the employer's editable template
 *  - writeup → employee write-up form; signer entered manually (not an applicant)
 *  - custom → an employer-uploaded PDF (by storage path)
 * Enforces the tier's monthly send cap first.
 */
export async function POST(req: Request) {
  const ctx = await employerContext();
  if (!ctx) return NextResponse.json({ error: "forbidden" }, { status: 403 });
  if (!isDocusignConfigured()) {
    return NextResponse.json({ error: "DocuSign is not configured on this deployment." }, { status: 503 });
  }

  const b = (await req.json().catch(() => ({}))) as {
    docType?: string;
    documentName?: string;
    documentPath?: string;
    documentId?: number;
    applicantId?: number;
    shortlistMemberId?: number;
    candidateName?: string;
    candidateEmail?: string;
    position?: string;
    salary?: string;
    startDate?: string;
    extraTerms?: string;
    subject?: string;
    message?: string;
    writeup?: Partial<WriteupFields>;
    requestedDocs?: string[];
  };

  // Documents to request from the signer (named upload slots). Deduped + capped.
  const requestedDocs = Array.from(
    new Set(
      (Array.isArray(b.requestedDocs) ? b.requestedDocs : [])
        .map((n) => String(n || "").trim())
        .filter(Boolean)
    )
  ).slice(0, 20);

  const docType: DocType = isDocType(b.docType) ? b.docType : "offer";

  // Resolve the signer. writeup is never tied to an applicant; other types use
  // the applicant record when an applicantId is given, else the manual fields.
  let signerName = (b.candidateName || "").trim();
  let signerEmail = (b.candidateEmail || "").trim();
  let applicantId: number | null = null;
  if (docType !== "writeup" && b.applicantId && Number.isFinite(b.applicantId)) {
    const applicant = await getApplicant(ctx.employerId, b.applicantId);
    if (!applicant) return NextResponse.json({ error: "Candidate not found." }, { status: 404 });
    applicantId = applicant.id;
    signerName = signerName || applicant.name;
    signerEmail = signerEmail || applicant.email;
  }

  const offer: OfferTerms = {
    position: (b.position || "").trim(),
    salary: (b.salary || "").trim(),
    startDate: (b.startDate || "").trim(),
    extraTerms: (b.extraTerms || "").trim(),
  };
  const message = (b.message || "").trim();

  const profile = await getEmployerProfile(ctx.employerId);
  const companyName = profile?.companyName || "";

  // Build the document (documentHtml or customPdfBase64) + subject + name.
  let documentHtml: string | undefined;
  let customPdfBase64: string | undefined;
  let documentName = DOC_TYPE_LABELS[docType];
  let subject = "";

  if (docType === "custom" && b.documentId) {
    // A composed document from the Document Creator: render its HTML to a
    // signable document via the existing HTML→PDF envelope path (append the
    // signature block so DocuSign has a /sig1/ anchor). No PDF upload needed.
    const doc = await getDocument(ctx.employerId, Number(b.documentId));
    if (!doc) return NextResponse.json({ error: "Document not found." }, { status: 404 });
    documentName = (b.documentName || "").trim() || doc.title || "Document";
    documentHtml = wrapDocumentHtml(`${sanitizeDocumentHtml(doc.bodyHtml)}${renderSignatureBlock(signerName || "Recipient")}`);
    subject = (b.subject || "").trim() || `${documentName} to sign${companyName ? ` from ${companyName}` : ""}`;
  } else if (docType === "custom") {
    const name = (b.documentName || "").trim();
    if (!b.documentPath) return NextResponse.json({ error: "Upload a PDF to send." }, { status: 400 });
    if (!name) return NextResponse.json({ error: "Give the document a name." }, { status: 400 });
    customPdfBase64 = (await downloadEsignDocumentBase64(ctx.employerId, b.documentPath)) || undefined;
    if (!customPdfBase64) return NextResponse.json({ error: "Couldn't read the uploaded document. Please re-upload." }, { status: 400 });
    documentName = name;
    subject = (b.subject || "").trim() || `${name} to sign${companyName ? ` from ${companyName}` : ""}`;
  } else if (docType === "writeup") {
    const w: WriteupFields = {
      employeeName: (b.writeup?.employeeName || "").trim(),
      employeeEmail: (b.writeup?.employeeEmail || "").trim(),
      dateOfIncident: (b.writeup?.dateOfIncident || "").trim(),
      policyViolated: (b.writeup?.policyViolated || "").trim(),
      description: (b.writeup?.description || "").trim(),
      correctiveAction: (b.writeup?.correctiveAction || "").trim(),
      additionalNotes: (b.writeup?.additionalNotes || "").trim(),
    };
    // Signer is the employee, entered manually.
    signerName = w.employeeName || signerName;
    signerEmail = w.employeeEmail || signerEmail;
    if (!w.employeeName) return NextResponse.json({ error: "Enter the employee's name." }, { status: 400 });
    if (!w.description) return NextResponse.json({ error: "Describe the incident." }, { status: 400 });
    documentHtml = renderWriteupHtml({ fields: w, companyName, message });
    documentName = "Employee write-up";
    subject = (b.subject || "").trim() || `Employee write-up${companyName ? ` — ${companyName}` : ""}`;
  } else {
    // offer / agreement / nda — render from the employer's editable template.
    if ((docType === "offer" || docType === "agreement") && !offer.position) {
      return NextResponse.json({ error: "A position title is required." }, { status: 400 });
    }
    const editable = isEditableDocType(docType) ? docType : "offer";
    const tpl = await getTemplateForSend(ctx.employerId, editable);
    const values = offerToMergeValues({ offer, candidateName: signerName || "Candidate", companyName, message });
    documentHtml = applyTemplate(tpl.bodyHtml, values);
    documentName = DOC_TYPE_LABELS[docType];
    subject = (b.subject || "").trim() || renderTemplateSubject(tpl.subject, values) || `${documentName}${companyName ? ` from ${companyName}` : ""}`;
  }

  signerName = signerName || "Recipient";
  if (!EMAIL_RE.test(signerEmail)) {
    return NextResponse.json(
      { error: "This recipient has no valid email. Add their email address before sending." },
      { status: 400 }
    );
  }

  // Enforce the monthly send cap BEFORE creating the envelope.
  const used = await monthlySendCount(ctx.employerId);
  const allowance = checkSendAllowance(ctx.access, used);
  if (!allowance.allowed) {
    return NextResponse.json({ error: allowance.message, code: "limit_reached" }, { status: 402 });
  }

  const access = await getValidAccessToken(ctx.employerId);
  if (!access) {
    return NextResponse.json(
      { error: "DocuSign isn't connected. Connect your DocuSign account first.", code: "not_connected" },
      { status: 409 }
    );
  }

  const definition = buildEnvelope({
    documentHtml,
    customPdfBase64,
    documentName,
    subject,
    message,
    signerName,
    signerEmail,
  });

  const result = await createEnvelope(
    { baseUri: access.baseUri, accountId: access.accountId, accessToken: access.accessToken },
    definition
  );
  if ("error" in result) {
    return NextResponse.json({ error: `Couldn't send via DocuSign: ${result.error}` }, { status: 502 });
  }

  const status = (normalizeEnvelopeStatus(result.status) || "sent") as DocusignStatus;
  const signToken = crypto.randomUUID();
  const envelope = await createEnvelopeRecord(ctx.employerId, {
    docType,
    documentName: docType === "custom" || docType === "writeup" ? documentName : "",
    applicantId,
    shortlistMemberId: b.shortlistMemberId && Number.isFinite(b.shortlistMemberId) ? b.shortlistMemberId : null,
    envelopeId: result.envelopeId,
    subject,
    message,
    status,
    offer: docType === "offer" || docType === "agreement" ? offer : { position: "", salary: "", startDate: "", extraTerms: "" },
    candidateName: signerName,
    candidateEmail: signerEmail,
    sentBy: ctx.userId,
    signToken,
    requestedDocs: requestedDocs.map((name) => ({ name, uploaded: false })),
  });

  // Status sync: only an offer advances the applicant (writeup/custom/nda do not).
  await advanceApplicantOnSend(applicantId, docType);

  // If the employer requested documents, email the signer the upload link now
  // (the DocuSign signing email can't carry it — the envelope id isn't known
  // until after the send). Fire-and-forget so the response stays snappy.
  if (requestedDocs.length) {
    void getEnvelopeByEnvelopeId(result.envelopeId).then((lookup) => {
      if (lookup) return notifySignerOfDocRequest(lookup, requestedDocs);
    });
  }

  return NextResponse.json({ envelope, envelopeId: result.envelopeId, status });
}
