import { NextResponse } from "next/server";
import { employerContext } from "@/lib/employer-auth";
import { isEmployer } from "@/lib/plan";
import { listTemplates, createTemplate } from "@/lib/checklist-store";
import { normalizeItemLabels } from "@/lib/checklist-hub";

export const runtime = "nodejs";

/** GET the employer's onboarding checklist templates (default first). */
export async function GET() {
  const ctx = await employerContext();
  if (!ctx) return NextResponse.json({ error: "forbidden" }, { status: 403 });
  const templates = await listTemplates(ctx.employerId);
  return NextResponse.json({ templates });
}

/** POST create a custom template. Body: { name, items: string[] }. */
export async function POST(req: Request) {
  const ctx = await employerContext();
  if (!ctx) return NextResponse.json({ error: "forbidden" }, { status: 403 });
  if (!isEmployer(ctx.access)) return NextResponse.json({ error: "Only the account owner can manage checklist templates." }, { status: 403 });

  const b = (await req.json().catch(() => ({}))) as { name?: string; items?: string[] };
  const name = (b.name || "").trim();
  if (!name) return NextResponse.json({ error: "A name is required." }, { status: 400 });
  const items = normalizeItemLabels(Array.isArray(b.items) ? b.items : []);

  const template = await createTemplate(ctx.employerId, name, items);
  if (!template) return NextResponse.json({ error: "Could not create the template." }, { status: 500 });
  return NextResponse.json({ template });
}
