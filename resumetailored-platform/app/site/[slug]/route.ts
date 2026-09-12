import { getSiteBySlug, incrementSiteViews } from "@/lib/site-store";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Public personal website: GET /site/<slug> serves the stored, fully-rendered
 * static HTML page. Not under /candidate, so it's public (no auth).
 */
export async function GET(_req: Request, { params }: { params: { slug: string } }) {
  const site = await getSiteBySlug(params.slug);
  if (!site) {
    return new Response(
      "<!doctype html><html lang=en><meta charset=utf-8><meta name=viewport content=\"width=device-width,initial-scale=1\"><title>Site not found</title>" +
        "<body style=\"font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;min-height:100vh;margin:0;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:14px;background:#0b0f19;color:#e8e8ea;text-align:center;padding:32px\">" +
        "<h1 style=\"font-size:28px;margin:0\">Site not found</h1>" +
        "<p style=\"color:#9aa3af;max-width:36ch;margin:0\">This personal website doesn&rsquo;t exist or isn&rsquo;t published.</p>" +
        "<a href=\"https://app.resumetailored.com\" style=\"margin-top:8px;background:#8B5CF6;color:#fff;text-decoration:none;padding:10px 18px;border-radius:10px;font-weight:600\">Build your own &rarr;</a>" +
        "</body></html>",
      { status: 404, headers: { "Content-Type": "text/html; charset=utf-8" } }
    );
  }
  // Count the visit (best-effort, non-blocking).
  incrementSiteViews(params.slug).catch(() => {});
  return new Response(site.html, {
    status: 200,
    headers: { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "public, max-age=60" },
  });
}
