import { NextResponse } from "next/server";
import { resolveResumeAccess, resolveResumeFile, isDenied, noStore } from "@/lib/resume-viewer-access";
import { createAnnotation, listAnnotations } from "@/lib/resume-annotations-store";
import { parseAnnotationInput } from "@/lib/resume-annotations";

export const runtime = "nodejs";

/** GET — this employer team's annotations on the applicant's resume. */
export async function GET(_req: Request, { params }: { params: { id: string } }) {
  const a = await resolveResumeAccess(params.id);
  if (isDenied(a)) return a;
  const file = await resolveResumeFile(a);
  if (file instanceof NextResponse) return file;
  return NextResponse.json({ annotations: await listAnnotations(a.employerId, file.id) }, { headers: noStore });
}

/** POST — add a highlight or note. The file is looked up from the APPLICANT, never taken from the client. */
export async function POST(req: Request, { params }: { params: { id: string } }) {
  const a = await resolveResumeAccess(params.id);
  if (isDenied(a)) return a;
  const file = await resolveResumeFile(a);
  if (file instanceof NextResponse) return file;
  const parsed = parseAnnotationInput(await req.json().catch(() => null));
  if (!parsed.ok) return NextResponse.json({ error: parsed.error }, { status: 400, headers: noStore });
  const res = await createAnnotation(a.employerId, file.id, a.userId, parsed.value);
  if (!res.ok) return NextResponse.json({ error: res.error }, { status: res.error === "limit" ? 409 : 500, headers: noStore });
  return NextResponse.json({ annotation: res.annotation }, { status: 201, headers: noStore });
}
