import { NextResponse } from "next/server";
import { auth } from "@clerk/nextjs/server";
import { rateLimit } from "@/lib/rate-limit";
import { recordGeneration } from "@/lib/generations";
import { anthropicLlm, resolveProfile, runStoredVacancy } from "@/lib/docs/runner";
import { createVacancy, signedUrl } from "@/lib/docs/store";

export const runtime = "nodejs";
export const maxDuration = 120;

/**
 * Structured single run: vacancy in, validated .docx files out (Storage + signed download URLs).
 * Body: { vacancyId } OR { vacancy: {employer, position, description} } (saved first, then read back by id),
 *       { types?: ["resume","cover_letter"], profileText? }.
 * Employer + position are read fresh from the vacancy row by id — never from the request text, history or a prior run.
 */
export async function POST(req: Request) {
  const limited = rateLimit(req, "documents-generate");
  if (limited) return limited;
  const { userId } = await auth();
  if (!userId) return NextResponse.json({ error: "Sign in required." }, { status: 401 });
  const body = (await req.json().catch(() => ({}))) as { vacancyId?: unknown; vacancy?: { employer?: string; position?: string; description?: string }; types?: unknown; profileText?: unknown };

  const llm = anthropicLlm();
  if (!llm) return NextResponse.json({ error: "not_configured", message: "AI is not configured. Set ANTHROPIC_API_KEY." }, { status: 501 });

  let vacancyId = typeof body.vacancyId === "string" ? body.vacancyId : "";
  if (!vacancyId && body.vacancy?.employer && body.vacancy?.position) {
    const v = await createVacancy(userId, { employer: body.vacancy.employer, position: body.vacancy.position, description: body.vacancy.description || "" });
    if (!v) return NextResponse.json({ error: "Could not save the vacancy." }, { status: 503 });
    vacancyId = v.id;
  }
  if (!vacancyId) return NextResponse.json({ error: "vacancyId (or a vacancy) is required." }, { status: 400 });

  const kinds = (Array.isArray(body.types) ? body.types : ["resume", "cover_letter"]).filter((t): t is "resume" | "cover_letter" => t === "resume" || t === "cover_letter");
  if (!kinds.length) return NextResponse.json({ error: "types must include resume and/or cover_letter." }, { status: 400 });

  const profileText = await resolveProfile(userId, body.profileText);
  if (!profileText) return NextResponse.json({ error: "no_profile", message: "Add your career details (or save a resume) first." }, { status: 400 });

  try {
    const run = await runStoredVacancy({ userId, vacancyId, profileText, llm, kinds });
    if (!run) return NextResponse.json({ error: "Vacancy not found." }, { status: 404 });
    const { vacancy, result, paths } = run;
    const base = `${vacancy.employer}_${vacancy.position}`.replace(/[^A-Za-z0-9]+/g, "_").slice(0, 80);
    const files: Record<string, { url: string | null; name: string }> = {};
    if (paths.resume) files.resume = { name: "Resume.docx", url: await signedUrl(paths.resume, `${base}_Resume.docx`) };
    if (paths.coverLetter) files.coverLetter = { name: "CoverLetter.docx", url: await signedUrl(paths.coverLetter, `${base}_CoverLetter.docx`) };
    if (files.resume) await recordGeneration(userId, "resume", { mode: "resume", vacancyId });
    if (files.coverLetter) await recordGeneration(userId, "cover_letter", { mode: "cover_letter", vacancyId });
    const failed = result.errors.length && !Object.keys(files).length && !result.resume?.flags.length;
    return NextResponse.json(
      {
        vacancy: { id: vacancy.id, employer: vacancy.employer, position: vacancy.position },
        files,
        // Unverified resume details: the resume is withheld until the user reviews them.
        needsReview: result.resume?.flags.length ? { resume: result.resume.flags } : undefined,
        errors: result.errors,
      },
      { status: failed ? 422 : 200 }
    );
  } catch (e) {
    console.error("[documents/generate]", e instanceof Error ? e.message : e);
    return NextResponse.json({ error: "Generation failed. Please try again." }, { status: 500 });
  }
}
