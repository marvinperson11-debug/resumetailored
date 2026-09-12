/**
 * Web Studio v2 — the data model for the full-screen WYSIWYG website builder.
 *
 * A site is a list of stacked SECTIONS; each section has a background + padding
 * + layout and a flat list of ELEMENTS (heading / text / image / video / button
 * / divider / spacer / social / resume-download). Everything the editor and the
 * public page need lives in this one JSON structure (`StudioSite`), which is what
 * gets stored in the `personal_sites.data` column.
 *
 * This module is PURE (no React, no DOM, no network) so it can be shared by the
 * React editor canvas AND the server-side string renderer (`studio-render.ts`).
 * The style helpers below return plain camelCase style maps that React can use
 * directly and the string renderer converts to inline CSS via `styleToCss`.
 */

// ── Types ────────────────────────────────────────────────────────────────────

export type SectionType =
  | "hero" | "about" | "experience" | "education" | "skills"
  | "projects" | "gallery" | "testimonials" | "contact" | "video" | "custom";

export type ElementType =
  | "heading" | "text" | "image" | "video" | "button"
  | "divider" | "spacer" | "social" | "resume-download";

export type BgType = "solid" | "gradient" | "pattern" | "image" | "video";
export type SectionLayout = "full" | "contained" | "split";

export interface SectionBackground {
  type: BgType;
  /** color hex, gradient CSS, pattern name (dots|lines|grid|mesh), or a URL. */
  value: string;
}

export type StyleMap = Record<string, string>;

export interface StudioElement {
  id: string;
  type: ElementType;
  content: string; // text/HTML, an image/video URL, or a button label
  styles: StyleMap; // fontSize, color, textAlign, … (CSS-ready string values)
  props: Record<string, string | number | boolean>; // alt, url, level, autoplay, …
}

export interface StudioSection {
  id: string;
  type: SectionType;
  name: string;
  visible: boolean;
  background: SectionBackground;
  padding: { top: number; bottom: number };
  layout: SectionLayout;
  elements: StudioElement[];
}

export interface StudioTheme {
  primaryColor: string;
  secondaryColor: string;
  textColor: string;
  bgColor: string;
  headingFont: string; // a name from FONT_CHOICES
  bodyFont: string; // a name from FONT_CHOICES
}

export interface StudioSite {
  version: 2;
  templateId: string;
  title: string; // <title> + og:title
  metaDescription: string;
  ogImageUrl?: string;
  faviconUrl?: string;
  theme: StudioTheme;
  sections: StudioSection[];
  customCss?: string;
  animate?: boolean; // fade-in on scroll
}

/** A stored personal site can hold either the legacy flat SiteData or a v2
 *  StudioSite. This guard lets the renderer/routes tell them apart. */
export function isStudioSite(v: unknown): v is StudioSite {
  return (
    !!v && typeof v === "object" &&
    (v as { version?: number }).version === 2 &&
    Array.isArray((v as { sections?: unknown }).sections)
  );
}

// ── Ids ──────────────────────────────────────────────────────────────────────

let _seq = 0;
export function newId(prefix = "el"): string {
  _seq += 1;
  return `${prefix}_${Date.now().toString(36)}${(_seq).toString(36)}${Math.random().toString(36).slice(2, 6)}`;
}

// ── Fonts ──────────────────────────────────────────────────────────────────────

/** Curated Google-font + system choices for the heading/body pickers. The value
 *  is the CSS family; the ones flagged `google` load a <link> on the page. */
