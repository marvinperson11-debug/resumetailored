import Link from "next/link";
import { getTranslations } from "next-intl/server";

/** Friendly 404 for an unknown career-site slug/subdomain. Deliberately generic
 *  — it never reveals whether any other slug exists. Returns a 404 status
 *  because it's rendered via notFound(). Public/unauthenticated, so locale
 *  comes from the cookie/Accept-Language resolution in i18n/request.ts same
 *  as any other anonymous visitor — no account required. */
export default async function CareerNotFound() {
  const t = await getTranslations("careersNotFound");
  return (
    <div style={{ minHeight: "100vh", background: "#ffffff", display: "flex", alignItems: "center", justifyContent: "center", padding: "24px" }}>
      <div style={{ maxWidth: 460, textAlign: "center", fontFamily: "system-ui,-apple-system,Segoe UI,sans-serif", color: "#1a1a2e" }}>
        <div
          style={{
            width: 56,
            height: 56,
            margin: "0 auto 18px",
            borderRadius: 14,
            background: "#f7f7fb",
            border: "1px solid #ececf1",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            fontSize: 26,
          }}
          aria-hidden="true"
        >
          🔍
        </div>
        <h1 style={{ fontSize: 26, fontWeight: 800, margin: "0 0 8px", letterSpacing: "-0.02em" }}>{t("title")}</h1>
        <p style={{ fontSize: 16, color: "#4b5563", margin: "0 0 20px", lineHeight: 1.55 }}>{t("body")}</p>
        <Link
          href="/jobs"
          style={{ display: "inline-block", background: "#1a1a2e", color: "#fff", fontWeight: 700, fontSize: 15, padding: "11px 20px", borderRadius: 10, textDecoration: "none" }}
        >
          {t("browseAllJobs")}
        </Link>
      </div>
    </div>
  );
}
