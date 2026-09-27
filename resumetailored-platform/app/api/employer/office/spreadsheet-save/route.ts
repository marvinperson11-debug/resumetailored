import { NextResponse } from "next/server";
import { employerContext } from "@/lib/employer-auth";
import { isEmployer } from "@/lib/plan";
import { isScalePlusTier } from "@/lib/employer-plan";
import { sanitizeGrid, spreadsheetGridToHtmlTable } from "@/lib/office-hub";
import { createDocument } from "@/lib/documents-store";

export const runtime = "nodejs";

/**
 * POST { title, headers, rows } → renders the grid as an HTML table and saves
 * it as a `documents` row (kind: "spreadsheet"), so it opens in the Documents
 * viewer like any other composed document. Owner-only, same as creating any
 * other document; Scale+ only, same as the Spreadsheet Creator itself.
 */
export async function POST(req: Request) {
  const ctx = await employerContext();
  if (!ctx) return NextResponse.json({ error: "forbidden" }, { status: 403 });
  if (!isScalePlusTier(ctx.access)) return NextResponse.json({ error: "The Spreadsheet Creator is available on the Scale+ plan." }, { status: 403 });
  if (!isEmployer(ctx.access)) return NextResponse.json({ error: "Only the account owner can save documents." }, { status: 403 });

  const body = await req.json().catch(() => null);
  const grid = sanitizeGrid(body);
  if (!grid || grid.headers.length === 0) return NextResponse.json({ error: "bad_request" }, { status: 400 });

  const doc = await createDocument(ctx.employerId, {
    title: grid.title,
    bodyHtml: spreadsheetGridToHtmlTable(grid),
    kind: "spreadsheet",
  });
  if (!doc) return NextResponse.json({ error: "Could not create the document." }, { status: 500 });

  return NextResponse.json({ document: doc });
}