export const FONT_CHOICES: { name: string; stack: string; google: boolean }[] = [
  { name: "System Sans", stack: "-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif", google: false },
  { name: "System Serif", stack: "Georgia,'Times New Roman',Times,serif", google: false },
  { name: "System Mono", stack: "ui-monospace,SFMono-Regular,Menlo,Consolas,monospace", google: false },
  { name: "Inter", stack: "'Inter',sans-serif", google: true },
  { name: "Poppins", stack: "'Poppins',sans-serif", google: true },
  { name: "Montserrat", stack: "'Montserrat',sans-serif", google: true },
  { name: "Work Sans", stack: "'Work Sans',sans-serif", google: true },
  { name: "DM Sans", stack: "'DM Sans',sans-serif", google: true },
  { name: "Manrope", stack: "'Manrope',sans-serif", google: true },
  { name: "Space Grotesk", stack: "'Space Grotesk',sans-serif", google: true },
  { name: "Playfair Display", stack: "'Playfair Display',Georgia,serif", google: true },
  { name: "Lora", stack: "'Lora',Georgia,serif", google: true },
  { name: "Merriweather", stack: "'Merriweather',Georgia,serif", google: true },
  { name: "JetBrains Mono", stack: "'JetBrains Mono',ui-monospace,monospace", google: true },
];

export function fontStack(name: string | undefined): string {
  const f = FONT_CHOICES.find((x) => x.name === name);
  return f ? f.stack : FONT_CHOICES[0].stack;
}

/** The Google-font <link> URLs needed for the two picked families (deduped). */
export function googleFontLinks(theme: StudioTheme): string[] {
  const names = [theme.headingFont, theme.bodyFont];
  const links: string[] = [];
  for (const n of names) {
    const f = FONT_CHOICES.find((x) => x.name === n);
    if (f && f.google) {
      const q = n.replace(/ /g, "+");
      const url = `https://fonts.googleapis.com/css2?family=${q}:wght@400;500;600;700;800&display=swap`;
      if (!links.includes(url)) links.push(url);
    }
  }
  return links;
}

// ── Safety helpers (shared by canvas + renderer) ───────────────────────────────

export function escapeHtml(s: unknown): string {
  return String(s ?? "")
    .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;").replace(/'/g, "&#39;");
}

/** Allow only http(s), mailto and data: image URLs onto a public page. */
export function safeUrl(u: unknown): string {
  const s = String(u ?? "").trim();
  if (/^https?:\/\//i.test(s)) return s;
  if (/^mailto:/i.test(s)) return s;
  if (/^data:image\//i.test(s)) return s;
  return "";
}

/**
 * Sanitize a small set of inline formatting tags produced by the inline editor
 * (contentEditable + execCommand): b/strong, i/em, u, a[href], br, and span.
 * Everything else is stripped, so stored rich text can't smuggle scripts onto
 * the public page. Anchors are limited to safe URLs and forced to noopener.
 */
export function sanitizeRichText(html: string): string {
  const allowed = /^(b|strong|i|em|u|br|span|a|ul|ol|li)$/i;
  // Drop any tag that isn't in the allow-list; rebuild allowed tags cleanly.
  let out = "";
  const re = /<\/?([a-z0-9]+)([^>]*)>|([^<]+)/gi;
  let m: RegExpExecArray | null;
  while ((m = re.exec(html))) {
    if (m[3] != null) {
      // text node — already-escaped entities pass through; raw < > can't appear here.
      out += m[3];
      continue;
    }
    const tag = (m[1] || "").toLowerCase();
    const closing = m[0].startsWith("</");
    if (!allowed.test(tag)) continue;
    if (tag === "br") { out += "<br/>"; continue; }
    if (closing) { out += `</${tag}>`; continue; }
    if (tag === "a") {
      const hrefMatch = /href\s*=\s*"([^"]*)"|href\s*=\s*'([^']*)'/i.exec(m[2] || "");
      const href = safeUrl(hrefMatch ? hrefMatch[1] || hrefMatch[2] : "");
      out += href ? `<a href="${escapeHtml(href)}" target="_blank" rel="noopener noreferrer">` : "<span>";
      continue;
    }
    out += `<${tag}>`;
  }
  return out;
}

// ── Style computation (shared) ─────────────────────────────────────────────────

/** camelCase style map → inline CSS string, for the HTML renderer. */
export function styleToCss(s: StyleMap): string {
  return Object.entries(s)
    .filter(([, v]) => v !== "" && v != null)
    .map(([k, v]) => `${k.replace(/[A-Z]/g, (c) => `-${c.toLowerCase()}`)}:${v}`)
    .join(";");
}

