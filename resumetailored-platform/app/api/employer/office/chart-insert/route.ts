import { NextResponse } from "next/server";
import { employerContext } from "@/lib/employer-auth";
import { isEmployer } from "@/lib/plan";
import { isScalePlusTier, checkDocumentAllowance } from "@/lib/employer-plan";
import { uploadOfficeChartPng } from "@/lib/office-store";
import { listDocuments, createDocument } from "@/lib/documents-store";

export const runtime = "nodejs";

const MAX_PNG_BYTES = 3 * 1024 * 1024; // a rendered 640x400 chart is a few KB-100KB; generous ceiling against abuse

/** POST { title, pngDataUrl } → uploads the chart PNG to the office-assets
 *  bucket and creates a Document Creator row embedding it, so it shows up in
 *  Documents like any other composed document. Owner-only, same as creating
 *  any other document; Scale+ only, same as Charts itself. */
export async function POST(req: Request) {
  const ctx = await employerContext();
  if (!ctx) return NextResponse.json({ error: "forbidden" }, { status: 403 });
  if (!isScalePlusTier(ctx.access)) return NextResponse.json({ error: "Charts are available on the Scale+ plan." }, { status: 403 });
  if (!isEmployer(ctx.access)) return NextResponse.json({ error: "Only the account owner can save documents." }, { status: 403 });

  const used = (await listDocuments(ctx.employerId)).length;
  const allowance = checkDocumentAllowance(ctx.access, used);
  if (!allowance.allowed) return NextResponse.json({ error: allowance.message, code: "limit_reached" }, { status: 402 });

  const b = (await req.json().catch(() => ({}))) as { title?: string; pngDataUrl?: string };
  const title = (b.title || "Chart").trim().slice(0, 200);
  const match = /^data:image\/png;base64,(.+)$/.exec(b.pngDataUrl || "");
  if (!match) return NextResponse.json({ error: "bad_request" }, { status: 400 });

  const png = Buffer.from(match[1], "base64");
  if (!png.length || png.length > MAX_PNG_BYTES) return NextResponse.json({ error: "The chart image is too large." }, { status: 400 });

  const uploaded = await uploadOfficeChartPng(ctx.employerId, png);
  if (!uploaded) return NextResponse.json({ error: "Could not upload the chart. Is storage configured?" }, { status: 500 });

  const doc = await createDocument(ctx.employerId, {
    title,
    bodyHtml: `<p><img src="${uploaded.url}" alt="${title.replace(/"/g, "&quot;")}" style="max-width:100%;" /></p>`,
    kind: "chart",
    assetUrl: uploaded.url,
  });
  if (!doc) return NextResponse.json({ error: "Could not create the document." }, { status: 500 });

  return NextResponse.json({ document: doc });
}
