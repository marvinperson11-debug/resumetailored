import { NextResponse } from "next/server";
import { auth } from "@clerk/nextjs/server";
import { rateLimit } from "@/lib/rate-limit";
import { proxyPdf } from "@/lib/craft/proxy";

export const runtime = "nodejs";

/**
 * Plain text of a PDF (PdfCraft, via the Craft sidecar; pages separated by form feeds). Body: multipart
 * `file` (PDF, <= 10 MB, <= 10 pages). Signed-in only. 503 when PDFCRAFT_ENABLED is off or the sidecar
 * cannot answer — callers degrade.
 */
export async function POST(req: Request) {
  const limited = rateLimit(req, "craft-pdf");
  if (limited) return limited;
  const { userId } = await auth();
  if (!userId) return NextResponse.json({ error: "Sign in to extract PDF text." }, { status: 401 });
  return proxyPdf(req, "text");
}
