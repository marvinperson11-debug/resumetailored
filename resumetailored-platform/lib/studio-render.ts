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

// ── Video / embed helpers ──────────────────────────────────────────────────────

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

// ── Per-element scroll animation ────────────────────────────────────────────────

function animAttrs(el: StudioElement, siteAnimate: boolean): { cls: string; vars: string } {
  // Explicit per-element choice wins; otherwise a gentle default fade when the
  // site has animation on. "none" opts an element out entirely.
  const a = String(el.props.anim || (siteAnimate ? "fade" : "none"));
  if (a === "none") return { cls: "", vars: "" };
  const delay = Math.max(0, Number(el.props.animDelay) || 0);
  const dur = Math.max(100, Number(el.props.animDuration) || 600);
  return { cls: ` rt-anim rt-anim-${a}`, vars: `--ad:${delay}ms;--adur:${dur}ms;` };
}

// ── Element rendering ────────────────────────────────────────────────────────

function buttonCss(el: StudioElement): string {
  const variant = String(el.props.variant || "solid");
  const radius = `${Number(el.props.radius ?? 10)}px`;
  const base = `display:inline-block;padding:12px 26px;border-radius:${radius};font-weight:700;text-decoration:none;font-family:var(--heading-font);transition:transform .15s ease,box-shadow .15s ease;`;
  if (variant === "outline") return `${base}border:2px solid var(--primary);color:var(--primary);background:transparent;`;
  if (variant === "ghost") return `${base}color:var(--primary);background:color-mix(in srgb,var(--primary) 12%,transparent);`;
  return `${base}background:var(--primary);color:#fff;box-shadow:0 8px 24px color-mix(in srgb,var(--primary) 38%,transparent);`;
}

