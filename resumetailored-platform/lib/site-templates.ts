/**
 * Personal Website (Web Studio) — pure HTML generator + AI copy prompt. Produces
 * a self-contained, responsive static page (inline CSS, no external deps) from
 * the user's content, in one of four templates. Used for the live preview, the
 * "Download HTML" export, and the published /site/<slug> page.
 *
 * Theme colour, fonts and size scale are driven by CSS custom properties on
 * :root so switching any of them is instant and consistent across the page.
 */

export interface SiteSection {
  title: string;
  items: string[];
}

export interface SiteLinks {
  linkedin?: string;
  github?: string;
  portfolio?: string;
}

export interface SiteTypography {
  heading?: "sans" | "serif" | "mono";
  body?: "sans" | "serif";
  scale?: "compact" | "normal" | "spacious";
}

export interface SiteData {
  name: string;
  headline: string;
  about: string;
  email?: string;
  location?: string;
  photo?: string; // data URL or http(s) URL
  links?: SiteLinks;
  videoUrl?: string; // an https URL to an .mp4 (the user's resume video)
  typography?: SiteTypography;
  sections: SiteSection[];
  template: string; // portfolio | resume | creative | minimal
  theme: string; // hex accent
}

export const SITE_TEMPLATES = [
  { id: "portfolio", label: "Portfolio", desc: "Hero + showcase grid" },
  { id: "resume", label: "Resume", desc: "Classic single column, timeline" },
  { id: "creative", label: "Creative", desc: "Bold color, big type" },
  { id: "minimal", label: "Minimal", desc: "Whitespace, elegant serif" },
];

/** Named preset swatches (label + accent hex). */
export const SITE_THEMES = [
  { id: "#1E3A8A", label: "Navy" },
  { id: "#8B5CF6", label: "Violet" },
  { id: "#14B8A6", label: "Teal" },
  { id: "#C2870B", label: "Gold" },
  { id: "#475569", label: "Slate" },
  { id: "#059669", label: "Emerald" },
  { id: "#E11D48", label: "Rose" },
  { id: "#0F172A", label: "Midnight" },
  { id: "#B08968", label: "Cream" },
];

export const HEADING_FONTS = [
  { id: "sans", label: "Sans-serif" },
  { id: "serif", label: "Serif" },
  { id: "mono", label: "Mono" },
];
export const BODY_FONTS = [
  { id: "sans", label: "Sans-serif" },
  { id: "serif", label: "Serif" },
];
export const SIZE_SCALES = [
  { id: "compact", label: "Compact" },
  { id: "normal", label: "Normal" },
  { id: "spacious", label: "Spacious" },
];

const FONT_STACKS: Record<string, string> = {
  sans: "-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif",
  serif: "Georgia,'Times New Roman',Times,serif",
  mono: "ui-monospace,SFMono-Regular,Menlo,Consolas,'Liberation Mono',monospace",
};
const SCALE_FACTORS: Record<string, number> = { compact: 0.9, normal: 1, spacious: 1.12 };

function esc(s: unknown): string {
  return String(s ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}
/** Only allow http(s) URLs into href/src on a public page. */
function safeUrl(u: unknown): string {
  const s = String(u ?? "").trim();
  return /^https?:\/\//i.test(s) ? s : "";
}
function truncate(s: string, n: number): string {
  const t = String(s || "").replace(/\s+/g, " ").trim();
  return t.length > n ? `${t.slice(0, n - 1)}…` : t;
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
    { "title": "Skills", "items": ["key skills"] },
    { "title": "Projects", "items": ["notable projects, one per line"] }
  ]
}
Use real specifics from the résumé; never invent. 2-4 sections, 3-6 items each. A "Skills" section renders as tags, so keep those items short.

