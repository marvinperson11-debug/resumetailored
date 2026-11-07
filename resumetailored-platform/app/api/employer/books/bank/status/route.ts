import { NextResponse } from "next/server";
import { employerContext } from "@/lib/employer-auth";
import { canUseBooks, canUseFullBooks } from "@/lib/employer-plan";
import { plaidConfigured } from "@/lib/books-plaid";

export const dynamic = "force-dynamic";

/** GET — whether the Connect Bank flow should even be shown: full Books
 *  (Corporate) AND Plaid credentials present. `configured:false` is how the
 *  client tells "not on your plan" apart from "not set up yet" and shows
 *  the right message for each — see BOOKS.md's env var section. */
export async function GET() {
  const ctx = await employerContext();
  if (!ctx) return NextResponse.json({ error: "forbidden" }, { status: 403 });
  if (!canUseBooks(ctx.access)) return NextResponse.json({ error: "Books is available on the Portal plan and above." }, { status: 403 });

  return NextResponse.json({ allowed: canUseFullBooks(ctx.access), configured: plaidConfigured() });
}