function renderElement(el: StudioElement, siteAnimate: boolean): string {
  const align = el.styles.textAlign;
  const { cls, vars } = animAttrs(el, siteAnimate);
  const C = `rt-el${cls}`;

  switch (el.type) {
    case "heading": {
      const level = Math.min(3, Math.max(1, Number(el.props.level) || 2));
      return `<h${level} class="${C}" style="${vars}${styleToCss(elementStyle(el))}">${sanitizeRichText(el.content)}</h${level}>`;
    }
    case "text":
      return `<p class="${C}" style="${vars}${styleToCss(elementStyle(el))}">${sanitizeRichText(el.content)}</p>`;
    case "quote": {
      const cite = String(el.props.cite || "").trim();
      return `<blockquote class="${C} rt-quote" style="${vars}${styleToCss(elementStyle(el))}">${sanitizeRichText(el.content)}${cite ? `<cite class="rt-cite">— ${escapeHtml(cite)}</cite>` : ""}</blockquote>`;
    }
    case "icon":
      return `<div class="${C} rt-icon" style="${vars}${styleToCss(elementStyle(el))}">${escapeHtml(el.content || "★")}</div>`;
    case "image": {
      const src = safeUrl(el.content);
      if (!src) return "";
      const radius = `${Number(el.props.radius ?? 14)}px`;
      const shadow = el.props.shadow ? "box-shadow:0 14px 40px rgba(0,0,0,.18);" : "";
      const fit = String(el.props.fit || "cover");
      const objectFit = fit === "original" ? "" : `object-fit:${fit};`;
      const style = `${vars}max-width:100%;border-radius:${radius};${shadow}${objectFit}${styleToCss(el.styles)}`;
      const img = `<img class="${C}" src="${escapeHtml(src)}" alt="${escapeHtml(el.props.alt || "")}" style="${style}" loading="lazy"/>`;
      const url = safeUrl(el.props.url);
      if (el.props.behavior === "link" && url) return `<a href="${escapeHtml(url)}" target="_blank" rel="noopener noreferrer">${img}</a>`;
      return img;
    }
    case "gallery": {
      const urls = String(el.content || "").split(/\n+/).map((s) => safeUrl(s.trim())).filter(Boolean);
      const cols = Math.min(6, Math.max(1, Number(el.props.columns) || 3));
      const gap = Number(el.props.gap ?? 12);
      const radius = Number(el.props.radius ?? 12);
      const cells = urls.length
        ? urls.map((u) => `<img src="${escapeHtml(u)}" alt="" loading="lazy" style="width:100%;height:100%;object-fit:cover;border-radius:${radius}px"/>`).join("")
        : Array.from({ length: cols }).map(() => `<div class="rt-gph" style="border-radius:${radius}px"></div>`).join("");
      return `<div class="${C} rt-gallery" style="${vars}--cols:${cols};--gap:${gap}px">${cells}</div>`;
    }
    case "video": {
      const inner = renderVideo(el);
      return inner ? `<div class="${C}" style="${vars}${align ? `text-align:${align};` : ""}">${inner}</div>` : "";
    }
    case "audio": {
      const src = safeUrl(el.content);
      if (!src) return "";
      const loop = el.props.loop === true ? " loop" : "";
      const autoplay = el.props.autoplay === true ? " autoplay muted" : "";
      const label = String(el.props.label || "").trim();
      return `<div class="${C} rt-audio" style="${vars}">${label ? `<span class="rt-audio-l">${escapeHtml(label)}</span>` : ""}<audio controls preload="metadata"${loop}${autoplay} src="${escapeHtml(src)}"></audio></div>`;
    }
    case "embed": {
      const src = safeUrl(el.content);
      if (!src) return "";
      const h = Math.max(80, Number(el.props.height) || 360);
      return `<div class="${C}" style="${vars}"><iframe src="${escapeHtml(src)}" style="width:100%;height:${h}px;border:0;border-radius:12px" loading="lazy" referrerpolicy="no-referrer" sandbox="allow-scripts allow-same-origin allow-popups allow-forms"></iframe></div>`;
    }
    case "stat": {
      const value = escapeHtml(el.props.value || "");
      const label = escapeHtml(el.props.label || "");
      return `<div class="${C} rt-stat" style="${vars}${align ? `text-align:${align};` : ""}"><span class="rt-stat-v">${value}</span><span class="rt-stat-l">${label}</span></div>`;
    }
    case "testimonial": {
      const quote = escapeHtml(el.props.quote || "");
      const author = escapeHtml(el.props.author || "");
      const role = escapeHtml(el.props.role || "");
      const avatar = safeUrl(el.props.avatar);
      return `<figure class="${C} rt-testi" style="${vars}"><blockquote>&ldquo;${quote}&rdquo;</blockquote><figcaption>${avatar ? `<img src="${escapeHtml(avatar)}" alt="" class="rt-testi-av"/>` : ""}<span><strong>${author}</strong>${role ? `<br/>${role}` : ""}</span></figcaption></figure>`;
    }
    case "button": {
      const url = safeUrl(el.props.url) || "#";
      return `<div class="${C}" style="${vars}margin:10px 0;${align ? `text-align:${align};` : ""}"><a href="${escapeHtml(url)}"${url === "#" ? "" : ' target="_blank" rel="noopener noreferrer"'} style="${buttonCss(el)}">${escapeHtml(el.content)}</a></div>`;
    }
    case "resume-download": {
      const url = safeUrl(el.props.url);
      const disabled = url ? "" : "opacity:.5;pointer-events:none;";
      return `<div class="${C}" style="${vars}margin:10px 0;${align ? `text-align:${align};` : ""}"><a href="${escapeHtml(url || "#")}"${url ? ' target="_blank" rel="noopener noreferrer"' : ""} style="${buttonCss(el)}${disabled}">⬇ ${escapeHtml(el.content || "Download résumé")}</a></div>`;
    }
    case "divider":
      return `<hr class="${C}" style="${vars}${styleToCss(elementStyle(el))}"/>`;
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
      const j = align === "center" ? "center" : align === "right" ? "flex-end" : "flex-start";
      return `<div class="${C} rt-socialrow" style="${vars}justify-content:${j};">${links.join("")}</div>`;
    }
    default:
      return "";
  }
}

// ── Section rendering ──────────────────────────────────────────────────────────