RÉSUMÉ:
${resume.slice(0, 6000)}`,
  };
}

/** Full standalone HTML document for the site. */
export function generateSiteHtml(d: SiteData): string {
  const accent = /^#[0-9a-fA-F]{6}$/.test(d.theme) ? d.theme : "#8B5CF6";
  const tpl = d.template || "portfolio";
  const creative = tpl === "creative";
  const minimal = tpl === "minimal";
  const resume = tpl === "resume";

  const headingFont = FONT_STACKS[d.typography?.heading || (minimal ? "serif" : "sans")] || FONT_STACKS.sans;
  const bodyFont = FONT_STACKS[d.typography?.body || (minimal ? "serif" : "sans")] || FONT_STACKS.sans;
  const scale = SCALE_FACTORS[d.typography?.scale || "normal"] || 1;

  const photo = d.photo ? `<img src="${esc(d.photo)}" alt="${esc(d.name)}" class="avatar"/>` : "";

  // Contact + social links.
  const socials: string[] = [];
  if (d.email) socials.push(`<a href="mailto:${esc(d.email)}">${esc(d.email)}</a>`);
  if (d.location) socials.push(`<span>${esc(d.location)}</span>`);
  const li = safeUrl(d.links?.linkedin), gh = safeUrl(d.links?.github), pf = safeUrl(d.links?.portfolio);
  if (li) socials.push(`<a href="${esc(li)}" target="_blank" rel="noopener">LinkedIn</a>`);
  if (gh) socials.push(`<a href="${esc(gh)}" target="_blank" rel="noopener">GitHub</a>`);
  if (pf) socials.push(`<a href="${esc(pf)}" target="_blank" rel="noopener">Portfolio</a>`);
  const contact = socials.join('<span class="dot">·</span>');

  const video = safeUrl(d.videoUrl)
    ? `<section class="sec video"><h2>Resume Video</h2><video controls preload="metadata" playsinline src="${esc(safeUrl(d.videoUrl))}"></video></section>`
    : "";

  const sections = (d.sections || [])
    .filter((s) => s && s.title && (s.items || []).length)
    .map((s) => {
      const isSkills = /skill|tech|tool|language/i.test(s.title);
      const body = isSkills
        ? `<div class="tags">${s.items.map((i) => `<span class="tag">${esc(i)}</span>`).join("")}</div>`
        : `<ul>${s.items.map((i) => `<li>${esc(i)}</li>`).join("")}</ul>`;
      return `<section class="sec"><h2>${esc(s.title)}</h2>${body}</section>`;
    })
    .join("");

  // Per-template hero styling.
  const heroAlign = creative ? "center" : "left";
  const heroBg = creative
    ? "background:linear-gradient(135deg,var(--accent),#0b0b12);color:#fff;"
    : resume
    ? "background:#fff;color:#111;border-bottom:3px solid var(--accent);"
    : minimal
    ? "background:#fff;color:#111;"
    : "background:#fff;color:#111;border-top:6px solid var(--accent);";
  const maxW = resume || minimal ? "760px" : "980px";
  const nameSize = creative ? "clamp(40px,8vw,74px)" : "clamp(30px,6vw,52px)";

  const title = `${d.name || "Personal Website"}${d.headline ? ` | ${d.headline}` : ""}`;
  const desc = truncate(d.about || d.headline || `${d.name} — personal website`, 155);
  const ogImg = safeUrl(d.photo); // only real URLs make sense as og:image (data URLs are dropped by scrapers)

  return `<!doctype html><html lang="en"><head><meta charset="utf-8"/>
