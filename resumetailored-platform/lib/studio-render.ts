/**
 * Web Studio v2 — pure server-side renderer. Turns a `StudioSite` into a
 * self-contained, responsive static HTML document (inline CSS, no build step).
 * Used by the publish route, the public /site/<slug> page, the gallery preview
 * cards and the "Download HTML" export. No React, no DOM — safe to run anywhere.
 *
 * All user text is escaped or run through the shared rich-text sanitizer, and
 * every URL that lands in href/src is limited to http(s)/mailto/data:image, so a
 * published page can never carry injected script.
 */

import {
  StudioSite, StudioSection, StudioElement,
  escapeHtml, safeUrl, sanitizeRichText, styleToCss,
  themeVars, sectionWrapStyle, sectionInnerStyle, elementStyle, googleFontLinks,
} from "./studio-types";

// ── Video embed helpers ────────────────────────────────────────────────────────

function youTubeId(url: string): string | null {
  const m = url.match(/(?:youtube\.com\/(?:watch\?v=|embed\/|shorts\/)|youtu\.be\/)([A-Za-z0-9_-]{6,})/);
  return m ? m[1] : null;
}
function vimeoId(url: string): string | null {
  const m = url.match(/vimeo\.com\/(?:video\/)?(\d{5,})/);
  return m ? m[1] : null;
}

function renderVideo(el: StudioElement): string {
  const url = String(el.content || "").trim();
  const autoplay = el.props.autoplay === true;
  const mute = el.props.mute !== false;
  const loop = el.props.loop === true;
  const poster = safeUrl(el.props.poster);
  const yt = youTubeId(url);
  if (yt) {
    const q = new URLSearchParams();
    if (autoplay) { q.set("autoplay", "1"); q.set("mute", "1"); }
    if (loop) { q.set("loop", "1"); q.set("playlist", yt); }
    return `<div class="rt-embed"><iframe src="https://www.youtube.com/embed/${escapeHtml(yt)}?${q.toString()}" title="Video" frameborder="0" allow="accelerometer;autoplay;encrypted-media;gyroscope;picture-in-picture" allowfullscreen loading="lazy"></iframe></div>`;
  }
  const vm = vimeoId(url);
  if (vm) {
    const q = new URLSearchParams();
    if (autoplay) { q.set("autoplay", "1"); q.set("muted", "1"); }
    if (loop) q.set("loop", "1");
    return `<div class="rt-embed"><iframe src="https://player.vimeo.com/video/${escapeHtml(vm)}?${q.toString()}" title="Video" frameborder="0" allow="autoplay;fullscreen;picture-in-picture" allowfullscreen loading="lazy"></iframe></div>`;
  }
  const src = safeUrl(url);
  if (!src) return "";
  const attrs = ["controls", "playsinline", "preload=\"metadata\""];
  if (autoplay) attrs.push("autoplay");
  if (mute) attrs.push("muted");
  if (loop) attrs.push("loop");
  if (poster) attrs.push(`poster="${escapeHtml(poster)}"`);
  return `<video class="rt-video" ${attrs.join(" ")} src="${escapeHtml(src)}"></video>`;
}

// ── Element rendering ────────────────────────────────────────────────────────

function buttonCss(el: StudioElement, primary: string): string {
  const variant = String(el.props.variant || "solid");
  const radius = `${Number(el.props.radius ?? 10)}px`;
  const base = `display:inline-block;padding:12px 24px;border-radius:${radius};font-weight:700;text-decoration:none;font-family:var(--heading-font);transition:transform .15s ease,box-shadow .15s ease;`;
  if (variant === "outline") return `${base}border:2px solid var(--primary);color:var(--primary);background:transparent;`;
  if (variant === "ghost") return `${base}color:var(--primary);background:color-mix(in srgb,var(--primary) 12%,transparent);`;
  return `${base}background:var(--primary);color:#fff;box-shadow:0 6px 20px color-mix(in srgb,var(--primary) 35%,transparent);`;
  void primary;
}

