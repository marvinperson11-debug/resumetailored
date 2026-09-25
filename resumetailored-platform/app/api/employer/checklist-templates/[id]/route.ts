import { NextResponse } from "next/server";
import { employerContext } from "@/lib/employer-auth";
import { isEmployer } from "@/lib/plan";
import { getTemplateWithItems, updateTemplate, setTemplateItems, deleteTemplate } from "@/lib/checklist-store";
import { normalizeItemLabels } from "@/lib/checklist-hub";

export const runtime = "nodejs";

/** GET one template with its items. */
export async function GET(_req: Request, { params }: { params: { id: string } }) {
  const ctx = await employerContext();
  if (!ctx) return NextResponse.json({ error: "forbidden" }, { status: 403 });
  const id = Number(params.id);
  const template = await getTemplateWithItems(ctx.employerId, id);
  if (!template) return NextResponse.json({ error: "not_found" }, { status: 404 });
  return NextResponse.json({ template });
}

/** PATCH edit a template's name and/or replace its items wholesale. Body:
 *  { name?, items? } — items, when present, fully replaces the item list
 *  (in-progress employee checklists keep their own snapshot, untouched). */
export async function PATCH(req: Request, { params }: { params: { id: string } }) {
  const ctx = await employerContext();
  if (!ctx) return NextResponse.json({ error: "forbidden" }, { status: 403 });
  if (!isEmployer(ctx.access)) return NextResponse.json({ error: "Only the account owner can manage checklist templates." }, { status: 403 });
  const id = Number(params.id);
  if (!Number.isFinite(id)) return NextResponse.json({ error: "bad id" }, { status: 400 });

  const b = (await req.json().catch(() => ({}))) as { name?: string; items?: string[] };
  if (typeof b.name === "string" && b.name.trim()) {
    const ok = await updateTemplate(ctx.employerId, id, b.name);
    if (!ok) return NextResponse.json({ error: "Could not update the name." }, { status: 400 });
  }
  if (Array.isArray(b.items)) {
    const ok = await setTemplateItems(ctx.employerId, id, normalizeItemLabels(b.items));
    if (!ok) return NextResponse.json({ error: "Could not update the items." }, { status: 400 });
  }
  const template = await getTemplateWithItems(ctx.employerId, id);
  if (!template) return NextResponse.json({ error: "not_found" }, { status: 404 });
  return NextResponse.json({ template });
}

/** DELETE a template. Employee checklists already started from it keep their
 *  snapshot (their template_id is set null, not cascaded). */
export async function DELETE(_req: Request, { params }: { params: { id: string } }) {
  const ctx = await employerContext();
  if (!ctx) return NextResponse.json({ error: "forbidden" }, { status: 403 });
  if (!isEmployer(ctx.access)) return NextResponse.json({ error: "Only the account owner can manage checklist templates." }, { status: 403 });
  const id = Number(params.id);
  const ok = await deleteTemplate(ctx.employerId, id);
  return NextResponse.json({ ok });
}
