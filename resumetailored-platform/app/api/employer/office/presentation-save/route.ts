import { NextResponse } from "next/server";
import { employerContext } from "@/lib/employer-auth";
import { isEmployer } from "@/lib/plan";
import { isScalePlusTier } from "@/lib/employer-plan";
import { sanitizeDeck, presentationDeckToHtml, PRESENTATION_SLIDE_COUNTS } from "@/lib/office-hub";
import { createDocument } from "@/lib/documents-store";

export const runtime = "nodejs";

const MAX_SLIDES = Math.max(...PRESENTATION_SLIDE_COUNTS);

/**
 * POST { title, slides } → renders the deck as static, scrollable HTML and
 * saves it as a `documents` row (kind: "presentation"), so it opens in the
 * Documents viewer like any other composed document. Owner-only, same as
 * creating any other document; Scale+ only, same as the Presentation Builder
 * itself.
 */
export async function POST(req: Request) {
  const ctx = await employerContext();
  if (!ctx) return NextResponse.json({ error: "forbidden" }, { status: 403 });
  if (!isScalePlusTier(ctx.access)) return NextResponse.json({ error: "The Presentation Builder is available on the Scale+ plan." }, { status: 403 });
  if (!isEmployer(ctx.access)) return NextResponse.json({ error: "Only the account owner can save documents." }, { status: 403 });

  const body = await req.json().catch(() => null);
  const deck = sanitizeDeck(body, MAX_SLIDES);
  if (!deck || deck.slides.length === 0) return NextResponse.json({ error: "bad_request" }, { status: 400 });

  const doc = await createDocument(ctx.employerId, {
    title: deck.title,
    bodyHtml: presentationDeckToHtml(deck),
    kind: "presentation",
  });
  if (!doc) return NextResponse.json({ error: "Could not create the document." }, { status: 500 });

  return NextResponse.json({ document: doc });
}
