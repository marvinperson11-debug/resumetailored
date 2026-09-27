import { NextResponse } from "next/server";
import * as XLSX from "xlsx";
import { employerContext } from "@/lib/employer-auth";
import { isScalePlusTier } from "@/lib/employer-plan";
import { sanitizeGrid } from "@/lib/office-hub";

export const runtime = "nodejs";

/**
 * POST { title, headers, rows } → a real .xlsx download of the (possibly
 * user-edited) preview grid. `xlsx` (SheetJS community edition) is the one new
 * dependency this phase adds — pure JS, no native/binary deps, and by far the
 * smallest way to emit a real OOXML workbook rather than hand-rolling the zip
 * format. Scale+ only, same gate as Charts.
 */
export async function POST(req: Request) {
  const ctx = await employerContext();
  if (!ctx) return NextResponse.json({ error: "forbidden" }, { status: 403 });
  if (!isScalePlusTier(ctx.access)) return NextResponse.json({ error: "The Spreadsheet Creator is available on the Scale+ plan." }, { status: 403 });

  const body = await req.json().catch(() => null);
  const grid = sanitizeGrid(body);
  if (!grid || grid.headers.length === 0) return NextResponse.json({ error: "bad_request" }, { status: 400 });

  const wb = XLSX.utils.book_new();
  const ws = XLSX.utils.aoa_to_sheet([grid.headers, ...grid.rows]);
  XLSX.utils.book_append_sheet(wb, ws, "Sheet1");
  const buf = XLSX.write(wb, { type: "buffer", bookType: "xlsx" }) as Buffer;

  const filename = `${(grid.title || "spreadsheet").replace(/[^a-z0-9]+/gi, "-").toLowerCase().slice(0, 80) || "spreadsheet"}.xlsx`;
  return new NextResponse(new Uint8Array(buf), {
    status: 200,
    headers: {
      "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "Content-Disposition": `attachment; filename="${filename}"`,
    },
  });
}