export function renderSection(sec: StudioSection, site: StudioSite): string {
  if (!sec.visible) return "";
  const siteAnimate = site.animate !== false;
  const { style, videoUrl } = sectionWrapStyle(sec);
  const inner = styleToCss(sectionInnerStyle(sec));
  const bgVideo = videoUrl
    ? `<video class="rt-bgvid" autoplay muted loop playsinline src="${escapeHtml(videoUrl)}"></video><div class="rt-bgvid-scrim"></div>`
    : "";
  const els = sec.elements.map((el) => renderElement(el, siteAnimate)).join("\n");
  return `<section class="rt-sec" data-type="${escapeHtml(sec.type)}" style="${styleToCss(style)}">${bgVideo}<div class="rt-inner" style="${inner}">${els}</div></section>`;
}

// ── Background music (global, floating control) ─────────────────────────────────

function renderMusic(site: StudioSite): string {
  const url = safeUrl(site.music?.url);
  if (!url) return "";
  const vol = Math.min(1, Math.max(0, site.music!.volume ?? 0.6));
  const autoplay = site.music!.autoplay === true;
  const loop = site.music!.loop !== false;
  return `<audio id="rtbgm"${loop ? " loop" : ""} src="${escapeHtml(url)}"></audio>
<button id="rtbgm-btn" class="rt-music" aria-label="Toggle music" title="Music">🔊</button>
<script>(function(){var a=document.getElementById('rtbgm'),b=document.getElementById('rtbgm-btn');if(!a||!b)return;a.volume=${vol};var on=false;function sync(){b.textContent=on?'🔊':'🔈'}function play(){a.play().then(function(){on=true;sync()}).catch(function(){on=false;sync()})}b.addEventListener('click',function(){if(on){a.pause();on=false;sync()}else{a.muted=false;play()}});${autoplay ? "a.muted=true;a.play().then(function(){on=true;b.textContent='🔈';b.classList.add('rt-music-hint')}).catch(function(){});b.addEventListener('click',function(){a.muted=false},{once:true});" : "sync();"}})();</script>`;
}

// ── Full document ──────────────────────────────────────────────────────────────