<meta name="viewport" content="width=device-width,initial-scale=1"/>
<title>${esc(title)}</title>
<meta name="description" content="${esc(desc)}"/>
<meta property="og:type" content="website"/>
<meta property="og:title" content="${esc(title)}"/>
<meta property="og:description" content="${esc(desc)}"/>
${ogImg ? `<meta property="og:image" content="${esc(ogImg)}"/>` : ""}
<meta name="twitter:card" content="${ogImg ? "summary_large_image" : "summary"}"/>
<style>
  :root{
    --accent:${accent};
    --heading:${headingFont};
    --body:${bodyFont};
    --scale:${scale};
    --pad:calc(40px * var(--scale));
  }
  *{box-sizing:border-box;margin:0;padding:0}
  body{font-family:var(--body);color:#1a1a1a;background:#f5f6f8;line-height:1.6;font-size:calc(16px * var(--scale))}
  h1,h2,h3{font-family:var(--heading)}
  .wrap{max-width:${maxW};margin:0 auto;background:#fff;min-height:100vh;box-shadow:0 1px 44px rgba(0,0,0,.06)}
  .hero{padding:calc(56px * var(--scale)) var(--pad);${heroBg}text-align:${heroAlign}}
  .avatar{width:${creative ? "128px" : "96px"};height:${creative ? "128px" : "96px"};border-radius:50%;object-fit:cover;${creative ? "border:4px solid rgba(255,255,255,.55);" : "border:3px solid var(--accent);"}margin:${creative ? "0 auto 20px" : "0 0 18px"};display:block}
  .hero h1{font-size:${nameSize};line-height:1.05;letter-spacing:-.02em}
  .hero .tag{font-size:clamp(15px,2.4vw,20px);margin-top:10px;color:${creative ? "rgba(255,255,255,.9)" : "var(--accent)"};font-weight:600}
  .hero .contact{margin-top:16px;font-size:14px;opacity:.85;display:flex;flex-wrap:wrap;gap:2px;${creative ? "justify-content:center;" : ""}}
  .hero .contact a{color:inherit;text-decoration:none;border-bottom:1px solid currentColor}
  .dot{margin:0 8px;opacity:.5}
  .body{padding:var(--pad)}
  .about{font-size:calc(17px * var(--scale));color:#333;max-width:62ch;margin-bottom:calc(36px * var(--scale))}
  .sec{margin-bottom:calc(32px * var(--scale))}
  .sec h2{font-size:12px;text-transform:uppercase;letter-spacing:.15em;color:var(--accent);margin-bottom:12px;font-weight:800}
  .sec ul{list-style:none}
  .sec li{padding:8px 0;border-bottom:1px solid #eee;font-size:calc(15px * var(--scale));color:#333}
  .sec li:before{content:"▸";color:var(--accent);margin-right:10px}
  .tags{display:flex;flex-wrap:wrap;gap:8px}
  .tag{background:color-mix(in srgb,var(--accent) 14%,#fff);color:var(--accent);border:1px solid color-mix(in srgb,var(--accent) 30%,#fff);border-radius:999px;padding:5px 12px;font-size:13px;font-weight:600}
  .video video{width:100%;border-radius:14px;background:#000;display:block;box-shadow:0 6px 30px rgba(0,0,0,.14)}
  ${creative ? ".body{background:#fff}.sec h2{color:var(--accent)}" : ""}
  ${minimal ? ".sec li:before{content:\"—\"}.hero .tag{font-weight:500}" : ""}
  footer{padding:24px var(--pad);text-align:center;font-size:12px;color:#9aa3af;border-top:1px solid #eee}
  footer a{color:var(--accent);text-decoration:none}
  @media(max-width:640px){:root{--pad:24px}.hero{padding:32px 24px}}
</style></head>
<body><div class="wrap">
  <header class="hero">${photo}<h1>${esc(d.name || "Your Name")}</h1>${d.headline ? `<div class="tag">${esc(d.headline)}</div>` : ""}${contact ? `<div class="contact">${contact}</div>` : ""}</header>
  <div class="body">
    ${d.about ? `<p class="about">${esc(d.about)}</p>` : ""}
    ${sections}
    ${video}
  </div>
  <footer>Made with <a href="https://resumetailored.com" target="_blank" rel="noopener">ResumeTailored</a></footer>
</div></body></html>`;
}
