import { NextResponse } from "next/server";
import { resolveResumeAccess, resolveResumeFile, isDenied, noStore } from "@/lib/resume-viewer-access";
import { deleteAnnotation, updateAnnotation } from "@/lib/resume-annotations-store";
import { parseAnnotationPatch } from "@/lib/resume-annotations";

export const runtime = "nodejs";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** PATCH — edit a note's text, change a colour, or move/resize. Page, kind and author never change. */
export async function PATCH(req: Request, { params }: { params: { id: string; annId: string } }) {
  const a = await resolveResumeAccess(params.id);
  if (isDenied(a)) return a;
  const file = await resolveResumeFile(a);
  if (file instanceof NextResponse) return file;
  if (!UUID.test(params.annId)) return NextResponse.json({ error: "not_found" }, { status: 404, headers: noStore });
  const parsed = parseAnnotationPatch(await req.json().catch(() => null));
  if (!parsed.ok) return NextResponse.json({ error: parsed.error }, { status: 400, headers: noStore });
  const annotation = await updateAnnotation(a.employerId, file.id, params.annId, parsed.value);
  if (!annotation) return NextResponse.json({ error: "not_found" }, { status: 404, headers: noStore });
  return NextResponse.json({ annotation }, { headers: noStore });
}

/** DELETE — remove an annotation (the PDF itself is never touched). */
export async function DELETE(_req: Request, { params }: { params: { id: string; annId: string } }) {
  const a = await resolveResumeAccess(params.id);
  if (isDenied(a)) return a;
  const file = await resolveResumeFile(a);
  if (file instanceof NextResponse) return file;
  if (!UUID.test(params.annId)) return NextResponse.json({ error: "not_found" }, { status: 404, headers: noStore });
  const ok = await deleteAnnotation(a.employerId, file.id, params.annId);
  if (!ok) return NextResponse.json({ error: "not_found" }, { status: 404, headers: noStore });
  return NextResponse.json({ ok: true }, { headers: noStore });
}
