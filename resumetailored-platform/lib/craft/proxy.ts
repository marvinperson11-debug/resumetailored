import { NextResponse } from "next/server";
import { craftPost } from "./client";
import { CRAFT_MAX_BYTES, pdfCraftEnabled } from "./config";

/**
 * Shared body of /api/craft/pdf/preview and /api/craft/pdf/text (the routes do rate limiting + auth first).
 * Any reason the sidecar cannot answer — switched off, unconfigured, unreachable, untrusted, timed out or the
 * CLI failed — is a 503 with a code, never a 500, so a caller can fall back. The upload's own problems keep
 * their meaning: 400 no file, 413 too large / too many pages, 422 not a readable PDF.
 */
const unavailable = (error: string) =>
  NextResponse.json({ error, message: "PDF preview is unavailable right now." }, { status: 503, headers: { "Retry-After": "30" } });

export async function proxyPdf(req: Request, op: "preview" | "text"): Promise<Response> {
  if (!pdfCraftEnabled()) return unavailable("craft_disabled");
  const declared = Number(req.headers.get("content-length"));
  if (Number.isFinite(declared) && declared > CRAFT_MAX_BYTES + 64 * 1024) return NextResponse.json({ error: "too_large", message: "PDFs up to 10 MB only." }, { status: 413 });
  const form = await req.formData().catch(() => null);
  const file = form?.get("file");
  if (!file || typeof file === "string") return NextResponse.json({ error: "no_file", message: "Attach a PDF as 'file'." }, { status: 400 });
  if (file.size > CRAFT_MAX_BYTES) return NextResponse.json({ error: "too_large", message: "PDFs up to 10 MB only." }, { status: 413 });
  const pdf = Buffer.from(await file.arrayBuffer());

  const query: Record<string, string> = {};
  const maxPages = new URL(req.url).searchParams.get("maxPages");
  if (op === "preview" && maxPages && /^\d{1,2}$/.test(maxPages)) query.maxPages = maxPages;
  const r = await craftPost(`/pdf/${op}`, pdf, { filename: "document.pdf", mime: "application/pdf", query });
  if (r.kind === "unavailable") {
    console.error("[craft] sidecar unavailable", JSON.stringify({ op, reason: r.reason, detail: r.detail }));
    return unavailable("craft_unavailable");
  }
  if (r.status === 200) {
    const headers: Record<string, string> = { "Content-Type": r.headers.get("content-type") || "application/octet-stream", "Cache-Control": "no-store" };
    for (const h of ["x-craft-pages", "x-craft-rendered"]) {
      const v = r.headers.get(h);
      if (v) headers[h] = v;
    }
    return new Response(new Uint8Array(r.body), { headers });
  }
  if (r.code === "BAD_PDF") return NextResponse.json({ error: "bad_pdf", message: "That file is not a readable PDF." }, { status: 422 });
  if (r.code === "TOO_LARGE") return NextResponse.json({ error: "too_large", message: "PDFs up to 10 MB and 10 pages only." }, { status: 413 });
  if (r.code === "BAD_REQUEST") return NextResponse.json({ error: "bad_request" }, { status: 400 });
  console.error("[craft] sidecar error", JSON.stringify({ op, status: r.status, code: r.code }));
  return unavailable("craft_failed");
}
