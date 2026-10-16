import { NextResponse } from "next/server";
import { auth } from "@clerk/nextjs/server";
import { docsDb, signedUrl } from "@/lib/docs/store";
import { processBatch } from "@/lib/docs/runner";
import { itemReview } from "@/lib/docs/review";

export const runtime = "nodejs";

/** Batch status (+ ZIP download URL once done). Polling also resumes a queue orphaned by a server restart. */
export async function GET(_req: Request, { params }: { params: { id: string } }) {
  const { userId } = await auth();
  if (!userId) return NextResponse.json({ error: "Sign in required." }, { status: 401 });
  const c = docsDb();
  if (!c) return NextResponse.json({ error: "Storage is not configured." }, { status: 503 });
  const { data: batch } = await c.from("document_batches").select("id, status, zip_path, created_at").eq("user_id", userId).eq("id", params.id).maybeSingle();
  if (!batch) return NextResponse.json({ error: "Not found." }, { status: 404 });
  const bt = batch as { id: string; status: string; zip_path: string | null };
  const { data: items } = await c.from("document_batch_items").select("vacancy_id, position, status, flags, errors").eq("batch_id", bt.id).order("position", { ascending: true });
  const rows = (items || []) as { vacancy_id: string; position: number; status: string; flags: unknown[]; errors: unknown[] }[];
  if ((bt.status === "queued" || bt.status === "running") && rows.some((r) => r.status === "pending" || r.status === "running")) {
    void processBatch(bt.id).catch(() => {}); // no-op while a worker in this process already owns it
  }
  const { data: vs } = await c.from("vacancies").select("id, employer, position").eq("user_id", userId).in("id", rows.map((r) => r.vacancy_id));
  const name = new Map((vs || []).map((v) => [(v as { id: string }).id, v as { employer: string; position: string }]));
  // review: why an item is incomplete, as { kind, code, message } (the errors[] shape), so nobody has to open the ZIP to find out.
  const itemsOut = rows.map((r) => ({ employer: name.get(r.vacancy_id)?.employer, position: name.get(r.vacancy_id)?.position, status: r.status, flags: r.flags, errors: r.errors, review: itemReview(r.flags, r.errors) }));
  return NextResponse.json({
    batchId: bt.id,
    status: bt.status,
    total: rows.length,
    completed: rows.filter((r) => !["pending", "running"].includes(r.status)).length,
    needsReview: itemsOut.filter((i) => i.review.length).length,
    items: itemsOut,
    zipUrl: bt.status === "done" && bt.zip_path ? await signedUrl(bt.zip_path, "Applications.zip") : null,
  });
}
