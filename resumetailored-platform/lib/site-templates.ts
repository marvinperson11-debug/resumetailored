/**
 * Personal Website (Web Studio) — pure HTML generator + AI copy prompt. Produces
 * a self-contained, responsive static page (inline CSS, no external deps) from
 * the user's content, in one of four templates. Used for the live preview, the
 * "Download HTML" export, and the published /site/<slug> page.
 */

export interface SiteSection {
  title: string;
  items: string[];
}
export interface SiteData {
  name: string;
  headline: string;
  about: string;
  email?: string;
  location?: string;
  photo?: string; // data URL or http(s) URL
  sections: SiteSection[];
  template: string; // portfolio | resume | creative | minimal
  theme: string; // hex accent
}

export const SITE_TEMPLATES = [
  { id: "portfolio", label: "Portfolio", desc: "Hero + showcase sections" },
  { id: "resume", label: "Resume", desc: "Classic single-column résumé" },
  { id: "creative", label: "Creative", desc: "Bold color, big type" },
  { id: "minimal", label: "Minimal", desc: "Quiet, typographic" },
];

export const SITE_THEMES = [
  { id: "#8B5CF6", label: "Violet" },
  { id: "#14B8A6", label: "Teal" },
  { id: "#2563eb", label: "Blue" },
  { id: "#e11d48", label: "Rose" },
  { id: "#b45309", label: "Amber" },
  { id: "#111827", label: "Ink" },
];

function esc(s: unknown): string {
  return String(s ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

export function buildSiteCopyPrompt(resume: string): { system: string; user: string } {
  return {
    system:
      "You write concise, warm, first-person personal-website copy from a résumé. Output ONLY valid JSON, no markdown.",
    user: `From the résumé below, produce personal-website copy as JSON:
{
  "name": "the person's name",
  "headline": "a punchy one-line tagline (role + value, under 12 words)",
  "about": "3-4 sentence first-person About section — specific, human, no buzzwords",
  "sections": [
    { "title": "Experience", "items": ["one line per notable role/achievement"] },
    { "title": "Skills", "items": ["key skills"] }
  ]
}
Use real specifics from the résumé; never invent. 2-4 sections, 3-6 items each.

RÉSUMÉ:
${resume.slice(0, 6000)}`,
  };
}

/** Full standalone HTML document for the site. */
export function generateSiteHtml(d: SiteData): string {
  const accent = /^#[0-9a-fA-F]{6}$/.test(d.theme) ? d.theme : "#8B5CF6";
  const tpl = d.template || "portfolio";
  const photo = d.photo
    ? `<img src="${esc(d.photo)}" alt="${esc(d.name)}" class="avatar"/>`
    : "";
  const contact = [d.email && `<a href="mailto:${esc(d.email)}">${esc(d.email)}</a>`, d.location && `<span>${esc(d.location)}</span>`]
    .filter(Boolean)
    .join('<span class="dot">·</span>');
  const sections = (d.sections || [])
    .filter((s) => s && s.title && (s.items || []).length)
    .map(
      (s) => `<section class="sec"><h2>${esc(s.title)}</h2><ul>${s.items.map((i) => `<li>${esc(i)}</li>`).join("")}</ul></section>`
    )
    .join("");

  // Per-template body layout.
  const creative = tpl === "creative";
  const minimal = tpl === "minimal";
  const heroAlign = creative ? "center" : "left";
  const heroBg = creative
    ? `background:linear-gradient(135deg,${accent},#000);color:#fff;`
    : minimal
    ? "background:#fff;color:#111;"
    : `background:#fff;color:#111;border-bottom:4px solid ${accent};`;
  const nameSize = creative ? "clamp(40px,8vw,72px)" : "clamp(30px,6vw,52px)";
  const maxW = tpl === "resume" || minimal ? "720px" : "960px";

  return `<!doctype html><html lang="en"><head><meta charset="utf-8"/>
<meta name="viewport" content="width=device-width,initial-scale=1"/>
<title>${esc(d.name)} — ${esc(d.headline)}</title>
<meta name="description" content="${esc(d.headline)}"/>
<style>
  *{box-sizing:border-box;margin:0;padding:0}
  body{font-family:${minimal ? "'Georgia',serif" : "-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif"};color:#1a1a1a;background:#f6f7f9;line-height:1.6}
  .wrap{max-width:${maxW};margin:0 auto;background:#fff;min-height:100vh;box-shadow:0 1px 40px rgba(0,0,0,.06)}
  .hero{padding:${creative ? "72px 40px" : "56px 40px"};${heroBg};text-align:${heroAlign}}
  .avatar{width:${creative ? "120px" : "96px"};height:${creative ? "120px" : "96px"};border-radius:50%;object-fit:cover;${creative ? "border:4px solid rgba(255,255,255,.5);" : `border:3px solid ${accent};`}margin:${creative ? "0 auto 20px" : "0 0 18px"};display:block}
  .hero h1{font-size:${nameSize};line-height:1.05;letter-spacing:-.02em}
  .hero .tag{font-size:clamp(15px,2.4vw,20px);margin-top:10px;color:${creative ? "rgba(255,255,255,.9)" : accent};font-weight:600}
  .hero .contact{margin-top:16px;font-size:14px;opacity:.8}
  .hero .contact a{color:inherit;text-decoration:none;border-bottom:1px solid currentColor}
  .dot{margin:0 8px;opacity:.5}
  .body{padding:40px}
  .about{font-size:17px;color:#333;max-width:62ch;margin-bottom:36px}
  .sec{margin-bottom:32px}
  .sec h2{font-size:12px;text-transform:uppercase;letter-spacing:.15em;color:${accent};margin-bottom:12px;font-weight:800}
  .sec ul{list-style:none}
  .sec li{padding:8px 0;border-bottom:1px solid #eee;font-size:15px;color:#333}
  .sec li:before{content:"▸";color:${accent};margin-right:10px}
  footer{padding:24px 40px;text-align:center;font-size:12px;color:#9aa3af;border-top:1px solid #eee}
  @media(max-width:640px){.hero,.body{padding:32px 20px}}
</style></head>
<body><div class="wrap">
  <header class="hero">${photo}<h1>${esc(d.name)}</h1><div class="tag">${esc(d.headline)}</div>${contact ? `<div class="contact">${contact}</div>` : ""}</header>
  <div class="body">
    ${d.about ? `<p class="about">${esc(d.about)}</p>` : ""}
    ${sections}
  </div>
  <footer>Made with ResumeTailored · resumetailored.com</footer>
</div></body></html>`;
}