function renderElement(el: StudioElement, theme: StudioSite["theme"], reveal: string): string {
  const align = el.styles.textAlign;
  switch (el.type) {
    case "heading": {
      const level = Math.min(3, Math.max(1, Number(el.props.level) || 2));
      const style = styleToCss(elementStyle(el));
      return `<h${level} class="rt-el${reveal}" style="${style}">${sanitizeRichText(el.content)}</h${level}>`;
    }
    case "text": {
      const style = styleToCss(elementStyle(el));
      return `<p class="rt-el${reveal}" style="${style}">${sanitizeRichText(el.content)}</p>`;
    }
    case "image": {
      const src = safeUrl(el.content);
      if (!src) return "";
      const radius = `${Number(el.props.radius ?? 14)}px`;
      const shadow = el.props.shadow ? "box-shadow:0 10px 34px rgba(0,0,0,.16);" : "";
      const fit = String(el.props.fit || "cover");
      const objectFit = fit === "original" ? "" : `object-fit:${fit};`;
      const style = `max-width:100%;border-radius:${radius};${shadow}${objectFit}${styleToCss(el.styles)}`;
      const img = `<img class="rt-el${reveal}" src="${escapeHtml(src)}" alt="${escapeHtml(el.props.alt || "")}" style="${style}" loading="lazy"/>`;
      const url = safeUrl(el.props.url);
      if (el.props.behavior === "link" && url) return `<a href="${escapeHtml(url)}" target="_blank" rel="noopener noreferrer">${img}</a>`;
      return img;
    }
    case "video": {
      const wrapAlign = align ? `text-align:${align};` : "";
      const inner = renderVideo(el);
      return inner ? `<div class="rt-el${reveal}" style="${wrapAlign}">${inner}</div>` : "";
    }
    case "button": {
      const url = safeUrl(el.props.url) || "#";
      const wrapAlign = align ? `text-align:${align};` : "";
      return `<div class="rt-el${reveal}" style="margin:10px 0;${wrapAlign}"><a href="${escapeHtml(url)}"${url === "#" ? "" : ' target="_blank" rel="noopener noreferrer"'} style="${buttonCss(el, theme.primaryColor)}">${escapeHtml(el.content)}</a></div>`;
    }
    case "divider":
      return `<hr class="rt-el${reveal}" style="${styleToCss(elementStyle(el))}"/>`;
    case "spacer":
      return `<div class="rt-el" style="height:${Number(el.props.height) || 40}px"></div>`;
    case "social": {
      const links: string[] = [];
      const add = (label: string, raw: unknown, prefix = "") => {
        const u = prefix === "mailto:" ? (raw ? `mailto:${raw}` : "") : safeUrl(raw);
        if (u) links.push(`<a href="${escapeHtml(u)}" target="_blank" rel="noopener noreferrer" class="rt-social">${label}</a>`);
      };
      add("LinkedIn", el.props.linkedin);
      add("GitHub", el.props.github);
      add("Twitter", el.props.twitter);
      add("Website", el.props.website);
      add("Email", el.props.email, "mailto:");
      if (!links.length) return "";
      const wrapAlign = align ? `justify-content:${align === "center" ? "center" : align === "right" ? "flex-end" : "flex-start"};` : "";
      return `<div class="rt-el rt-socialrow${reveal}" style="${wrapAlign}">${links.join("")}</div>`;
    }
    case "resume-download": {
      const url = safeUrl(el.props.url);
      const wrapAlign = align ? `text-align:${align};` : "";
      const disabled = url ? "" : "opacity:.5;pointer-events:none;";
      return `<div class="rt-el${reveal}" style="margin:10px 0;${wrapAlign}"><a href="${escapeHtml(url || "#")}"${url ? ' target="_blank" rel="noopener noreferrer"' : ""} style="${buttonCss(el, theme.primaryColor)}${disabled}">⬇ ${escapeHtml(el.content || "Download résumé")}</a></div>`;
    }
    default:
      return "";
  }
}

// ── Section rendering ──────────────────────────────────────────────────────────

export function renderSection(sec: StudioSection, site: StudioSite, opts: { reveal?: boolean } = {}): string {
  if (!sec.visible) return "";
  const { style, videoUrl } = sectionWrapStyle(sec);
  const inner = styleToCss(sectionInnerStyle(sec));
  const reveal = opts.reveal ? " rt-reveal" : "";
  const bgVideo = videoUrl
    ? `<video class="rt-bgvid" autoplay muted loop playsinline src="${escapeHtml(videoUrl)}"></video><div class="rt-bgvid-scrim"></div>`
    : "";
  const els = sec.elements.map((el) => renderElement(el, site.theme, reveal)).join("\n");
  return `<section class="rt-sec" data-type="${escapeHtml(sec.type)}" style="${styleToCss(style)}">${bgVideo}<div class="rt-inner" style="${inner}">${els}</div></section>`;
}

