import { NextResponse } from "next/server";
import crypto from "crypto";
import { employerContext } from "@/lib/employer-auth";
import { isEmployer } from "@/lib/plan";
import { listEmployees } from "@/lib/employees-store";
import {
  listTrainingDocs,
  createTrainingDoc,
  ensureAcknowledgments,
  setAckEnvelope,
  listAllAcknowledgments,
  assignees,
} from "@/lib/training-store";
import { getDocument, sanitizeDocumentHtml } from "@/lib/documents-store";
import { getEmployerProfile } from "@/lib/employer-store";
import { isDocKind, complianceState, type Employee, type Acknowledgment } from "@/lib/employee-hub";
import {
  isDocusignConfigured,
  buildEnvelope,
  wrapDocumentHtml,
  renderSignatureBlock,
  createEnvelope,
  normalizeEnvelopeStatus,
} from "@/lib/docusign";
import { getValidAccessToken, monthlySendCount, createEnvelopeRecord } from "@/lib/docusign-store";
import { checkSendAllowance } from "@/lib/employer-plan";
import type { DocusignStatus } from "@/lib/employer-ai";

export const runtime = "nodejs";
const EMAIL_RE = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;

/** GET training docs with a per-doc compliance rollup (counts by state). */
export async function GET() {
  const ctx = await employerContext();
  if (!ctx) return NextResponse.json({ error: "forbidden" }, { status: 403 });
  const [docs, acks, employees] = await Promise.all([
    listTrainingDocs(ctx.employerId),
    listAllAcknowledgments(ctx.employerId),
    listEmployees(ctx.employerId),
  ]);
  const byDoc = new Map<number, Acknowledgment[]>();
  for (const a of acks) {
    const arr = byDoc.get(a.trainingDocId) || [];
    arr.push(a);
    byDoc.set(a.trainingDocId, arr);
  }
  const rollup = docs.map((doc) => {
    const list = byDoc.get(doc.id) || [];
    const counts = { signed: 0, waived: 0, pending: 0, overdue: 0 };
    for (const a of list) counts[complianceState(a)]++;
    return { doc, assigned: assignees(doc, employees).length, counts };
  });
  return NextResponse.json({ training: rollup });
}

/**
 * POST create a training doc, assign it (creating pending acknowledgments for
 * the assignees), and — when require_signature — send each assignee the signing
 * request via the existing DocuSign path (doc_type 'custom'). The doc is created
 * and assigned even when DocuSign isn't connected; `sendWarning` says so.
 */
export async function POST(req: Request) {
  const ctx = await employerContext();
  if (!ctx) return NextResponse.json({ error: "forbidden" }, { status: 403 });
  if (!isEmployer(ctx.access)) return NextResponse.json({ error: "Only the account owner can create training." }, { status: 403 });

  const b = (await req.json().catch(() => ({}))) as {
    title?: string;
    docKind?: string;
    bodyHtml?: string;
    sourceDocumentId?: number;
    pdfUrl?: string;
    assignTo?: string;
    requireSignature?: boolean;
    dueAt?: string;
  };
  const title = (b.title || "").trim();
  if (!title) return NextResponse.json({ error: "A title is required." }, { status: 400 });

  // Resolve the body: an authored document ("Use in training") wins; otherwise
  // inline HTML; otherwise a PDF upload URL. Store a self-contained snapshot so
  // later edits to the source document don't silently change assigned training.
  let bodyHtml = (b.bodyHtml || "").trim();
  let sourceDocumentId: number | null = null;
  if (b.sourceDocumentId && Number.isFinite(b.sourceDocumentId)) {
    const src = await getDocument(ctx.employerId, Number(b.sourceDocumentId));
    if (!src) return NextResponse.json({ error: "Source document not found." }, { status: 404 });
    bodyHtml = src.bodyHtml;
    sourceDocumentId = src.id;
  }
  const pdfUrl = (b.pdfUrl || "").trim();
  if (!bodyHtml && !pdfUrl) return NextResponse.json({ error: "Add content: author a document or attach a PDF." }, { status: 400 });

  const requireSignature = b.requireSignature !== false;
  const dueAt = (b.dueAt || "").trim() ? new Date(b.dueAt as string).toISOString() : null;

  const doc = await createTrainingDoc(ctx.employerId, {
    title,
    docKind: isDocKind(b.docKind) ? b.docKind : "policy",
    bodyHtml: sanitizeDocumentHtml(bodyHtml),
    sourceDocumentId,
    pdfUrl: pdfUrl || null,
    assignTo: (b.assignTo || "all").trim() || "all",
    requireSignature,
  });
  if (!doc) return NextResponse.json({ error: "Could not create the training item. Is the database configured?" }, { status: 500 });

  const employees = await listEmployees(ctx.employerId);
  const acks = await ensureAcknowledgments(ctx.employerId, doc, employees, dueAt);

  // Fire the e-sign requests when a signature is required and DocuSign is ready.
  let sent = 0;
  let sendWarning: string | null = null;
  if (requireSignature && doc.bodyHtml) {
    const result = await sendSigningRequests(ctx.employerId, ctx.userId, doc.bodyHtml, doc.title, employees, acks, ctx.access);
    sent = result.sent;
    sendWarning = result.warning;
  } else if (requireSignature && !doc.bodyHtml) {
    sendWarning = "A PDF-only item can't be sent for e-signature automatically — mark it acknowledged manually or attach it to a signing request.";
  }

  return NextResponse.json({ doc, assigned: acks.length, sent, sendWarning });
}

