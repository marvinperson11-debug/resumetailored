import { NextResponse } from "next/server";
import { employerContext } from "./employer-auth";
import { resumeViewerEnabled } from "./resume-viewer-flag";
import { employerOwnsApplicant, getResumeFile } from "./resume-annotations-store";
import type { Access } from "./plan";

/**
 * The one gate every resume-viewer route goes through, so "who may touch this resume" is decided in one place:
 *
 *   no employer session -> 403 (a guest, a candidate, a non-employer account)
 *   flag off            -> 404 (the feature does not exist yet — said only to a signed-in employer)
 *   applicant not yours -> 403 — deliberately the SAME answer as "no such applicant", so the route never confirms
 *                          that another employer's candidate id exists
 *
 * Returns the caller's context and the applicant id, or the response to send back.
 */
export interface ResumeAccess {
  employerId: string;
  userId: string;
  access: Access;
  applicantId: number;
}

export const noStore = { "Cache-Control": "no-store" } as const;

export async function resolveResumeAccess(rawId: string): Promise<ResumeAccess | NextResponse> {
  const ctx = await employerContext();
  if (!ctx) return NextResponse.json({ error: "forbidden" }, { status: 403, headers: noStore });
  // Identity first, flag second: a guest gets the same 403 every employer route gives, flag or no flag; only a real
  // employer is told the feature isn't live yet. Either way no table is read and no URL is minted.
  if (!resumeViewerEnabled()) return NextResponse.json({ error: "not_found" }, { status: 404, headers: noStore });
  const applicantId = Number(rawId);
  if (!Number.isInteger(applicantId) || applicantId < 1) return NextResponse.json({ error: "forbidden" }, { status: 403, headers: noStore });
  if (!(await employerOwnsApplicant(ctx.employerId, applicantId))) return NextResponse.json({ error: "forbidden" }, { status: 403, headers: noStore });
  return { ...ctx, applicantId };
}

export const isDenied = (v: ResumeAccess | NextResponse): v is NextResponse => v instanceof NextResponse;

/** The applicant's linked PDF (already proven to be this employer's), or a 404 response. */
export async function resolveResumeFile(a: ResumeAccess) {
  const file = await getResumeFile(a.employerId, a.applicantId);
  return file ?? NextResponse.json({ error: "no_resume_file" }, { status: 404, headers: noStore });
}