// ── Full document ──────────────────────────────────────────────────────────────

export function renderStudioSite(site: StudioSite): string {
  const theme = site.theme;
  const vars = styleToCss(themeVars(theme));
  const fontLinks = googleFontLinks(theme).map((h) => `<link rel="stylesheet" href="${escapeHtml(h)}"/>`).join("");
  const animate = site.animate !== false;
  const reveal = animate;

  const title = site.title || "Personal Website";
  const desc = (site.metaDescription || "").slice(0, 300);
  const ogImage = safeUrl(site.ogImageUrl);
  const favicon = safeUrl(site.faviconUrl);
  // Strip any style-tag close (incl. `</style >` / `</STYLE\t>`) so custom CSS
  // can't break out of the <style> block on the public page.
  const customCss = String(site.customCss || "").replace(/<\/\s*style\s*>/gi, "");

  const body = site.sections.filter((s) => s.visible).map((s) => renderSection(s, site, { reveal })).join("\n");

  return `<!doctype html><html lang="en"><head><meta charset="utf-8"/>
<meta name="viewport" content="width=device-width,initial-scale=1"/>
<title>${escapeHtml(title)}</title>
<meta name="description" content="${escapeHtml(desc)}"/>
<meta property="og:type" content="website"/>
<meta property="og:title" content="${escapeHtml(title)}"/>
<meta property="og:description" content="${escapeHtml(desc)}"/>
${ogImage ? `<meta property="og:image" content="${escapeHtml(ogImage)}"/>` : ""}
<meta name="twitter:card" content="${ogImage ? "summary_large_image" : "summary"}"/>
${favicon ? `<link rel="icon" href="${escapeHtml(favicon)}"/>` : ""}
${fontLinks}
<style>
  :root{${vars}}
  *{box-sizing:border-box}
  html,body{margin:0;padding:0}
  body{font-family:var(--body-font);color:var(--ink);background:var(--bg);line-height:1.6;-webkit-font-smoothing:antialiased}
  img{max-width:100%;display:block}
  .rt-sec{width:100%}
  .rt-inner{width:100%}
  .rt-el{max-width:100%}
  a{color:var(--primary)}
  .rt-video{width:100%;border-radius:14px;background:#000;box-shadow:0 8px 34px rgba(0,0,0,.2)}
  .rt-embed{position:relative;width:100%;padding-top:56.25%;border-radius:14px;overflow:hidden;box-shadow:0 8px 34px rgba(0,0,0,.2)}
  .rt-embed iframe{position:absolute;inset:0;width:100%;height:100%;border:0}
  .rt-socialrow{display:flex;flex-wrap:wrap;gap:14px;margin:12px 0}
  .rt-social{font-weight:600;text-decoration:none;border-bottom:1px solid currentColor;padding-bottom:1px}
  .rt-bgvid{position:absolute;inset:0;width:100%;height:100%;object-fit:cover;z-index:0}
  .rt-bgvid-scrim{position:absolute;inset:0;background:rgba(0,0,0,.45);z-index:0}
  .rt-bgvid ~ .rt-inner{color:#fff}
  footer.rt-foot{padding:26px 24px;text-align:center;font-size:12px;color:color-mix(in srgb,var(--ink) 55%,transparent);border-top:1px solid color-mix(in srgb,var(--ink) 12%,transparent)}
  footer.rt-foot a{color:var(--primary);text-decoration:none}
  ${animate ? ".rt-reveal{opacity:0;transform:translateY(18px);transition:opacity .6s ease,transform .6s ease}.rt-reveal.in{opacity:1;transform:none}" : ""}
  @media(max-width:720px){.rt-sec .rt-inner[style*=grid]{grid-template-columns:1fr!important}}
  ${customCss ? `\n/* custom */\n${customCss}\n` : ""}
</style></head>
<body>
${body}
<footer class="rt-foot">Made with <a href="https://resumetailored.com" target="_blank" rel="noopener noreferrer">ResumeTailored</a></footer>
${animate ? `<script>(function(){var o=new IntersectionObserver(function(es){es.forEach(function(e){if(e.isIntersecting){e.target.classList.add('in');o.unobserve(e.target)}})},{threshold:.12});document.querySelectorAll('.rt-reveal').forEach(function(el){o.observe(el)})})();</script>` : ""}
</body></html>`;
}
