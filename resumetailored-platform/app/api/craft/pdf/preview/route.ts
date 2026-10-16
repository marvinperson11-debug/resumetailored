import { NextResponse } from "next/server";
import { auth } from "@clerk/nextjs/server";
import { rateLimit } from "@/lib/rate-limit";
import { proxyPdf } from "@/lib/craft/proxy";

export const runtime = "nodejs";

/**
 * PNG previews of a PDF's pages (PdfCraft, via the Craft sidecar). Body: multipart `file` (PDF, <= 10 MB,
 * <= 10 pages); optional ?maxPages=. One page -> image/png, several -> application/zip of page-NN.png.
 * Signed-in only. 503 when PDFCRAFT_ENABLED is off or the sidecar cannot answer — callers degrade.
 */
export async function POST(req: Request) {
  const limited = rateLimit(req, "craft-pdf");
  if (limited) return limited;
  const { userId } = await auth();
  if (!userId) return NextResponse.json({ error: "Sign in to preview PDFs." }, { status: 401 });
  return proxyPdf(req, "preview");
}
