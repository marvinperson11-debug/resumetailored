import { getSiteBySlug } from "@/lib/site-store";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Public personal website: GET /site/<slug> serves the stored, fully-rendered
 * static HTML page. Not under /candidate, so it's public (no auth).
 */
export async function GET(_req: Request, { params }: { params: { slug: string } }) {
  const site = await getSiteBySlug(params.slug);
  if (!site) {
    return new Response("<!doctype html><meta charset=utf-8><title>Not found</title><body style=\"font-family:system-ui;padding:48px;text-align:center;color:#444\"><h1>Site not found</h1><p>This personal website doesn't exist or isn't published.</p></body>", {
      status: 404,
      headers: { "Content-Type": "text/html; charset=utf-8" },
    });
  }
  return new Response(site.html, {
    status: 200,
    headers: { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "public, max-age=60" },
  });
}
