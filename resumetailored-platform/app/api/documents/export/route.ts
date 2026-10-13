import { NextResponse } from "next/server";
import { auth } from "@clerk/nextjs/server";
import { randomUUID } from "crypto";
import { rateLimit } from "@/lib/rate-limit";
import { DOCX_MIME, renderDocument } from "@/lib/docs/docx-render";
import { textToCoverLetterDoc, textToResumeDoc } from "@/lib/docs/legacy";
import { docxToPdf } from "@/lib/docs/pdf";
import { putFile, signedUrl } from "@/lib/docs/store";
import { checkEmployer } from "@/lib/docs/validate";
import { isIndividualPro } from "@/lib/plan";
import { allTemplatesFree, PRO_TEMPLATE_MESSAGE } from "@/lib/template-gate";

export const runtime = "nodejs";
export const maxDuration = 60;

/**
 * Server-side export for the resume / cover-letter tools (replaces the browser's print-to-PDF and the
 * client-side DOCX writer). The text on screen is parsed into the structured document model, rendered
 * with the `docx` package, uploaded to Storage, and a signed download URL is returned. PDF is converted
 * FROM that .docx with LibreOffice — never printed by the browser.
 *
 * Body: { text, kind: "resume"|"cover_letter", format?: "docx"|"pdf", employer?, position?, templateId? }
 * For a cover letter, `employer` (the company the user entered) is enforced: a letter that does not name
 * it, or names another company, is refused (422) and never exported.
 */
export async function POST(req: Request) {
  const limited = rateLimit(req, "documents-export");
  if (limited) return limited;
  const { userId } = await auth();
  const b = (await req.json().catch(() => ({}))) as { text?: unknown; kind?: unknown; format?: unknown; employer?: unknown; position?: unknown; templateId?: unknown };
  const text = typeof b.text === "string" ? b.text : "";
  const kind = b.kind === "cover_letter" ? "cover_letter" : b.kind === "resume" ? "resume" : null;
  const format = b.format === "pdf" ? "pdf" : "docx";
  if (!kind || !text.trim() || text.length > 60000) return NextResponse.json({ error: "Nothing to export." }, { status: 400 });
  // Same template entitlement the client-side exports honoured (/api/export/authorize).
  if (b.templateId !== undefined && !allTemplatesFree([b.templateId]) && !(userId && (await isIndividualPro()))) {
    return NextResponse.json({ error: "pro_template", message: PRO_TEMPLATE_MESSAGE }, { status: 402 });
  }

  const employer = typeof b.employer === "string" ? b.employer.trim() : "";
  const position = typeof b.position === "string" ? b.position.trim() : "";
  // Tier decides the watermark (tier.ts): free + PDF only. A paid user's file never carries it.
  const tier = userId && (await isIndividualPro()) ? "paid" : "free";
  const target = format === "pdf" ? "pdf" : "docx";
  let docx: Buffer;
  if (kind === "resume") {
    const doc = textToResumeDoc(text);
    if (!doc.name) return NextResponse.json({ error: "Nothing to export." }, { status: 400 });
    docx = await renderDocument({ kind: "resume", doc }, { tier, target });
  } else {
    const doc = textToCoverLetterDoc(text, { employer, position });
    if (employer) {
      const check = checkEmployer(doc, { employer });
      if (!check.ok) return NextResponse.json({ error: "employer_mismatch", message: `This letter does not name "${employer}" correctly, so it was not exported. Regenerate it.`, problems: check.problems }, { status: 422 });
    }
    docx = await renderDocument({ kind: "cover_letter", doc }, { tier, target });
  }

  let bytes: Buffer = docx;
  let mime = DOCX_MIME;
  let ext = "docx";
  if (format === "pdf") {
    const pdf = await docxToPdf(docx);
    if (!pdf) return NextResponse.json({ error: "pdf_unavailable", message: "PDF export is unavailable right now. Download the .docx instead." }, { status: 501 });
    bytes = pdf; mime = "application/pdf"; ext = "pdf";
  }
  const stem = kind === "resume" ? "Resume" : "CoverLetter";
  const filename = `${stem}.${ext}`;
  const path = `${userId || "guest"}/export/${randomUUID()}/${filename}`;
  if (await putFile(path, bytes, mime)) {
    const url = await signedUrl(path, filename);
    if (url) return NextResponse.json({ url, filename });
  }
  // Storage unavailable: hand the file back directly, with the right content type.
  return new Response(new Uint8Array(bytes), { headers: { "Content-Type": mime, "Content-Disposition": `attachment; filename="${filename}"` } });
}
