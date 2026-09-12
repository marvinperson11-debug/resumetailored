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

export type BgPattern = "solid" | "dots" | "lines" | "mesh";

export interface SiteSeo {
  title?: string;
  description?: string;
  ogImage?: string; // http(s) URL
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
  template: string; // portfolio | resume | creative | minimal | executive | developer | designer | startup
  theme: string; // hex accent
  // Feature A — extra customization:
  bgPattern?: BgPattern;
  animate?: boolean; // subtle fade-in on scroll
  favicon?: string; // small data URL / http(s) URL
  googleHeadingFont?: string; // a Google Font family name for headings
  googleBodyFont?: string; // a Google Font family name for body
  customCss?: string; // advanced: appended verbatim (scoped caveats apply)
  seo?: SiteSeo;
}

export const SITE_TEMPLATES = [
  { id: "portfolio", label: "Portfolio", desc: "Hero + showcase grid" },
  { id: "resume", label: "Resume", desc: "Classic single column, timeline" },
  { id: "creative", label: "Creative", desc: "Bold color, big type" },
  { id: "minimal", label: "Minimal", desc: "Whitespace, elegant serif" },
  { id: "executive", label: "Executive", desc: "Dark, premium, gold accents" },
  { id: "developer", label: "Developer", desc: "Terminal, monospace, code-themed" },
  { id: "designer", label: "Designer", desc: "Visual grid, project-focused" },
  { id: "startup", label: "Startup", desc: "Bold, metric-driven, growth" },
];

export const BG_PATTERNS: { id: BgPattern; label: string }[] = [
  { id: "solid", label: "Solid" },
  { id: "dots", label: "Subtle dots" },
  { id: "lines", label: "Subtle lines" },
  { id: "mesh", label: "Gradient mesh" },
];

