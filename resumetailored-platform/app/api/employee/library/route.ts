import { NextResponse } from "next/server";
import { employeeContext } from "@/lib/employee-auth";
import { listLibrary, listLibraryCategories } from "@/lib/training-library";

export const runtime = "nodejs";

/** GET the built-in Training Library — same shared content the employer
 *  browses, for the employee's own "Take this training" self-assign flow. */
export async function GET(req: Request) {
  const ctx = await employeeContext();
  if (!ctx) return NextResponse.json({ error: "forbidden" }, { status: 403 });
  const url = new URL(req.url);
  const category = url.searchParams.get("category") || undefined;
  const q = url.searchParams.get("q") || undefined;
  const [items, categories] = await Promise.all([listLibrary({ category, q }), listLibraryCategories()]);
  return NextResponse.json({ items, categories });
}
