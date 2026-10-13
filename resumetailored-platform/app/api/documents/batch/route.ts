import { NextResponse } from "next/server";
import { auth } from "@clerk/nextjs/server";
import { rateLimit } from "@/lib/rate-limit";
import { docsDb, createVacancy } from "@/lib/docs/store";
import { processBatch, resolveProfile } from "@/lib/docs/runner";

export const runtime = "nodejs";
export const maxDuration = 300;

const BATCH_MAX = 10;

/**
 * Batch: many vacancies, ONE career profile. Rows go into the queue (document_batch_items) and the same
 * single-run engine processes them in the background (2 at a time); poll GET /api/documents/batch/:id for
 * the status and the ZIP (EmployerName_PositionTitle/{Resume.docx, CoverLetter.docx}).
 * Body: { vacancies: [{employer, position, description}], profileText? }
 */
export async function POST(req: Request) {
  const limited = rateLimit(req, "documents-batch", 5);
  if (limited) return limited;
  const { userId } = await auth();
  if (!userId) return NextResponse.json({ error: "Sign in required." }, { status: 401 });
  const c = docsDb();
  if (!c) return NextResponse.json({ error: "Storage is not configured." }, { status: 503 });
  const b = (await req.json().catch(() => ({}))) as { vacancies?: unknown; profileText?: unknown };
  const list = Array.isArray(b.vacancies) ? b.vacancies : [];
  if (!list.length || list.length > BATCH_MAX) return NextResponse.json({ error: `Send between 1 and ${BATCH_MAX} vacancies.` }, { status: 400 });
  const clean = list.map((v) => {
    const x = (v || {}) as Record<string, unknown>;
    return { employer: typeof x.employer === "string" ? x.employer.trim() : "", position: typeof x.position === "string" ? x.position.trim() : "", description: typeof x.description === "string" ? x.description.slice(0, 50000) : "" };
  });
  const bad = clean.findIndex((v) => !v.employer || !v.position || v.employer.length > 200 || v.position.length > 200);
  if (bad >= 0) return NextResponse.json({ error: `Vacancy ${bad + 1} needs an employer and a position.` }, { status: 400 });

  const profileText = await resolveProfile(userId, b.profileText);
  if (!profileText) return NextResponse.json({ error: "no_profile", message: "Add your career details (or save a resume) first." }, { status: 400 });

  // One active batch per account keeps the AI bill predictable.
  const { data: active } = await c.from("document_batches").select("id").eq("user_id", userId).in("status", ["queued", "running"]).gte("updated_at", new Date(Date.now() - 30 * 60_000).toISOString()).limit(1);
  if (active?.length) return NextResponse.json({ error: "batch_in_progress", message: "A batch is already running. Wait for it to finish.", batchId: (active[0] as { id: string }).id }, { status: 429 });

  const { data: batch, error } = await c.from("document_batches").insert({ user_id: userId, status: "queued", profile_text: profileText }).select("id").single();
  if (error || !batch) return NextResponse.json({ error: "Could not create the batch." }, { status: 503 });
  const batchId = (batch as { id: string }).id;
  const rows = [];
  for (let i = 0; i < clean.length; i++) {
    const v = await createVacancy(userId, clean[i]);
    if (!v) return NextResponse.json({ error: "Could not save a vacancy." }, { status: 503 });
    rows.push({ batch_id: batchId, user_id: userId, vacancy_id: v.id, position: i, status: "pending" });
  }
  const { error: qerr } = await c.from("document_batch_items").insert(rows);
  if (qerr) return NextResponse.json({ error: "Could not queue the batch." }, { status: 503 });

  // Background worker. The Railway process is long-lived; if it restarts mid-batch the status route resumes the queue.
  void processBatch(batchId).catch((e) => console.error("[batch]", batchId, e instanceof Error ? e.message : e));
  return NextResponse.json({ batchId, status: "queued", total: rows.length }, { status: 202 });
}
