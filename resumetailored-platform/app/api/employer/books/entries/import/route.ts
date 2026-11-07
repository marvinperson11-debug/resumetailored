import { NextResponse } from "next/server";
import { employerContext } from "@/lib/employer-auth";
import { canUseBooks } from "@/lib/employer-plan";
import { createEntriesBulk } from "@/lib/books-store";
import { parseEntriesCsv } from "@/lib/books-hub";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 30;

const MAX_CSV_BYTES = 2 * 1024 * 1024; // 2 MB

/** POST — multipart CSV import. Field name "file". Returns an import-result
 *  summary: rows imported / rows skipped (with a reason per skipped row). */
export async function POST(req: Request) {
  const ctx = await employerContext();
  if (!ctx) return NextResponse.json({ error: "forbidden" }, { status: 403 });
  if (!canUseBooks(ctx.access)) return NextResponse.json({ error: "Books is available on the Portal plan and above." }, { status: 403 });

  let form: FormData;
  try {
    form = await req.formData();
  } catch {
    return NextResponse.json({ error: "Invalid upload." }, { status: 400 });
  }
  const file = form.get("file");
  if (!(file instanceof File)) return NextResponse.json({ error: "No file provided." }, { status: 400 });
  if (file.size > MAX_CSV_BYTES) return NextResponse.json({ error: "File is too large — keep it under 2 MB." }, { status: 400 });

  const text = await file.text();
  const { imported, skipped } = parseEntriesCsv(text);
  const insertedCount = imported.length ? await createEntriesBulk(ctx.employerId, ctx.userId, imported) : 0;

  return NextResponse.json({
    importedCount: insertedCount,
    skippedCount: skipped.length,
    skipped: skipped.slice(0, 100),
  });
}
