import type { CSSProperties } from "react";
import { useLocale, useTranslations } from "next-intl";
import type { CareerSite, PublicCareerJob } from "@/lib/employer-ai";

/**
 * Presentational careers page — no state or effects, so it renders on the server
 * (the real /careers/:slug page) and inside the builder's client live preview.
 * Text comes from `publicCareers` via next-intl (works in both): the public page
 * follows the VISITOR's language, the builder preview the employer's own.
 * Self-contained light theme with inline styles (the app's global CSS is a dark
 * theme) and the employer's brand color applied via the `--brand` CSS variable.
 * `applyBase` defaults to /jobs — each posting links to the existing public job
 * detail + application flow at /jobs/:id.
 */
const money = (n: number, locale: string) => "$" + Math.round(n).toLocaleString(locale);
function salaryLabel(j: PublicCareerJob, locale: string, upTo: (amount: string) => string): string | null {
  if (j.salaryMin && j.salaryMax) return `${money(j.salaryMin, locale)} – ${money(j.salaryMax, locale)} ${j.salaryCurrency || ""}`.trim();
  if (j.salaryMin) return `${money(j.salaryMin, locale)}+`;
  if (j.salaryMax) return upTo(money(j.salaryMax, locale));
  return null;
}

export function CareerSiteView({
  site,
  jobs,
  applyBase = "/jobs",
  preview = false,
  industry = "",
  bio = "",
  builderUnlocked = true,
  hideBadge = false,
}: {
  site: CareerSite;
  jobs: PublicCareerJob[];
  applyBase?: string;
  preview?: boolean;
  /** Employer company-profile fields (from employer_profiles), surfaced here. */
  industry?: string;
  bio?: string;
  /** False renders the Free-tier "BASIC" career site: company name/logo (still
   *  shown — a name and mark aren't a "builder" feature) + the open-positions
   *  list only. Banner image, About/mission/values, benefits, team,
   *  testimonials, and contact all require the FULL builder (Portal+). The
   *  employer's own live editor preview always passes `true` — what's saved is
   *  never lost, it's just not LIVE until upgrade (see LockedModuleBanner). */
  builderUnlocked?: boolean;
  /** True removes the "Powered by ResumeTailored" footer badge — Corporate
   *  white-label only. */
  hideBadge?: boolean;
}) {
  const t = useTranslations("publicCareers");
  const tj = useTranslations("publicJobs");
  const locale = useLocale();
  const brand = /^#[0-9a-fA-F]{6}$/.test(site.brandColor) ? site.brandColor : "#F59E0B";
  const company = site.companyName || t("company");
  const rootStyle = { ["--brand" as string]: brand } as CSSProperties;
  // The About section shows the company bio (profile) first, then the career-site
  // "about" text — both under one heading, so there's no duplicate "About …".
  const showAboutBlock = !!bio || (site.showAbout && !!site.aboutText);

  return (
    <div style={rootStyle} className="cs-root">
      {/* Banner + header */}
      <header className="cs-header">
        {builderUnlocked && site.bannerUrl ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={site.bannerUrl} alt="" className="cs-banner" />
        ) : (
          <div className="cs-banner cs-banner--fallback" />
        )}
        <div className="cs-headbar">
          <div className="cs-brandrow">
            {site.logoUrl ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={site.logoUrl} alt={t("logoAlt", { company })} className="cs-logo" />
            ) : (
              <span className="cs-logo cs-logo--mono" aria-hidden="true">
                {company.slice(0, 1).toUpperCase()}
              </span>
            )}
            <div className="cs-brandtext">
              <span className="cs-company">{company}</span>
              {industry && <span className="cs-industry">{industry}</span>}
            </div>
          </div>
        </div>
      </header>

      <main className="cs-main">
        <section className="cs-hero">
          <h1 className="cs-h1">{t("h1", { company })}</h1>
          <p className="cs-sub">
            {jobs.length === 0
              ? t("noOpenRoles")
              : t("openRoles", { count: jobs.length })}
          </p>
          <a href="#open-positions" className="cs-cta">
            {t("viewOpen")}
          </a>
        </section>

        {builderUnlocked && (showAboutBlock || (site.showAbout && (site.missionText || site.valuesText))) && (
          <section className="cs-section">
            {showAboutBlock && (
              <div className="cs-block">
                <h2 className="cs-h2">{t("about", { company })}</h2>
                {bio && <p className="cs-body">{bio}</p>}
                {site.showAbout && site.aboutText && <p className="cs-body" style={bio ? { marginTop: 12 } : undefined}>{site.aboutText}</p>}
              </div>
            )}
            {site.showAbout && site.missionText && (
              <div className="cs-block">
                <h2 className="cs-h2">{t("mission")}</h2>
                <p className="cs-body">{site.missionText}</p>
              </div>
            )}
            {site.showAbout && site.valuesText && (
              <div className="cs-block">
                <h2 className="cs-h2">{t("values")}</h2>
                <p className="cs-body">{site.valuesText}</p>
              </div>
            )}
          </section>
        )}

        {builderUnlocked && site.showBenefits && site.benefits.length > 0 && (
          <section className="cs-section">
            <h2 className="cs-h2">{t("benefits")}</h2>
            <ul className="cs-benefits">
              {site.benefits.map((b, i) => (
                <li key={i} className="cs-benefit">
                  <span className="cs-dot" aria-hidden="true" /> {b}
                </li>
              ))}
            </ul>
          </section>
        )}

        {builderUnlocked && site.showTeam && (
          <section className="cs-section">
            <h2 className="cs-h2">{t("team")}</h2>
            <p className="cs-body cs-muted">{t("teamBody")}</p>
          </section>
        )}

        {builderUnlocked && site.showTestimonials && site.testimonials.length > 0 && (
          <section className="cs-section">
            <h2 className="cs-h2">{t("testimonials")}</h2>
            <div className="cs-quotes">
              {site.testimonials.map((tm, i) => (
                <figure key={i} className="cs-quote">
                  <blockquote className="cs-qtext">“{tm.quote}”</blockquote>
                  <figcaption className="cs-qauthor">
                    {tm.author}
                    {tm.role ? <span className="cs-qrole"> · {tm.role}</span> : null}
                  </figcaption>
                </figure>
              ))}
            </div>
          </section>
        )}

        <section id="open-positions" className="cs-section">
          <h2 className="cs-h2">{t("openPositions")}</h2>
          {jobs.length === 0 ? (
            <p className="cs-body cs-muted">{t("noRolesNow")}</p>
          ) : (
            <div className="cs-jobs">
              {jobs.map((j) => {
                const sal = salaryLabel(j, locale, (amount) => t("salaryUpTo", { amount }));
                const href = `${applyBase}/${j.id}`;
                return (
                  <a key={j.id} href={href} className="cs-job" {...(preview ? { onClick: (e) => e.preventDefault() } : {})}>
                    <div className="cs-jobmain">
                      <h3 className="cs-jobtitle">{j.title}</h3>
                      <div className="cs-jobmeta">
                        {j.department && <span>{j.department}</span>}
                        {j.location && <span>{j.location}</span>}
                        {j.remoteType && <span className="cs-tag">{tj(`remoteType.${j.remoteType}`)}</span>}
                        {j.employmentType && <span>{tj(`employmentType.${j.employmentType}`)}</span>}
                        {sal && <span className="cs-sal">{sal}</span>}
                      </div>
                    </div>
                    <span className="cs-apply">{t("apply")}</span>
                  </a>
                );
              })}
            </div>
          )}
        </section>

        {builderUnlocked && site.showContact && site.contactEmail && (
          <section className="cs-section cs-contact">
            <h2 className="cs-h2">{t("getInTouch")}</h2>
            <p className="cs-body">
              {t("questions", { company })}{" "}
              <a href={`mailto:${site.contactEmail}`} className="cs-link">
                {site.contactEmail}
              </a>
            </p>
          </section>
        )}
      </main>

      {!hideBadge && (
        <footer className="cs-footer">
          <span>
            {t("poweredBy")}{" "}
            <a href="https://resumetailored.com" className="cs-link">
              ResumeTailored
            </a>
          </span>
        </footer>
      )}

      <style>{cssText}</style>
    </div>
  );
}