/** CSS custom properties for the theme, set on the page root. */
export function themeVars(theme: StudioTheme): StyleMap {
  return {
    "--primary": theme.primaryColor,
    "--secondary": theme.secondaryColor,
    "--ink": theme.textColor,
    "--bg": theme.bgColor,
    "--heading-font": fontStack(theme.headingFont),
    "--body-font": fontStack(theme.bodyFont),
  };
}

/** A section's background as a style map (+ an optional bg-video URL to layer). */
export function sectionBgStyle(bg: SectionBackground): { style: StyleMap; videoUrl?: string } {
  const style: StyleMap = {};
  switch (bg.type) {
    case "solid":
      style.background = /^#|rgb|hsl|var\(/.test(bg.value) ? bg.value : bg.value || "transparent";
      break;
    case "gradient":
      style.backgroundImage = bg.value || "linear-gradient(135deg,var(--primary),var(--secondary))";
      break;
    case "image": {
      const u = safeUrl(bg.value);
      if (u) { style.backgroundImage = `url('${u}')`; style.backgroundSize = "cover"; style.backgroundPosition = "center"; }
      break;
    }
    case "video": {
      const u = safeUrl(bg.value);
      style.background = "#0b0d12";
      return { style, videoUrl: u || undefined };
    }
    case "pattern":
      Object.assign(style, patternStyle(bg.value));
      break;
  }
  return { style };
}

export const PATTERNS = ["dots", "lines", "grid", "mesh"] as const;
function patternStyle(name: string): StyleMap {
  switch (name) {
    case "dots":
      return { backgroundColor: "var(--bg)", backgroundImage: "radial-gradient(rgba(0,0,0,.10) 1px,transparent 1px)", backgroundSize: "18px 18px" };
    case "lines":
      return { backgroundColor: "var(--bg)", backgroundImage: "repeating-linear-gradient(45deg,rgba(0,0,0,.05) 0 1px,transparent 1px 13px)" };
    case "grid":
      return { backgroundColor: "var(--bg)", backgroundImage: "linear-gradient(rgba(0,0,0,.06) 1px,transparent 1px),linear-gradient(90deg,rgba(0,0,0,.06) 1px,transparent 1px)", backgroundSize: "28px 28px" };
    case "mesh":
      return { backgroundColor: "var(--bg)", backgroundImage: "radial-gradient(40% 40% at 12% 12%,color-mix(in srgb,var(--primary) 22%,transparent),transparent),radial-gradient(45% 45% at 88% 20%,color-mix(in srgb,var(--secondary) 20%,transparent),transparent),radial-gradient(45% 45% at 60% 95%,color-mix(in srgb,var(--primary) 16%,transparent),transparent)" };
    default:
      return { backgroundColor: "var(--bg)" };
  }
}

/** The section's outer wrapper style (background + padding). */
export function sectionWrapStyle(sec: StudioSection): { style: StyleMap; videoUrl?: string } {
  const { style, videoUrl } = sectionBgStyle(sec.background);
  style.paddingTop = `${sec.padding?.top ?? 64}px`;
  style.paddingBottom = `${sec.padding?.bottom ?? 64}px`;
  style.paddingLeft = "24px";
  style.paddingRight = "24px";
  style.position = "relative";
  style.overflow = "hidden";
  return { style, videoUrl };
}

/** The inner container width for a section layout. */
export function sectionInnerStyle(sec: StudioSection): StyleMap {
  const maxW = sec.layout === "contained" ? "780px" : sec.layout === "split" ? "1080px" : "1120px";
  const style: StyleMap = { maxWidth: maxW, marginLeft: "auto", marginRight: "auto", position: "relative", zIndex: "1" };
  if (sec.layout === "split") {
    style.display = "grid";
    style.gridTemplateColumns = "1fr 1fr";
    style.gap = "40px";
    style.alignItems = "center";
  }
  return style;
}

