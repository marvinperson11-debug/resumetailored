import { NextResponse } from "next/server";
import { auth } from "@clerk/nextjs/server";
import { rateLimit } from "@/lib/rate-limit";
import { recordGeneration } from "@/lib/generations";
import { anthropicLlm, resolveProfile } from "@/lib/docs/runner";
import { signedUrl, putFile } from "@/lib/docs/store";
import { generateSelectionCriteria, deriveSender, GenerationError } from "@/lib/docs/pipeline";
import { DOCX_MIME, renderSelectionCriteriaDocx } from "@/lib/docs/docx-render";
import { randomUUID } from "crypto";

export const runtime = "nodejs";
export const maxDuration = 120;

/** Third document type: a STAR-format response per selection criterion (Australian applications), evidence from the career profile only. */
export async function POST(req: Request) {
  const limited = rateLimit(req, "documents-criteria");
  if (limited) return limited;
  const { userId } = await auth();
  if (!userId) return NextResponse.json({ error: "Sign in required." }, { status: 401 });
  const b = (await req.json().catch(() => ({}))) as { criteria?: unknown; position?: unknown; employer?: unknown; profileText?: unknown };
  const criteria = Array.isArray(b.criteria) ? b.criteria.filter((c): c is string => typeof c === "string" && !!c.trim()).map((c) => c.trim().slice(0, 1000)) : [];
  const position = typeof b.position === "string" ? b.position.trim() : "";
  if (!criteria.length || criteria.length > 15) return NextResponse.json({ error: "Provide 1–15 selection criteria." }, { status: 400 });
  if (!position) return NextResponse.json({ error: "position is required." }, { status: 400 });
  const llm = anthropicLlm();
  if (!llm) return NextResponse.json({ error: "not_configured", message: "AI is not configured. Set ANTHROPIC_API_KEY." }, { status: 501 });
  const profileText = await resolveProfile(userId, b.profileText);
  if (!profileText) return NextResponse.json({ error: "no_profile", message: "Add your career details (or save a resume) first." }, { status: 400 });
  try {
    const doc = await generateSelectionCriteria({
      position, employer: typeof b.employer === "string" ? b.employer.trim() || undefined : undefined,
      criteria, profileText, llm, senderFallback: deriveSender(profileText),
    });
    const docx = await renderSelectionCriteriaDocx(doc);
    const path = `${userId}/criteria/${randomUUID()}/SelectionCriteriaResponse.docx`;
    if (!(await putFile(path, docx, DOCX_MIME))) return NextResponse.json({ error: "Could not store the document." }, { status: 503 });
    await recordGeneration(userId, "resume", { mode: "selection_criteria" });
    const gaps = doc.responses.filter((r) => !r.task && !r.action && !r.result).map((r) => r.criterion);
    return NextResponse.json({ file: { name: "SelectionCriteriaResponse.docx", url: await signedUrl(path, "SelectionCriteriaResponse.docx") }, criteriaWithoutEvidence: gaps });
  } catch (e) {
    if (e instanceof GenerationError) return NextResponse.json({ error: e.code, message: e.message }, { status: 422 });
    console.error("[documents/selection-criteria]", e instanceof Error ? e.message : e);
    return NextResponse.json({ error: "Generation failed. Please try again." }, { status: 500 });
  }
}
