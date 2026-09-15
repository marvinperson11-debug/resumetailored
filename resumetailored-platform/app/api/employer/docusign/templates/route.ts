import { NextResponse } from "next/server";
import { employerContext } from "@/lib/employer-auth";
import { listTemplates, saveTemplate, resetTemplate } from "@/lib/docusign-store";
import { isEditableDocType } from "@/lib/employer-ai";
import { SIGNATURE_BLOCK_TOKEN } from "@/lib/docusign";

export const runtime = "nodejs";

/** GET — the employer's editable templates (offer/agreement/nda), seeding
 *  defaults on first use. */
export async function GET() {
  const ctx = await employerContext();
  if (!ctx) return NextResponse.json({ error: "forbidden" }, { status: 403 });
  const templates = await listTemplates(ctx.employerId);
  return NextResponse.json({ templates });
}

/** PUT — save one template, or reset it to the built-in default (`reset: true`).
 *  A saved body must keep the {{signature_block}} token (that's where the
 *  signature + date anchors go); a save that drops it is rejected. */
export async function PUT(req: Request) {
  const ctx = await employerContext();
  if (!ctx) return NextResponse.json({ error: "forbidden" }, { status: 403 });

  const b = (await req.json().catch(() => ({}))) as {
    docType?: string;
    name?: string;
    subject?: string;
    bodyHtml?: string;
    reset?: boolean;
  };
  if (!isEditableDocType(b.docType)) {
    return NextResponse.json({ error: "Unknown template type." }, { status: 400 });
  }

  if (b.reset) {
    const template = await resetTemplate(ctx.employerId, b.docType);
    if (!template) return NextResponse.json({ error: "Could not reset the template." }, { status: 500 });
    return NextResponse.json({ template });
  }

  const bodyHtml = typeof b.bodyHtml === "string" ? b.bodyHtml : "";
  const subject = typeof b.subject === "string" ? b.subject.trim() : "";
  if (!subject) return NextResponse.json({ error: "Give the document a subject." }, { status: 400 });
  if (!bodyHtml.trim()) return NextResponse.json({ error: "The document body can't be empty." }, { status: 400 });
  if (!bodyHtml.includes(SIGNATURE_BLOCK_TOKEN)) {
    return NextResponse.json(
      { error: "The body must keep the {{signature_block}} token — that's where the signature and date fields go." },
      { status: 400 }
    );
  }

  const template = await saveTemplate(ctx.employerId, b.docType, { name: b.name, subject, bodyHtml });
  if (!template) return NextResponse.json({ error: "Could not save the template." }, { status: 500 });
  return NextResponse.json({ template });
}