/** Base styles for one element, merged with its own `styles` map. */
export function elementStyle(el: StudioElement): StyleMap {
  const base: StyleMap = {};
  switch (el.type) {
    case "heading":
      base.fontFamily = "var(--heading-font)";
      base.fontWeight = "800";
      base.lineHeight = "1.12";
      base.margin = "0 0 8px";
      base.color = "var(--ink)";
      break;
    case "text":
      base.fontFamily = "var(--body-font)";
      base.lineHeight = "1.65";
      base.margin = "0 0 14px";
      base.color = "var(--ink)";
      break;
    case "divider":
      base.border = "0";
      base.height = "1px";
      base.background = "currentColor";
      base.opacity = ".18";
      base.margin = "20px 0";
      break;
  }
  return { ...base, ...(el.styles || {}) };
}

// ── Element factory ────────────────────────────────────────────────────────────

export function makeElement(type: ElementType, overrides: Partial<StudioElement> = {}): StudioElement {
  const defaults: Record<ElementType, Omit<StudioElement, "id" | "type">> = {
    heading: { content: "Heading", styles: { fontSize: "34px", textAlign: "left" }, props: { level: 2 } },
    text: { content: "Add your text here. Click to edit.", styles: { fontSize: "17px", textAlign: "left" }, props: {} },
    image: { content: "", styles: {}, props: { alt: "", radius: "14", shadow: true, fit: "cover", behavior: "none", url: "" } },
    video: { content: "", styles: {}, props: { provider: "file", autoplay: false, mute: true, loop: false, poster: "" } },
    button: { content: "Get in touch", styles: { textAlign: "left" }, props: { url: "", variant: "solid", radius: "10" } },
    divider: { content: "", styles: {}, props: {} },
    spacer: { content: "", styles: {}, props: { height: 40 } },
    social: { content: "", styles: { textAlign: "left" }, props: { linkedin: "", github: "", twitter: "", website: "", email: "" } },
    "resume-download": { content: "Download résumé", styles: { textAlign: "left" }, props: { url: "" } },
  };
  const d = defaults[type];
  return { id: newId(type), type, content: d.content, styles: { ...d.styles }, props: { ...d.props }, ...overrides };
}

// ── Section factory (default elements per type) ────────────────────────────────

const SECTION_LABELS: Record<SectionType, string> = {
  hero: "Hero", about: "About", experience: "Experience", education: "Education",
  skills: "Skills", projects: "Projects", gallery: "Gallery", testimonials: "Testimonials",
  contact: "Contact", video: "Video", custom: "Custom",
};

export const SECTION_CHOICES: { type: SectionType; label: string }[] =
  (Object.keys(SECTION_LABELS) as SectionType[]).map((type) => ({ type, label: SECTION_LABELS[type] }));