export function renderStudioSite(site: StudioSite): string {
  const theme = site.theme;
  const vars = styleToCss(themeVars(theme));
  const fontLinks = googleFontLinks(theme).map((h) => `<link rel="stylesheet" href="${escapeHtml(h)}"/>`).join("");
  const animate = site.animate !== false;

  const title = site.title || "Personal Website";
  const desc = (site.metaDescription || "").slice(0, 300);
  const ogImage = safeUrl(site.ogImageUrl);
  const favicon = safeUrl(site.faviconUrl);
  const customCss = String(site.customCss || "").replace(/<\/\s*style\s*>/gi, "");

  const body = site.sections.filter((s) => s.visible).map((s) => renderSection(s, site)).join("\n");

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
  h1,h2,h3{font-family:var(--heading-font)}
  .rt-sec{width:100%}
  .rt-inner{width:100%}
  .rt-el{max-width:100%}
  a{color:var(--primary)}
  .rt-video{width:100%;border-radius:16px;background:#000;box-shadow:0 10px 40px rgba(0,0,0,.22)}
  .rt-embed{position:relative;width:100%;padding-top:56.25%;border-radius:16px;overflow:hidden;box-shadow:0 10px 40px rgba(0,0,0,.22)}
  .rt-embed iframe{position:absolute;inset:0;width:100%;height:100%;border:0}
  .rt-socialrow{display:flex;flex-wrap:wrap;gap:14px;margin:14px 0}
  .rt-social{font-weight:600;text-decoration:none;border-bottom:1px solid currentColor;padding-bottom:1px}
  .rt-quote{font-size:24px}
  .rt-quote .rt-cite{display:block;margin-top:12px;font-size:14px;font-style:normal;opacity:.65;font-family:var(--body-font)}
  .rt-icon{line-height:1}
  .rt-gallery{display:grid;grid-template-columns:repeat(var(--cols,3),1fr);gap:var(--gap,12px);grid-auto-rows:1fr}
  .rt-gallery img{aspect-ratio:1/1}
  .rt-gph{aspect-ratio:1/1;background:color-mix(in srgb,var(--primary) 12%,transparent);border:1px dashed color-mix(in srgb,var(--ink) 25%,transparent)}
  .rt-audio{display:flex;align-items:center;gap:12px;flex-wrap:wrap;margin:10px 0;padding:14px 16px;border-radius:14px;background:color-mix(in srgb,var(--primary) 7%,transparent);border:1px solid color-mix(in srgb,var(--primary) 20%,transparent)}
  .rt-audio-l{font-weight:600}
  .rt-audio audio{flex:1;min-width:200px;height:36px}
  .rt-stat{display:inline-block;min-width:150px;padding:20px 22px;margin:6px;border-radius:18px;background:color-mix(in srgb,var(--primary) 6%,transparent);border:1px solid color-mix(in srgb,var(--primary) 16%,transparent);box-shadow:0 8px 26px rgba(0,0,0,.05)}
  .rt-stat-v{display:block;font-family:var(--heading-font);font-weight:800;font-size:44px;line-height:1;color:var(--primary)}
  .rt-stat-l{display:block;margin-top:8px;font-size:14px;opacity:.7}
  .rt-testi{margin:0;padding:26px;border-radius:20px;background:color-mix(in srgb,var(--ink) 4%,transparent);border:1px solid color-mix(in srgb,var(--ink) 10%,transparent);box-shadow:0 12px 34px rgba(0,0,0,.06)}
  .rt-testi blockquote{margin:0 0 16px;font-size:19px;line-height:1.5;font-family:var(--heading-font)}
  .rt-testi figcaption{display:flex;align-items:center;gap:12px;font-size:14px;opacity:.85}
  .rt-testi-av{width:44px;height:44px;border-radius:50%;object-fit:cover}
  .rt-bgvid{position:absolute;inset:0;width:100%;height:100%;object-fit:cover;z-index:0}
  .rt-bgvid-scrim{position:absolute;inset:0;background:rgba(0,0,0,.45);z-index:0}
  .rt-bgvid ~ .rt-inner{color:#fff}
  .rt-music{position:fixed;right:16px;bottom:16px;z-index:50;width:48px;height:48px;border-radius:50%;border:0;cursor:pointer;font-size:20px;background:var(--primary);color:#fff;box-shadow:0 8px 24px rgba(0,0,0,.28)}
  .rt-music-hint{animation:rtpulse 1.6s ease-in-out 3}
  @keyframes rtpulse{0%,100%{transform:scale(1)}50%{transform:scale(1.12)}}
  footer.rt-foot{padding:28px 24px;text-align:center;font-size:12px;color:color-mix(in srgb,var(--ink) 55%,transparent);border-top:1px solid color-mix(in srgb,var(--ink) 12%,transparent)}
  footer.rt-foot a{color:var(--primary);text-decoration:none}
  .rt-anim{opacity:0;will-change:opacity,transform;transition:opacity var(--adur,600ms) cubic-bezier(.2,.7,.2,1) var(--ad,0ms),transform var(--adur,600ms) cubic-bezier(.2,.7,.2,1) var(--ad,0ms)}
  .rt-anim.in{opacity:1;transform:none}
  .rt-anim-slide-up{transform:translateY(28px)}
  .rt-anim-slide-left{transform:translateX(30px)}
  .rt-anim-slide-right{transform:translateX(-30px)}
  .rt-anim-scale{transform:scale(.93)}
  @media(prefers-reduced-motion:reduce){.rt-anim{opacity:1!important;transform:none!important;transition:none}}
  @media(max-width:820px){.rt-sec .rt-inner[style*=grid]{grid-template-columns:1fr!important}.rt-gallery{grid-template-columns:repeat(2,1fr)!important}}
  @media(max-width:560px){.rt-gallery{grid-template-columns:1fr!important}.rt-stat{display:block;margin:8px 0}}
  ${customCss ? `\n/* custom */\n${customCss}\n` : ""}
</style></head>
<body>
${body}
<footer class="rt-foot">Made with <a href="https://resumetailored.com" target="_blank" rel="noopener noreferrer">ResumeTailored</a></footer>
${renderMusic(site)}
${animate ? `<script>(function(){var o=new IntersectionObserver(function(es){es.forEach(function(e){if(e.isIntersecting){e.target.classList.add('in');o.unobserve(e.target)}})},{threshold:.1});document.querySelectorAll('.rt-anim').forEach(function(el){o.observe(el)})})();</script>` : `<script>document.querySelectorAll('.rt-anim').forEach(function(el){el.classList.add('in')});</script>`}
</body></html>`;
}
