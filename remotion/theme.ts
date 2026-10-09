// Shared visual theme for the ResumeTailored video compositions.
// Keep this in sync with the brand palette used on the web app (indigo/cyan).
export const theme = {
  bg: '#030712', // matches the website body background
  primary: '#6366F1',
  accent: '#22D3EE',
  text: '#F8FAFC',
  subtext: '#94A3B8',
  card: 'rgba(255,255,255,0.06)',
  fontFamily:
    'Inter, -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif',
};

// ── Background-aware colours ────────────────────────────────────────────────
const DEFAULT_BG = '#030712';
const DARK_TEXT = { text: '#0F172A', subtext: '#475569', card: 'rgba(15,23,42,0.07)' };
const LIGHT_TEXT = { text: '#F8FAFC', subtext: '#94A3B8', card: 'rgba(255,255,255,0.06)' };

export const hexToRgb = (hex: string): [number, number, number] => {
  const h = /^#[0-9a-fA-F]{6}$/.test(hex) ? hex : DEFAULT_BG;
  return [parseInt(h.slice(1, 3), 16), parseInt(h.slice(3, 5), 16), parseInt(h.slice(5, 7), 16)];
};

// WCAG relative luminance, 0 (black) – 1 (white).
export const luminance = (hex: string): number => {
  const [r, g, b] = hexToRgb(hex).map((v) => {
    const c = v / 255;
    return c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
  });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
};

/**
 * Point the shared theme at a background. Light backgrounds get dark text so every scene stays readable.
 * The scenes read `theme.*` when they render, and ResumeVideo calls this first thing in its own render
 * with the same input props for every frame, so the whole video is consistent (and the defaults, used by
 * the site's own videos, are untouched when no backgroundColor is given).
 */
export function applyThemeFor(bg?: string): string {
  const base = bg && /^#[0-9a-fA-F]{6}$/.test(bg) ? bg : DEFAULT_BG;
  const light = luminance(base) > 0.4;
  Object.assign(theme, light ? DARK_TEXT : LIGHT_TEXT, { bg: base });
  return base;
}