export function makeSection(type: SectionType, overrides: Partial<StudioSection> = {}): StudioSection {
  const els: StudioElement[] = [];
  switch (type) {
    case "hero":
      els.push(makeElement("heading", { content: "Your Name", styles: { fontSize: "clamp(38px,7vw,64px)", textAlign: "center" }, props: { level: 1 } }));
      els.push(makeElement("text", { content: "Your headline — role &amp; what you do best.", styles: { fontSize: "20px", textAlign: "center", opacity: ".8" } }));
      els.push(makeElement("button", { content: "Get in touch", styles: { textAlign: "center" }, props: { url: "", variant: "solid", radius: "10" } }));
      break;
    case "about":
      els.push(makeElement("heading", { content: "About", styles: { fontSize: "13px", textAlign: "left", letterSpacing: ".14em", textTransform: "uppercase", color: "var(--primary)" }, props: { level: 2 } }));
      els.push(makeElement("text", { content: "A few sentences about who you are and what drives you.", styles: { fontSize: "18px" } }));
      break;
    case "experience":
    case "education":
      els.push(makeElement("heading", { content: SECTION_LABELS[type], styles: { fontSize: "13px", textAlign: "left", letterSpacing: ".14em", textTransform: "uppercase", color: "var(--primary)" }, props: { level: 2 } }));
      els.push(makeElement("heading", { content: type === "experience" ? "Senior Role · Company" : "Degree · School", styles: { fontSize: "20px" }, props: { level: 3 } }));
      els.push(makeElement("text", { content: "2021 – Present · one line on what you did and the impact you had.", styles: { fontSize: "16px", opacity: ".85" } }));
      break;
    case "skills":
      els.push(makeElement("heading", { content: "Skills", styles: { fontSize: "13px", textAlign: "left", letterSpacing: ".14em", textTransform: "uppercase", color: "var(--primary)" }, props: { level: 2 } }));
      els.push(makeElement("text", { content: "JavaScript · React · Node · Design · Leadership", styles: { fontSize: "17px" } }));
      break;
    case "projects":
      els.push(makeElement("heading", { content: "Projects", styles: { fontSize: "13px", textAlign: "left", letterSpacing: ".14em", textTransform: "uppercase", color: "var(--primary)" }, props: { level: 2 } }));
      els.push(makeElement("image", {}));
      els.push(makeElement("heading", { content: "Project name", styles: { fontSize: "20px" }, props: { level: 3 } }));
      els.push(makeElement("text", { content: "What it is and what you shipped.", styles: { fontSize: "16px", opacity: ".85" } }));
      break;
    case "gallery":
      els.push(makeElement("heading", { content: "Gallery", styles: { fontSize: "13px", textAlign: "left", letterSpacing: ".14em", textTransform: "uppercase", color: "var(--primary)" }, props: { level: 2 } }));
      els.push(makeElement("image", {}));
      els.push(makeElement("image", {}));
      els.push(makeElement("image", {}));
      break;
    case "testimonials":
      els.push(makeElement("text", { content: "&ldquo;A short, glowing quote from a colleague or client.&rdquo;", styles: { fontSize: "22px", textAlign: "center", fontFamily: "var(--heading-font)" } }));
      els.push(makeElement("text", { content: "— Someone great, Their Title", styles: { fontSize: "15px", textAlign: "center", opacity: ".7" } }));
      break;
    case "contact":
      els.push(makeElement("heading", { content: "Get in touch", styles: { fontSize: "30px", textAlign: "center" }, props: { level: 2 } }));
      els.push(makeElement("social", { styles: { textAlign: "center" } }));
      els.push(makeElement("button", { content: "Email me", styles: { textAlign: "center" }, props: { url: "", variant: "solid", radius: "10" } }));
      break;
    case "video":
      els.push(makeElement("heading", { content: "Video", styles: { fontSize: "13px", textAlign: "left", letterSpacing: ".14em", textTransform: "uppercase", color: "var(--primary)" }, props: { level: 2 } }));
      els.push(makeElement("video", {}));
      break;
    case "custom":
      els.push(makeElement("text", { content: "Custom section — add any elements you like.", styles: { fontSize: "17px" } }));
      break;
  }
  return {
    id: newId("sec"),
    type,
    name: SECTION_LABELS[type],
    visible: true,
    background: { type: "solid", value: "var(--bg)" },
    padding: { top: type === "hero" ? 96 : 64, bottom: type === "hero" ? 96 : 64 },
    layout: type === "hero" || type === "contact" || type === "testimonials" ? "contained" : "contained",
    elements: els,
    ...overrides,
  };
}

// ── Templates ──────────────────────────────────────────────────────────────────

export interface TemplateMeta {
  id: string;
  label: string;
  desc: string;
  categories: string[]; // for the gallery filter bar
}

export const STUDIO_TEMPLATES: TemplateMeta[] = [
  { id: "portfolio", label: "Portfolio", desc: "Hero, work grid, contact", categories: ["Portfolio", "Creative"] },
  { id: "resume", label: "Resume", desc: "Clean single-column CV", categories: ["Resume", "Minimal"] },
  { id: "creative", label: "Creative", desc: "Bold gradient, big type", categories: ["Creative"] },
  { id: "minimal", label: "Minimal", desc: "Whitespace & elegant serif", categories: ["Minimal"] },
  { id: "executive", label: "Executive", desc: "Dark, premium, refined", categories: ["Executive"] },
  { id: "developer", label: "Developer", desc: "Terminal, monospace", categories: ["Developer"] },
  { id: "designer", label: "Designer", desc: "Visual, project-forward", categories: ["Designer", "Portfolio"] },
  { id: "startup", label: "Startup", desc: "Punchy, metric-driven", categories: ["Startup", "Creative"] },
];