const cssText = `
.cs-root{background:#ffffff;color:#1a1a2e;font-family:system-ui,-apple-system,Segoe UI,sans-serif;line-height:1.55;min-height:100%;}
.cs-header{position:relative;}
.cs-banner{display:block;width:100%;height:220px;object-fit:cover;}
.cs-banner--fallback{background:linear-gradient(120deg,var(--brand),#111827);}
.cs-headbar{max-width:900px;margin:0 auto;padding:0 20px;}
.cs-brandrow{display:flex;align-items:center;gap:12px;margin-top:-32px;position:relative;}
.cs-logo{width:64px;height:64px;border-radius:14px;object-fit:cover;background:#fff;border:3px solid #fff;box-shadow:0 4px 16px rgba(0,0,0,.15);}
.cs-logo--mono{display:flex;align-items:center;justify-content:center;font-size:28px;font-weight:800;color:#fff;background:var(--brand);}
.cs-brandtext{display:flex;flex-direction:column;padding-top:20px;}
.cs-company{font-size:22px;font-weight:700;line-height:1.2;}
.cs-industry{font-size:14px;color:#6b7280;font-weight:500;margin-top:2px;}
.cs-main{max-width:900px;margin:0 auto;padding:24px 20px 8px;}
.cs-hero{padding:24px 0 8px;}
.cs-h1{font-size:34px;font-weight:800;margin:0 0 8px;letter-spacing:-.02em;}
.cs-sub{font-size:17px;color:#4b5563;margin:0 0 18px;}
.cs-cta{display:inline-block;background:var(--brand);color:#fff;font-weight:700;font-size:15px;padding:11px 20px;border-radius:10px;text-decoration:none;}
.cs-cta:hover{filter:brightness(.94);}
.cs-section{padding:26px 0;border-top:1px solid #ececf1;}
.cs-block + .cs-block{margin-top:18px;}
.cs-h2{font-size:22px;font-weight:700;margin:0 0 10px;display:inline-block;border-bottom:3px solid var(--brand);padding-bottom:4px;}
.cs-body{font-size:16px;color:#374151;margin:0;white-space:pre-wrap;}
.cs-muted{color:#6b7280;}
.cs-benefits{list-style:none;padding:0;margin:6px 0 0;display:grid;grid-template-columns:repeat(auto-fill,minmax(240px,1fr));gap:10px;}
.cs-benefit{display:flex;align-items:center;gap:10px;font-size:15px;color:#374151;background:#f7f7fb;border:1px solid #ececf1;border-radius:10px;padding:12px 14px;}
.cs-dot{width:8px;height:8px;border-radius:50%;background:var(--brand);flex:0 0 auto;}
.cs-quotes{display:grid;grid-template-columns:repeat(auto-fill,minmax(280px,1fr));gap:14px;margin-top:6px;}
.cs-quote{margin:0;background:#f7f7fb;border:1px solid #ececf1;border-left:4px solid var(--brand);border-radius:10px;padding:16px 18px;}
.cs-qtext{margin:0 0 10px;font-size:15px;color:#1f2937;font-style:italic;}
.cs-qauthor{font-size:14px;font-weight:700;color:#111827;}
.cs-qrole{font-weight:400;color:#6b7280;}
.cs-jobs{display:flex;flex-direction:column;gap:10px;margin-top:6px;}
.cs-job{display:flex;align-items:center;justify-content:space-between;gap:16px;text-decoration:none;color:inherit;border:1px solid #e5e7eb;border-radius:12px;padding:16px 18px;transition:border-color .15s,box-shadow .15s,transform .15s;}
.cs-job:hover{border-color:var(--brand);box-shadow:0 4px 16px rgba(0,0,0,.06);transform:translateY(-1px);}
.cs-jobtitle{margin:0 0 6px;font-size:18px;font-weight:700;}
.cs-jobmeta{display:flex;flex-wrap:wrap;gap:8px 14px;font-size:13px;color:#6b7280;}
.cs-tag{background:color-mix(in srgb,var(--brand) 16%,#fff);color:#374151;border-radius:6px;padding:1px 8px;}
.cs-sal{color:#059669;font-weight:600;}
.cs-apply{color:var(--brand);font-weight:700;font-size:15px;white-space:nowrap;}
.cs-contact{border-bottom:1px solid #ececf1;}
.cs-link{color:var(--brand);font-weight:600;text-decoration:none;}
.cs-link:hover{text-decoration:underline;}
.cs-footer{max-width:900px;margin:0 auto;padding:24px 20px 40px;text-align:center;color:#9ca3af;font-size:13px;}
@media(max-width:600px){.cs-banner{height:150px;}.cs-h1{font-size:27px;}.cs-job{flex-direction:column;align-items:flex-start;gap:8px;}}
`;
