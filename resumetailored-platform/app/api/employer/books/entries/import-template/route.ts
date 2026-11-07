import { NextResponse } from "next/server";
import { employerContext } from "@/lib/employer-auth";
import { canUseBooks } from "@/lib/employer-plan";
import { buildEntriesCsvTemplate } from "@/lib/books-hub";

export const dynamic = "force-dynamic";

/** GET — a downloadable blank CSV template for the entries importer. */
export async function GET() {
  const ctx = await employerContext();
  if (!ctx) return NextResponse.json({ error: "forbidden" }, { status: 403 });
  if (!canUseBooks(ctx.access)) return NextResponse.json({ error: "Books is available on the Portal plan and above." }, { status: 403 });

  const csv = buildEntriesCsvTemplate();
  return new NextResponse(csv, {
    status: 200,
    headers: { "Content-Type": "text/csv; charset=utf-8", "Content-Disposition": 'attachment; filename="books-entries-template.csv"' },
  });
}