export const GALLERY_FILTERS = ["All", "Portfolio", "Resume", "Creative", "Minimal", "Executive", "Developer", "Designer", "Startup"];

const THEMES: Record<string, StudioTheme> = {
  portfolio: { primaryColor: "#8B5CF6", secondaryColor: "#14B8A6", textColor: "#1a1a1a", bgColor: "#ffffff", headingFont: "Poppins", bodyFont: "Inter" },
  resume: { primaryColor: "#1E3A8A", secondaryColor: "#475569", textColor: "#1a1a1a", bgColor: "#ffffff", headingFont: "System Sans", bodyFont: "System Sans" },
  creative: { primaryColor: "#E11D48", secondaryColor: "#F59E0B", textColor: "#1a1a1a", bgColor: "#ffffff", headingFont: "Space Grotesk", bodyFont: "DM Sans" },
  minimal: { primaryColor: "#111111", secondaryColor: "#777777", textColor: "#1a1a1a", bgColor: "#ffffff", headingFont: "Playfair Display", bodyFont: "Lora" },
  executive: { primaryColor: "#C2870B", secondaryColor: "#8B5CF6", textColor: "#e8eaed", bgColor: "#0f1218", headingFont: "Playfair Display", bodyFont: "Inter" },
  developer: { primaryColor: "#7ee787", secondaryColor: "#58a6ff", textColor: "#e8eaed", bgColor: "#0d1117", headingFont: "JetBrains Mono", bodyFont: "JetBrains Mono" },
  designer: { primaryColor: "#8B5CF6", secondaryColor: "#14B8A6", textColor: "#1a1a1a", bgColor: "#faf9fb", headingFont: "Montserrat", bodyFont: "Work Sans" },
  startup: { primaryColor: "#059669", secondaryColor: "#8B5CF6", textColor: "#111111", bgColor: "#ffffff", headingFont: "Manrope", bodyFont: "Manrope" },
};

/** Optional per-template hero treatment so templates look distinct out of the box. */
function heroBackground(id: string): SectionBackground {
  switch (id) {
    case "creative": return { type: "gradient", value: "linear-gradient(135deg,var(--primary),#0b0b12)" };
    case "startup": return { type: "gradient", value: "radial-gradient(120% 120% at 50% 0%,color-mix(in srgb,var(--primary) 22%,#fff),#fff)" };
    case "executive": return { type: "gradient", value: "linear-gradient(180deg,#14171f,#0b0d12)" };
    case "developer": return { type: "solid", value: "#161b22" };
    case "minimal": return { type: "solid", value: "var(--bg)" };
    default: return { type: "solid", value: "var(--bg)" };
  }
}

/** Build a fresh StudioSite for a template, optionally pre-filled from a résumé. */
export function templateSite(templateId: string, prefill?: ResumePrefill): StudioSite {
  const id = STUDIO_TEMPLATES.find((t) => t.id === templateId) ? templateId : "portfolio";
  const theme = { ...THEMES[id] };
  const dark = id === "executive" || id === "developer";

  const hero = makeSection("hero", { background: heroBackground(id) });
  // Light text on a dark/gradient hero.
  if (dark || id === "creative" || id === "executive") {
    for (const el of hero.elements) {
      if (el.type === "heading" || el.type === "text") el.styles.color = "#ffffff";
    }
  }
  const about = makeSection("about");
  const experience = makeSection("experience");
  const skills = makeSection("skills");
  const projects = makeSection("projects", id === "designer" || id === "portfolio" ? { layout: "full" } : {});
  const contact = makeSection("contact");

  const sections = [hero, about, experience, skills, projects, contact];

  // Prefill from a résumé (best effort).
  if (prefill) {
    if (prefill.name) setElContent(hero, "heading", 0, prefill.name);
    if (prefill.headline) setElContent(hero, "text", 0, escapeInline(prefill.headline));
    if (prefill.about) setElContent(about, "text", 0, escapeInline(prefill.about));
    if (prefill.experience.length) {
      // Replace the experience section body with the parsed roles.
      const head = experience.elements[0];
      experience.elements = [head];
      for (const line of prefill.experience.slice(0, 6)) {
        experience.elements.push(makeElement("text", { content: escapeInline(line), styles: { fontSize: "16px", opacity: ".9" } }));
      }
    }
    if (prefill.skills.length) setElContent(skills, "text", 0, escapeInline(prefill.skills.join(" · ")));
    if (prefill.email) contact.elements.forEach((el) => { if (el.type === "social") el.props.email = prefill.email; });
  }

  return {
    version: 2,
    templateId: id,
    title: (prefill?.name || "Personal Website") + (prefill?.headline ? ` | ${prefill.headline}` : ""),
    metaDescription: prefill?.about || "My personal website.",
    theme,
    sections,
    animate: true,
  };
}

