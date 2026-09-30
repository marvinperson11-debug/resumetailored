import { getSiteBySlug, incrementSiteViews } from "@/lib/site-store";
import { resolveAlias } from "@/lib/tenant-resolve";
import { getLocale, getTranslations } from "next-intl/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Minimal HTML escape for translated strings interpolated into the raw 404 page. */
const esc = (v: string) => v.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

/**
 * Public personal website: GET /site/<slug> serves the stored, fully-rendered
 * static HTML page. Not under /candidate, so it's public (no auth).
 */
export async function GET(_req: Request, { params }: { params: { slug: string } }) {
  const site = await getSiteBySlug(params.slug);
  if (!site) {
    // Backstop for the middleware 301: if this is a renamed (old) slug reached
    // directly, permanently redirect to the current /site/<slug>.
    const alias = await resolveAlias((params.slug || "").toLowerCase());
    if (alias && alias.slug !== params.slug) {
      return new Response(null, { status: 301, headers: { Location: `/site/${alias.slug}` } });
    }
    const t = await getTranslations("publicSite");
    const lang = await getLocale();
    return new Response(
      "<!doctype html><html lang=\"" + lang + "\">" +
        "<meta charset=utf-8><meta name=viewport content=\"width=device-width,initial-scale=1\"><title>" + esc(t("notFoundTitle")) + "</title>" +
        "<body style=\"font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;min-height:100vh;margin:0;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:14px;background:#0b0f19;color:#e8e8ea;text-align:center;padding:32px\">" +
        "<h1 style=\"font-size:28px;margin:0\">" + esc(t("notFoundTitle")) + "</h1>" +
        "<p style=\"color:#9aa3af;max-width:36ch;margin:0\">" + esc(t("notFoundBody")) + "</p>" +
        "<a href=\"https://app.resumetailored.com\" style=\"margin-top:8px;background:#8B5CF6;color:#fff;text-decoration:none;padding:10px 18px;border-radius:10px;font-weight:600\">" + esc(t("buildYourOwn")) + "</a>" +
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
