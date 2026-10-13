import { NextResponse } from "next/server";
import { resolveResumeAccess, isDenied, noStore } from "@/lib/resume-viewer-access";
import { getResumeFile, listAnnotations, signResumeUrl } from "@/lib/resume-annotations-store";
import { SIGNED_URL_TTL_SECONDS } from "@/lib/resume-annotations";

export const runtime = "nodejs";

/**
 * GET — the PDF for one of THIS employer's applicants: a 60-second signed URL into the private
 * `applicant-resumes` bucket, plus the team's annotations on it. There is no public URL anywhere: the bucket is
 * private and this is the only route that mints access, after proving the applicant belongs to the caller.
 * `{ file: null }` (200) means the applicant simply has no PDF on file (a pasted resume, a public-board
 * application) and the UI shows nothing.
 */
export async function GET(_req: Request, { params }: { params: { id: string } }) {
  const a = await resolveResumeAccess(params.id);
  if (isDenied(a)) return a;
  const file = await getResumeFile(a.employerId, a.applicantId);
  if (!file) return NextResponse.json({ file: null }, { headers: noStore });
  const url = await signResumeUrl(file.storagePath, SIGNED_URL_TTL_SECONDS);
  if (!url) return NextResponse.json({ error: "sign_failed" }, { status: 502, headers: noStore });
  const annotations = await listAnnotations(a.employerId, file.id);
  return NextResponse.json(
    { file: { id: file.id, filename: file.filename, sizeBytes: file.sizeBytes }, url, expiresIn: SIGNED_URL_TTL_SECONDS, annotations },
    { headers: noStore }
  );
}