function setElContent(sec: StudioSection, type: ElementType, nth: number, content: string): void {
  let seen = -1;
  for (const el of sec.elements) {
    if (el.type === type) {
      seen += 1;
      if (seen === nth) { el.content = content; return; }
    }
  }
}
function escapeInline(s: string): string {
  return escapeHtml(s);
}

// ── Résumé prefill parsing (pure, best-effort) ──────────────────────────────────

export interface ResumePrefill {
  name: string;
  headline: string;
  about: string;
  experience: string[];
  skills: string[];
  email: string;
}

/** Very lightweight parse of plain résumé text into site-fill fields. */
export function parseResumeText(text: string): ResumePrefill {
  const clean = String(text || "").replace(/\r/g, "");
  const lines = clean.split("\n").map((l) => l.trim());
  const nonEmpty = lines.filter(Boolean);
  const name = nonEmpty[0] && nonEmpty[0].length <= 48 ? nonEmpty[0].replace(/[#*]/g, "").trim() : "";
  const emailMatch = clean.match(/[\w.+-]+@[\w-]+\.[\w.-]+/);
  const email = emailMatch ? emailMatch[0] : "";

  // Headline: the second non-empty line if it's short and not contact info.
  let headline = "";
  for (let i = 1; i < Math.min(nonEmpty.length, 4); i++) {
    const l = nonEmpty[i];
    if (l.length <= 70 && !/@|\d{3}|http/.test(l)) { headline = l.replace(/[#*]/g, "").trim(); break; }
  }

  // About: text under a SUMMARY / PROFILE / ABOUT / OBJECTIVE heading, else the
  // first substantial paragraph.
  let about = "";
  const secIdx = lines.findIndex((l) => /^(professional\s+)?(summary|profile|about|objective)\b/i.test(l));
  if (secIdx >= 0) {
    const body: string[] = [];
    for (let i = secIdx + 1; i < lines.length && body.join(" ").length < 420; i++) {
      const l = lines[i];
      if (!l) { if (body.length) break; else continue; }
      if (/^[A-Z][A-Z \t]{3,}$/.test(l)) break; // next ALL-CAPS heading
      body.push(l.replace(/^[-•*]\s*/, ""));
    }
    about = body.join(" ").trim();
  }
  if (!about) {
    const para = nonEmpty.find((l) => l.length > 80);
    about = para || "";
  }

  // Experience: bullet lines (•, -, *) capped to a handful.
  const experience = lines
    .filter((l) => /^[-•*]\s+/.test(l))
    .map((l) => l.replace(/^[-•*]\s+/, "").trim())
    .filter((l) => l.length > 8)
    .slice(0, 6);

  // Skills: the line after a SKILLS heading, split on commas / bullets.
  let skills: string[] = [];
  const skIdx = lines.findIndex((l) => /^(technical\s+)?(skills|technologies|tools)\b/i.test(l));
  if (skIdx >= 0) {
    for (let i = skIdx + 1; i < Math.min(lines.length, skIdx + 4); i++) {
      const l = lines[i];
      if (!l) continue;
      skills = l.split(/[,•|]/).map((s) => s.trim()).filter((s) => s.length > 1 && s.length < 28).slice(0, 12);
      if (skills.length) break;
    }
  }

  return { name, headline, about: about.slice(0, 420), experience, skills, email };
}
