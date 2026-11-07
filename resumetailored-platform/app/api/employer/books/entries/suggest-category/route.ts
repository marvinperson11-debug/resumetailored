import { NextResponse } from "next/server";
import { employerContext } from "@/lib/employer-auth";
import { canUseBooks } from "@/lib/employer-plan";
import { suggestCategory, isBooksEntryType } from "@/lib/books-hub";

export const dynamic = "force-dynamic";

/** POST { description, type } — a suggestion only, never applied silently;
 *  the entry form shows it as a one-click fill, the employer confirms (or
 *  overrides) by picking the category themselves. See lib/books-hub.ts
 *  `suggestCategory`'s header comment for why this is a deterministic
 *  keyword rule rather than a Taylor/model call. */
export async function POST(req: Request) {
  const ctx = await employerContext();
  if (!ctx) return NextResponse.json({ error: "forbidden" }, { status: 403 });
  if (!canUseBooks(ctx.access)) return NextResponse.json({ error: "Books is available on the Portal plan and above." }, { status: 403 });

  const body = (await req.json().catch(() => ({}))) as { description?: string; type?: string };
  if (!isBooksEntryType(body.type)) return NextResponse.json({ error: "type must be 'income' or 'expense'." }, { status: 400 });
  const category = suggestCategory(String(body.description || ""), body.type);
  return NextResponse.json({ category });
}