/** A small, safe curated set of Google Fonts for the heading/body pickers. */
export const GOOGLE_FONTS = [
  "Inter", "Poppins", "Montserrat", "Roboto", "Open Sans", "Lato", "Work Sans",
  "Playfair Display", "Merriweather", "Lora", "Source Serif 4",
  "Space Grotesk", "DM Sans", "Manrope", "JetBrains Mono", "Fira Code",
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

const GF_NAME_RE = /^[A-Za-z0-9 ]{2,40}$/;
/** Build the Google Fonts <link> + CSS family for a picked font (safe-listed). */
function googleFont(name: string | undefined): { link: string; family: string } | null {
  if (!name || !GF_NAME_RE.test(name) || !GOOGLE_FONTS.includes(name)) return null;
  const q = name.replace(/ /g, "+");
  return { link: `https://fonts.googleapis.com/css2?family=${q}:wght@400;600;800&display=swap`, family: `'${name}'` };
}

/** Full standalone HTML document for the site. */
export function generateSiteHtml(d: SiteData): string {
  const accent = /^#[0-9a-fA-F]{6}$/.test(d.theme) ? d.theme : "#8B5CF6";
  const tpl = d.template || "portfolio";
  const creative = tpl === "creative";
  const minimal = tpl === "minimal";
  const resume = tpl === "resume";
  const executive = tpl === "executive";
  const developer = tpl === "developer";
  const designer = tpl === "designer";
  const startup = tpl === "startup";
  const dark = executive || developer;

  // Fonts: a picked Google Font wins over the sans/serif/mono base.
  const gHead = googleFont(d.googleHeadingFont);
  const gBody = googleFont(d.googleBodyFont);
  const baseHeading = FONT_STACKS[d.typography?.heading || (minimal ? "serif" : developer ? "mono" : "sans")] || FONT_STACKS.sans;
  const baseBody = FONT_STACKS[d.typography?.body || (minimal ? "serif" : developer ? "mono" : "sans")] || FONT_STACKS.sans;
  const headingFont = gHead ? `${gHead.family},${baseHeading}` : baseHeading;
  const bodyFont = gBody ? `${gBody.family},${baseBody}` : baseBody;
  const fontLinks = [gHead?.link, gBody?.link].filter((v, i, a) => v && a.indexOf(v) === i).map((h) => `<link href="${esc(h!)}" rel="stylesheet"/>`).join("");
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

  // Palette: light by default; dark for executive/developer.
  const pageBg = dark ? (developer ? "#0d1117" : "#0b0d12") : "#f5f6f8";
  const wrapBg = dark ? (developer ? "#0d1117" : "#0f1218") : "#fff";
  const ink = dark ? "#e8eaed" : "#1a1a1a";
  const muted = dark ? "#aab1bd" : "#333";
  const hairline = dark ? "rgba(255,255,255,.10)" : "#eee";

  // Per-template hero styling.
  const heroAlign = creative || startup ? "center" : "left";
  const heroBg = creative
    ? "background:linear-gradient(135deg,var(--accent),#0b0b12);color:#fff;"
    : startup
    ? "background:radial-gradient(120% 120% at 50% 0%,color-mix(in srgb,var(--accent) 22%,#fff),#fff);color:#111;"
    : executive
    ? "background:linear-gradient(180deg,#14171f,#0b0d12);color:#fff;border-bottom:2px solid var(--accent);"
    : developer
    ? "background:#161b22;color:#e8eaed;border-bottom:1px solid rgba(255,255,255,.1);"
    : designer
    ? "background:#fff;color:#111;border-bottom:1px solid #eee;"
    : resume
    ? "background:#fff;color:#111;border-bottom:3px solid var(--accent);"
    : minimal
    ? "background:#fff;color:#111;"
    : "background:#fff;color:#111;border-top:6px solid var(--accent);";
  const maxW = resume || minimal ? "760px" : designer || startup ? "1040px" : "980px";
  const nameSize = creative || startup ? "clamp(40px,8vw,74px)" : "clamp(30px,6vw,52px)";

  // Background pattern (applied to the page behind the wrap).
  const pattern = d.bgPattern || "solid";
  const patternCss =
    pattern === "dots"
      ? `background-color:${pageBg};background-image:radial-gradient(${dark ? "rgba(255,255,255,.06)" : "rgba(0,0,0,.06)"} 1px,transparent 1px);background-size:18px 18px;`
      : pattern === "lines"
      ? `background-color:${pageBg};background-image:repeating-linear-gradient(45deg,${dark ? "rgba(255,255,255,.04)" : "rgba(0,0,0,.04)"} 0 1px,transparent 1px 12px);`
      : pattern === "mesh"
      ? `background-color:${pageBg};background-image:radial-gradient(40% 40% at 15% 15%,color-mix(in srgb,var(--accent) 22%,transparent),transparent),radial-gradient(40% 40% at 85% 25%,color-mix(in srgb,var(--accent) 16%,transparent),transparent),radial-gradient(45% 45% at 60% 90%,color-mix(in srgb,var(--accent) 14%,transparent),transparent);`
      : `background-color:${pageBg};`;

  const title = d.seo?.title || `${d.name || "Personal Website"}${d.headline ? ` | ${d.headline}` : ""}`;
  const desc = truncate(d.seo?.description || d.about || d.headline || `${d.name} — personal website`, 155);
  const ogImg = safeUrl(d.seo?.ogImage) || safeUrl(d.photo); // data URLs are dropped by scrapers
  const favicon = d.favicon ? `<link rel="icon" href="${esc(d.favicon)}"/>` : "";

  // Developer-template chrome: a fake terminal bar above the hero name.
  const devPrompt = developer ? `<div class="devbar"><span></span><span></span><span></span><code>~/${esc((d.name || "me").toLowerCase().replace(/\s+/g, "-"))} $</code></div>` : "";

  const customCss = (d.customCss || "").replace(/<\/style>/gi, "");
  const reveal = d.animate ? " reveal" : "";

  return `<!doctype html><html lang="en"><head><meta charset="utf-8"/>
<meta name="viewport" content="width=device-width,initial-scale=1"/>
<title>${esc(title)}</title>
<meta name="description" content="${esc(desc)}"/>
<meta property="og:type" content="website"/>
<meta property="og:title" content="${esc(title)}"/>
<meta property="og:description" content="${esc(desc)}"/>
${ogImg ? `<meta property="og:image" content="${esc(ogImg)}"/>` : ""}
<meta name="twitter:card" content="${ogImg ? "summary_large_image" : "summary"}"/>
${favicon}
${fontLinks}
<style>
  :root{
    --accent:${accent};
    --heading:${headingFont};
    --body:${bodyFont};
    --scale:${scale};
    --pad:calc(40px * var(--scale));
    --ink:${ink};
    --muted:${muted};
    --line:${hairline};
  }
  *{box-sizing:border-box;margin:0;padding:0}
  body{font-family:var(--body);color:var(--ink);${patternCss}line-height:1.6;font-size:calc(16px * var(--scale))}
  h1,h2,h3{font-family:var(--heading)}
  .wrap{max-width:${maxW};margin:0 auto;background:${wrapBg};min-height:100vh;box-shadow:0 1px 44px rgba(0,0,0,${dark ? ".4" : ".06"})}
  .hero{padding:calc(56px * var(--scale)) var(--pad);${heroBg}text-align:${heroAlign}}
  .devbar{display:flex;align-items:center;gap:6px;margin-bottom:16px;font-family:${FONT_STACKS.mono};font-size:12px;color:#8b98a5}
  .devbar span{width:10px;height:10px;border-radius:50%;background:#ff5f56}.devbar span:nth-child(2){background:#ffbd2e}.devbar span:nth-child(3){background:#27c93f}
  .devbar code{margin-left:8px}
  .avatar{width:${creative || startup ? "128px" : "96px"};height:${creative || startup ? "128px" : "96px"};border-radius:${designer ? "16px" : "50%"};object-fit:cover;border:${creative ? "4px solid rgba(255,255,255,.55)" : "3px solid var(--accent)"};margin:${creative || startup ? "0 auto 20px" : "0 0 18px"};display:block}
  .hero h1{font-size:${nameSize};line-height:1.05;letter-spacing:-.02em}
  .hero .tag{font-size:clamp(15px,2.4vw,20px);margin-top:10px;color:${creative || executive || developer ? "rgba(255,255,255,.9)" : "var(--accent)"};font-weight:600}
  .hero .contact{margin-top:16px;font-size:14px;opacity:.85;display:flex;flex-wrap:wrap;gap:2px;${creative || startup ? "justify-content:center;" : ""}}
  .hero .contact a{color:inherit;text-decoration:none;border-bottom:1px solid currentColor}
  .dot{margin:0 8px;opacity:.5}
  .body{padding:var(--pad)}
  .about{font-size:calc(17px * var(--scale));color:var(--muted);max-width:62ch;${startup ? "margin:0 auto calc(36px * var(--scale));text-align:center;" : "margin-bottom:calc(36px * var(--scale));"}}
  .sec{margin-bottom:calc(32px * var(--scale))}
  .sec h2{font-size:12px;text-transform:uppercase;letter-spacing:.15em;color:var(--accent);margin-bottom:12px;font-weight:800}
  .sec ul{list-style:none}
  .sec li{padding:8px 0;border-bottom:1px solid var(--line);font-size:calc(15px * var(--scale));color:var(--muted)}
  .sec li:before{content:"▸";color:var(--accent);margin-right:10px}
  .tags{display:flex;flex-wrap:wrap;gap:8px${startup ? ";justify-content:center" : ""}}
  .tag{background:color-mix(in srgb,var(--accent) ${dark ? "22%,#0b0d12" : "14%,#fff"});color:var(--accent);border:1px solid color-mix(in srgb,var(--accent) 30%,transparent);border-radius:999px;padding:5px 12px;font-size:13px;font-weight:600}
  .video video{width:100%;border-radius:14px;background:#000;display:block;box-shadow:0 6px 30px rgba(0,0,0,.14)}
  ${minimal ? '.sec li:before{content:"—"}.hero .tag{font-weight:500}' : ""}
  ${designer ? ".body{display:grid;grid-template-columns:1fr 1fr;gap:calc(28px * var(--scale))}.about{grid-column:1/-1}.sec{background:#faf9fb;border:1px solid #eee;border-radius:16px;padding:20px}@media(max-width:720px){.body{grid-template-columns:1fr}}" : ""}
  ${startup ? ".sec{text-align:center;border:1px solid var(--line);border-radius:16px;padding:24px;background:color-mix(in srgb,var(--accent) 5%,#fff)}.sec li{border:0;font-weight:600}.sec li:before{content:''}" : ""}
  ${developer ? ".sec{border:1px solid rgba(255,255,255,.1);border-radius:10px;overflow:hidden}.sec h2{background:#161b22;margin:0;padding:8px 12px;color:#7ee787}.sec ul,.sec .tags{padding:12px}.sec li{border-color:rgba(255,255,255,.08)}" : ""}
  ${executive ? ".sec h2{color:var(--accent)}.sec li{color:#c9cdd6}" : ""}
  ${d.animate ? ".reveal{opacity:0;transform:translateY(16px);transition:opacity .6s ease,transform .6s ease}.reveal.in{opacity:1;transform:none}" : ""}
  footer{padding:24px var(--pad);text-align:center;font-size:12px;color:${dark ? "#7d8590" : "#9aa3af"};border-top:1px solid var(--line)}
  footer a{color:var(--accent);text-decoration:none}
  @media(max-width:640px){:root{--pad:24px}.hero{padding:32px 24px}}
  ${customCss ? `\n/* custom */\n${customCss}` : ""}
</style></head>
<body><div class="wrap">
  <header class="hero${reveal}">${devPrompt}${photo}<h1>${esc(d.name || "Your Name")}</h1>${d.headline ? `<div class="tag">${esc(d.headline)}</div>` : ""}${contact ? `<div class="contact">${contact}</div>` : ""}</header>
  <div class="body">
    ${d.about ? `<p class="about${reveal}">${esc(d.about)}</p>` : ""}
    ${d.animate ? sections.replace(/class="sec"/g, 'class="sec reveal"') : sections}
    ${d.animate ? video.replace(/class="sec video"/, 'class="sec video reveal"') : video}
  </div>
  <footer>Made with <a href="https://resumetailored.com" target="_blank" rel="noopener">ResumeTailored</a></footer>
</div>${d.animate ? `<script>(function(){var o=new IntersectionObserver(function(es){es.forEach(function(e){if(e.isIntersecting){e.target.classList.add('in');o.unobserve(e.target)}})},{threshold:.12});document.querySelectorAll('.reveal').forEach(function(el){o.observe(el)})})();</script>` : ""}</body></html>`;
}
