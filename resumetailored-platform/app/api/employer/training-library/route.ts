import { NextResponse } from "next/server";
import { employerContext } from "@/lib/employer-auth";
import { listLibrary, listLibraryCategories } from "@/lib/training-library";

export const runtime = "nodejs";

/**
 * GET the built-in Training Library (shared US-government public-domain content).
 * Any employer-portal user may browse it; `?category=` and `?q=` filter. The
 * distinct category list rides along for the tab's filter chips.
 */
export async function GET(req: Request) {
  const ctx = await employerContext();
  if (!ctx) return NextResponse.json({ error: "forbidden" }, { status: 403 });
  const url = new URL(req.url);
  const category = url.searchParams.get("category") || undefined;
  const q = url.searchParams.get("q") || undefined;
  const [items, categories] = await Promise.all([listLibrary({ category, q }), listLibraryCategories()]);
  return NextResponse.json({ items, categories });
}
