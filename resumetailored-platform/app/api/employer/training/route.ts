import { NextResponse } from "next/server";
import { employerContext } from "@/lib/employer-auth";
import { isEmployer } from "@/lib/plan";
import { listEmployees } from "@/lib/employees-store";
import { listTrainingDocs, createTrainingDoc, ensureAcknowledgments, listAllAcknowledgments, assignees } from "@/lib/training-store";
import { getDocument, sanitizeDocumentHtml } from "@/lib/documents-store";
import { getLibraryItem, libraryItemBodyHtml } from "@/lib/training-library";
import { upsertQuiz, docIdsWithQuiz } from "@/lib/quiz-store";
import { sendEmail, emailShell, escapeHtml } from "@/lib/email";
import { logActivityForEmployee } from "@/lib/notifications-store";
import { isDocKind, complianceState, type Acknowledgment } from "@/lib/employee-hub";

export const runtime = "nodejs";
const EMAIL_RE = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;

/** GET training docs with a per-doc compliance rollup (counts by state) and
 *  whether each has a quiz attached. */
export async function GET() {
  const ctx = await employerContext();
  if (!ctx) return NextResponse.json({ error: "forbidden" }, { status: 403 });
  const [docs, acks, employees] = await Promise.all([
    listTrainingDocs(ctx.employerId),
    listAllAcknowledgments(ctx.employerId),
    listEmployees(ctx.employerId),
  ]);
  const quizDocIds = await docIdsWithQuiz(ctx.employerId, docs.map((d) => d.id));
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
    return { doc, assigned: assignees(doc, employees).length, counts, hasQuiz: quizDocIds.has(doc.id) };
  });
  return NextResponse.json({ training: rollup });
}

/**
 * POST create a training doc and assign it (creating pending acknowledgments
 * for the assignees). In-house only — no DocuSign: each assignee gets a plain
 * Resend "new training assigned" email pointing at their portal, where they
 * watch/read the content and complete it themselves (directly, or by passing
 * an attached quiz). The doc is created and assigned even when Resend isn't
 * configured; `emailWarning` says so. (Write-ups/agreements keep the DocuSign
 * flow — that's the separate Documents tab, untouched by this route.)
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
    libraryItemId?: number;
    pdfUrl?: string;
    assignTo?: string;
    dueAt?: string;
    quiz?: { questions?: unknown; passThreshold?: unknown };
  };
  const title = (b.title || "").trim();
  if (!title) return NextResponse.json({ error: "A title is required." }, { status: 400 });

  // Resolve the body from one of four sources, in priority order: the built-in
  // Library ("Pick from Library"); an authored document ("Use in training"); an
  // inline HTML paste; or a PDF upload URL. In every case a self-contained
  // snapshot is stored so later edits to the source don't change assigned
  // training.
  let bodyHtml = (b.bodyHtml || "").trim();
  let sourceDocumentId: number | null = null;
  let libraryItemId: number | null = null;
  if (b.libraryItemId && Number.isFinite(b.libraryItemId)) {
    const item = await getLibraryItem(Number(b.libraryItemId));
    if (!item) return NextResponse.json({ error: "Library item not found." }, { status: 404 });
    libraryItemId = item.id;
    bodyHtml = libraryItemBodyHtml(item);
  } else if (b.sourceDocumentId && Number.isFinite(b.sourceDocumentId)) {
    const src = await getDocument(ctx.employerId, Number(b.sourceDocumentId));
    if (!src) return NextResponse.json({ error: "Source document not found." }, { status: 404 });
    bodyHtml = src.bodyHtml;
    sourceDocumentId = src.id;
  }
  const pdfUrl = (b.pdfUrl || "").trim();
  if (!bodyHtml && !pdfUrl) return NextResponse.json({ error: "Add content: pick from the Library, author a document, or attach a PDF." }, { status: 400 });

  const dueAt = (b.dueAt || "").trim() ? new Date(b.dueAt as string).toISOString() : null;

  const doc = await createTrainingDoc(ctx.employerId, {
    title,
    docKind: isDocKind(b.docKind) ? b.docKind : "policy",
    bodyHtml: sanitizeDocumentHtml(bodyHtml),
    sourceDocumentId,
    pdfUrl: pdfUrl || null,
    assignTo: (b.assignTo || "all").trim() || "all",
    requireSignature: false,
    libraryItemId,
  });
  if (!doc) return NextResponse.json({ error: "Could not create the training item. Is the database configured?" }, { status: 500 });

  let hasQuiz = false;
  if (b.quiz && Array.isArray(b.quiz.questions) && b.quiz.questions.length > 0) {
    const quiz = await upsertQuiz(ctx.employerId, doc.id, b.quiz.questions, b.quiz.passThreshold);
    hasQuiz = !!quiz;
  }

  const employees = await listEmployees(ctx.employerId);
  const acks = await ensureAcknowledgments(ctx.employerId, doc, employees, dueAt);

  const { emailed, emailWarning } = await notifyAssignees(ctx.employerId, doc.id, employees, acks, doc.title, hasQuiz);

  return NextResponse.json({ doc, assigned: acks.length, emailed, emailWarning, hasQuiz });
}

/** Plain "you've been assigned training" email per pending assignee — no
 *  DocuSign, no signing request. Best-effort; a missing/unconfigured Resend
 *  key just means 0 emailed (the doc is still assigned and visible in-portal). */
async function notifyAssignees(
  employerId: string,
  docId: number,
  employees: Awaited<ReturnType<typeof listEmployees>>,
  acks: Acknowledgment[],
  docTitle: string,
  hasQuiz: boolean
): Promise<{ emailed: number; emailWarning: string | null }> {
  const empById = new Map(employees.map((e) => [e.id, e] as const));
  let emailed = 0;
  for (const ack of acks) {
    if (ack.status !== "pending") continue;
    const employee = empById.get(ack.employeeId);
    if (!employee) continue;

    logActivityForEmployee(employerId, employee.id, {
      eventType: "training_assigned",
      title: `New training assigned: ${docTitle}`,
      link: `/employee/training?open=${docId}`,
    }).catch(() => {});

    if (!EMAIL_RE.test(employee.email)) continue;
    const ok = await sendEmail({
      to: employee.email,
      subject: `New training assigned: ${docTitle}`,
      html: emailShell(
        `<p>Hi ${escapeHtml(employee.name || "there")},</p>
<p>You've been assigned a new training item: <strong>${escapeHtml(docTitle)}</strong>.</p>
<p>Open your employee portal → My training to review it${hasQuiz ? " and take the short quiz" : " and mark it complete"}.</p>`
      ),
    });
    if (ok) emailed++;
  }
  const warning = emailed === 0 && acks.some((a) => a.status === "pending") ? "Assigned, but no emails were sent — is RESEND_API_KEY configured?" : null;
  return { emailed, emailWarning: warning };
}