/** Build + send a per-assignee DocuSign envelope for a training doc, linking
 *  each envelope to its acknowledgment. Best-effort; returns a warning string
 *  when nothing could be sent (not configured / not connected / no cap left). */
async function sendSigningRequests(
  employerId: string,
  userId: string,
  bodyHtml: string,
  docTitle: string,
  employees: Employee[],
  acks: Acknowledgment[],
  access: Parameters<typeof checkSendAllowance>[0]
): Promise<{ sent: number; warning: string | null }> {
  if (!isDocusignConfigured()) return { sent: 0, warning: "DocuSign isn't configured on this deployment — mark items acknowledged manually." };
  const token = await getValidAccessToken(employerId);
  if (!token) return { sent: 0, warning: "Connect your DocuSign account to send signing requests. The item is assigned and pending." };

  const empById = new Map(employees.map((e) => [e.id, e] as const));
  const profile = await getEmployerProfile(employerId);
  const companyName = profile?.companyName || "";

  let used = await monthlySendCount(employerId);
  let sent = 0;
  let capHit = false;

  for (const ack of acks) {
    if (ack.status !== "pending" || ack.envelopeId) continue; // already handled
    const employee = empById.get(ack.employeeId);
    if (!employee || !EMAIL_RE.test(employee.email)) continue;

    const allowance = checkSendAllowance(access, used);
    if (!allowance.allowed) {
      capHit = true;
      break;
    }

    const documentHtml = wrapDocumentHtml(`${bodyHtml}${renderSignatureBlock(employee.name || "Recipient")}`);
    const subject = `${docTitle} to acknowledge${companyName ? ` from ${companyName}` : ""}`;
    const definition = buildEnvelope({
      documentHtml,
      documentName: docTitle,
      subject,
      message: "Please review and sign to acknowledge this document.",
      signerName: employee.name || "Recipient",
      signerEmail: employee.email,
    });
    const result = await createEnvelope(
      { baseUri: token.baseUri, accountId: token.accountId, accessToken: token.accessToken },
      definition
    );
    if ("error" in result) continue;

    const status = (normalizeEnvelopeStatus(result.status) || "sent") as DocusignStatus;
    await createEnvelopeRecord(employerId, {
      docType: "custom",
      documentName: docTitle,
      applicantId: null,
      shortlistMemberId: null,
      envelopeId: result.envelopeId,
      subject,
      message: "",
      status,
      offer: { position: "", salary: "", startDate: "", extraTerms: "" },
      candidateName: employee.name || "Recipient",
      candidateEmail: employee.email,
      sentBy: userId,
      signToken: crypto.randomUUID(),
      requestedDocs: [],
    });
    await setAckEnvelope(employerId, ack.id, result.envelopeId);
    used++;
    sent++;
  }

  if (sent === 0 && capHit) return { sent, warning: "Your monthly e-signature send limit is reached — items are assigned and pending." };
  if (capHit) return { sent, warning: "Some signing requests weren't sent — monthly e-signature limit reached." };
  return { sent, warning: null };
}
