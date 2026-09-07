/**
 * Resume + cover-letter template engine — a faithful port of the old site's
 * template system (public/app.html `OUT_TPLS` + `renderAIOutput` pipeline).
 *
 * The product's core asset is a set of (layout × color) templates. Each entry
 * is `{ id, name, free, serif, style, layout, c:{p,a,l} }`; the renderer turns
 * the AI's plain-text output into styled, print-ready HTML for the chosen
 * template. Kept as pure string functions so it runs the same on the server
 * (previews) and in the browser (print-to-PDF).
 *
 * 56 resume + 48 cover = 104 templates. Free set mirrors the server gate:
 * resume r1/r5/r17, cover c1/c5/c17.
 */

export type Colors = { p: string; a: string; l: string };
export type TplStyle = "underline" | "left-bar" | "icon-bar" | "minimal";
export type ResumeLayout =
  | "rClassic"
  | "rExecutive"
  | "rModern"
  | "rSidebar"
  | "rMinimal"
  | "rTwoCol"
  | "rBanner";
export type CoverLayout = "cFormal" | "cBold" | "cBoxed" | "cSplit" | "cClean" | "cModern";
export type Layout = ResumeLayout | CoverLayout;

export interface Template {
  id: string;
  name: string;
  free: boolean;
  serif: boolean;
  style: TplStyle;
  layout: Layout;
  c: Colors;
}

export type Mode = "resume" | "cover_letter" | "both";

// Body-font selector options (FIX 7 #3). Keys are what the UI/persistence store;
// values are full CSS font stacks with safe fallbacks.
export const FONT_MAP: Record<string, string> = {
  arial: "Arial,'Helvetica Neue',Helvetica,sans-serif",
  helvetica: "'Helvetica Neue',Helvetica,Arial,sans-serif",
  calibri: "Calibri,'Gill Sans','Segoe UI',sans-serif",
  times: "'Times New Roman',Georgia,serif",
  georgia: "Georgia,'Times New Roman',serif",
  garamond: "Garamond,'EB Garamond','Times New Roman',serif",
  cambria: "Cambria,Georgia,'Times New Roman',serif",
};

// Human labels for the body-font dropdown, in display order.
export const BODY_FONTS: { key: string; label: string }[] = [
  { key: "arial", label: "Arial" },
  { key: "times", label: "Times New Roman" },
  { key: "calibri", label: "Calibri" },
  { key: "georgia", label: "Georgia" },
  { key: "helvetica", label: "Helvetica" },
  { key: "garamond", label: "Garamond" },
  { key: "cambria", label: "Cambria" },
];

// Signature-font selector options (FIX 7 #4): the body fonts plus two cursive
// script faces (loaded from Google Fonts in the preview + print window).
export const SIG_FONT_MAP: Record<string, string> = {
  ...FONT_MAP,
  dancing: "'Dancing Script','Segoe Script',cursive",
  greatvibes: "'Great Vibes','Segoe Script',cursive",
};

export const SIG_FONTS: { key: string; label: string }[] = [
  { key: "dancing", label: "Dancing Script" },
  { key: "greatvibes", label: "Great Vibes" },
  ...BODY_FONTS,
];

export function escHtml(s: unknown): string {
  return String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

/** Circular photo `<img>` for template headers (FIX 7 #1). `photo` is a data URL. */
function photoHtml(photo: string | undefined, size: number, opts: { ring?: string } = {}): string {
  if (!photo) return "";
  const ring = opts.ring ? `box-shadow:0 0 0 3px ${opts.ring};` : "";
  return `<img src="${escHtml(photo)}" alt="" style="width:${size}px;height:${size}px;border-radius:50%;object-fit:cover;display:block;${ring}${PCA}" />`;
}

// ─── Template catalog (single source of truth: 56 resume + 48 cover) ──────────
export const OUT_TPLS: { resume: Template[]; cover: Template[] } = {
  resume: [
    { id: "r1", name: "Classic", free: true, serif: true, style: "underline", layout: "rClassic", c: { p: "#1a237e", a: "#5c6bc0", l: "#e8eaf6" } },
    { id: "r2", name: "Classic Forest", free: false, serif: true, style: "underline", layout: "rClassic", c: { p: "#1b5e20", a: "#4caf50", l: "#e8f5e9" } },
    { id: "r3", name: "Classic Ruby", free: false, serif: true, style: "underline", layout: "rClassic", c: { p: "#7f1d1d", a: "#ef4444", l: "#fef2f2" } },
    { id: "r4", name: "Classic Slate", free: false, serif: true, style: "underline", layout: "rClassic", c: { p: "#263238", a: "#78909c", l: "#eceff1" } },
    { id: "r21", name: "Classic Royal", free: false, serif: true, style: "underline", layout: "rClassic", c: { p: "#1a1a5e", a: "#c084fc", l: "#f5f3ff" } },
    { id: "r22", name: "Classic Teal", free: false, serif: true, style: "underline", layout: "rClassic", c: { p: "#005f73", a: "#0a9396", l: "#e0f7fa" } },
    { id: "r23", name: "Classic Espresso", free: false, serif: true, style: "underline", layout: "rClassic", c: { p: "#3b1c0a", a: "#b45309", l: "#fffbeb" } },
    { id: "r24", name: "Classic Steel", free: false, serif: true, style: "underline", layout: "rClassic", c: { p: "#37474f", a: "#90a4ae", l: "#eceff1" } },
    { id: "r5", name: "Executive", free: true, serif: false, style: "left-bar", layout: "rExecutive", c: { p: "#004d40", a: "#00897b", l: "#e0f2f1" } },
    { id: "r6", name: "Executive Amber", free: false, serif: false, style: "left-bar", layout: "rExecutive", c: { p: "#3e2723", a: "#f59e0b", l: "#fffbeb" } },
    { id: "r7", name: "Executive Indigo", free: false, serif: false, style: "left-bar", layout: "rExecutive", c: { p: "#1a0050", a: "#1F5C3D", l: "#ede9fe" } },
    { id: "r8", name: "Executive Slate", free: false, serif: false, style: "left-bar", layout: "rExecutive", c: { p: "#1c2333", a: "#607d8b", l: "#eceff1" } },
    { id: "r25", name: "Executive Steel", free: false, serif: false, style: "left-bar", layout: "rExecutive", c: { p: "#263238", a: "#546e7a", l: "#eceff1" } },
    { id: "r26", name: "Executive Navy", free: false, serif: false, style: "left-bar", layout: "rExecutive", c: { p: "#0d1b2a", a: "#4fc3f7", l: "#e0f7fa" } },
    { id: "r27", name: "Executive Sage", free: false, serif: false, style: "left-bar", layout: "rExecutive", c: { p: "#1a2e05", a: "#65a30d", l: "#ecfccb" } },
    { id: "r28", name: "Executive Rose", free: false, serif: false, style: "left-bar", layout: "rExecutive", c: { p: "#500724", a: "#e11d48", l: "#fff1f2" } },
    { id: "r9", name: "Modern", free: false, serif: false, style: "icon-bar", layout: "rModern", c: { p: "#1b5e20", a: "#66bb6a", l: "#f1f8e9" } },
    { id: "r10", name: "Modern Ocean", free: false, serif: false, style: "icon-bar", layout: "rModern", c: { p: "#01579b", a: "#29b6f6", l: "#e1f5fe" } },
    { id: "r11", name: "Modern Coral", free: false, serif: false, style: "icon-bar", layout: "rModern", c: { p: "#bf360c", a: "#ff7043", l: "#fff3e0" } },
    { id: "r12", name: "Modern Violet", free: false, serif: false, style: "icon-bar", layout: "rModern", c: { p: "#4a148c", a: "#ab47bc", l: "#f3e5f5" } },
    { id: "r29", name: "Modern Teal", free: false, serif: false, style: "icon-bar", layout: "rModern", c: { p: "#134e4a", a: "#14b8a6", l: "#f0fdfa" } },
    { id: "r30", name: "Modern Gold", free: false, serif: false, style: "icon-bar", layout: "rModern", c: { p: "#78350f", a: "#d97706", l: "#fffbeb" } },
    { id: "r31", name: "Modern Rose", free: false, serif: false, style: "icon-bar", layout: "rModern", c: { p: "#881337", a: "#f43f5e", l: "#fff1f2" } },
    { id: "r32", name: "Modern Slate", free: false, serif: false, style: "icon-bar", layout: "rModern", c: { p: "#0f172a", a: "#64748b", l: "#f8fafc" } },
    { id: "r13", name: "Sidebar", free: false, serif: false, style: "underline", layout: "rSidebar", c: { p: "#4a1042", a: "#ab47bc", l: "#f3e5f5" } },
    { id: "r14", name: "Sidebar Navy", free: false, serif: false, style: "underline", layout: "rSidebar", c: { p: "#0a192f", a: "#4a90d9", l: "#e8f0fe" } },
    { id: "r15", name: "Sidebar Forest", free: false, serif: false, style: "underline", layout: "rSidebar", c: { p: "#052e16", a: "#22c55e", l: "#f0fdf4" } },
    { id: "r16", name: "Sidebar Crimson", free: false, serif: false, style: "underline", layout: "rSidebar", c: { p: "#7f1d1d", a: "#f87171", l: "#fef2f2" } },
    { id: "r33", name: "Sidebar Teal", free: false, serif: false, style: "underline", layout: "rSidebar", c: { p: "#064e3b", a: "#34d399", l: "#ecfdf5" } },
    { id: "r34", name: "Sidebar Amber", free: false, serif: false, style: "underline", layout: "rSidebar", c: { p: "#78350f", a: "#fbbf24", l: "#fffbeb" } },
    { id: "r35", name: "Sidebar Indigo", free: false, serif: false, style: "underline", layout: "rSidebar", c: { p: "#0E2A1C", a: "#2E7D53", l: "#E8F0E9" } },
    { id: "r36", name: "Sidebar Charcoal", free: false, serif: false, style: "underline", layout: "rSidebar", c: { p: "#1f2937", a: "#6b7280", l: "#f9fafb" } },
    { id: "r17", name: "Minimal", free: true, serif: true, style: "minimal", layout: "rMinimal", c: { p: "#b71c1c", a: "#ef9a9a", l: "#fff8f8" } },
    { id: "r18", name: "Minimal Midnight", free: false, serif: true, style: "minimal", layout: "rMinimal", c: { p: "#0d1117", a: "#4299e1", l: "#ebf8ff" } },
    { id: "r19", name: "Minimal Sage", free: false, serif: true, style: "minimal", layout: "rMinimal", c: { p: "#2d4a22", a: "#7cb342", l: "#f9fbe7" } },
    { id: "r20", name: "Minimal Graphite", free: false, serif: true, style: "minimal", layout: "rMinimal", c: { p: "#212121", a: "#9e9e9e", l: "#fafafa" } },
    { id: "r37", name: "Minimal Cobalt", free: false, serif: true, style: "minimal", layout: "rMinimal", c: { p: "#1e3a5f", a: "#2563eb", l: "#eff6ff" } },
    { id: "r38", name: "Minimal Terra", free: false, serif: true, style: "minimal", layout: "rMinimal", c: { p: "#7c2d12", a: "#ea580c", l: "#fff7ed" } },
    { id: "r39", name: "Minimal Emerald", free: false, serif: true, style: "minimal", layout: "rMinimal", c: { p: "#064e3b", a: "#059669", l: "#ecfdf5" } },
    { id: "r40", name: "Minimal Shadow", free: false, serif: true, style: "minimal", layout: "rMinimal", c: { p: "#374151", a: "#6b7280", l: "#f9fafb" } },
    { id: "r41", name: "TwoCol Classic", free: false, serif: false, style: "left-bar", layout: "rTwoCol", c: { p: "#1a237e", a: "#5c6bc0", l: "#e8eaf6" } },
    { id: "r42", name: "TwoCol Forest", free: false, serif: false, style: "left-bar", layout: "rTwoCol", c: { p: "#1b5e20", a: "#4caf50", l: "#e8f5e9" } },
    { id: "r43", name: "TwoCol Navy", free: false, serif: false, style: "left-bar", layout: "rTwoCol", c: { p: "#0a192f", a: "#4a90d9", l: "#e8f0fe" } },
    { id: "r44", name: "TwoCol Crimson", free: false, serif: false, style: "left-bar", layout: "rTwoCol", c: { p: "#7f1d1d", a: "#ef4444", l: "#fef2f2" } },
    { id: "r45", name: "TwoCol Teal", free: false, serif: false, style: "left-bar", layout: "rTwoCol", c: { p: "#134e4a", a: "#14b8a6", l: "#f0fdfa" } },
    { id: "r46", name: "TwoCol Violet", free: false, serif: false, style: "left-bar", layout: "rTwoCol", c: { p: "#4a148c", a: "#ab47bc", l: "#f3e5f5" } },
    { id: "r47", name: "TwoCol Gold", free: false, serif: false, style: "left-bar", layout: "rTwoCol", c: { p: "#78350f", a: "#d97706", l: "#fffbeb" } },
    { id: "r48", name: "TwoCol Slate", free: false, serif: false, style: "left-bar", layout: "rTwoCol", c: { p: "#1f2937", a: "#64748b", l: "#f9fafb" } },
    { id: "r49", name: "Banner Cobalt", free: false, serif: false, style: "left-bar", layout: "rBanner", c: { p: "#1e3a5f", a: "#3b82f6", l: "#eff6ff" } },
    { id: "r50", name: "Banner Forest", free: false, serif: false, style: "left-bar", layout: "rBanner", c: { p: "#14532d", a: "#22c55e", l: "#f0fdf4" } },
    { id: "r51", name: "Banner Crimson", free: false, serif: false, style: "left-bar", layout: "rBanner", c: { p: "#7f1d1d", a: "#ef4444", l: "#fef2f2" } },
    { id: "r52", name: "Banner Plum", free: false, serif: false, style: "left-bar", layout: "rBanner", c: { p: "#4a0072", a: "#9c27b0", l: "#f3e5f5" } },
    { id: "r53", name: "Banner Teal", free: false, serif: false, style: "left-bar", layout: "rBanner", c: { p: "#134e4a", a: "#14b8a6", l: "#f0fdfa" } },
    { id: "r54", name: "Banner Amber", free: false, serif: false, style: "left-bar", layout: "rBanner", c: { p: "#78350f", a: "#d97706", l: "#fffbeb" } },
    { id: "r55", name: "Banner Slate", free: false, serif: false, style: "left-bar", layout: "rBanner", c: { p: "#0f172a", a: "#64748b", l: "#f8fafc" } },
    { id: "r56", name: "Banner Sage", free: false, serif: false, style: "left-bar", layout: "rBanner", c: { p: "#1a2e05", a: "#65a30d", l: "#ecfccb" } },
  ],
  cover: [
    { id: "c1", name: "Formal", free: true, serif: true, style: "underline", layout: "cFormal", c: { p: "#0c4a6e", a: "#38bdf8", l: "#e0f2fe" } },
    { id: "c2", name: "Formal Forest", free: false, serif: true, style: "underline", layout: "cFormal", c: { p: "#14532d", a: "#22c55e", l: "#f0fdf4" } },
    { id: "c3", name: "Formal Ruby", free: false, serif: true, style: "underline", layout: "cFormal", c: { p: "#7f1d1d", a: "#f87171", l: "#fef2f2" } },
    { id: "c4", name: "Formal Slate", free: false, serif: true, style: "underline", layout: "cFormal", c: { p: "#334155", a: "#94a3b8", l: "#f8fafc" } },
    { id: "c21", name: "Formal Royal", free: false, serif: true, style: "underline", layout: "cFormal", c: { p: "#1a237e", a: "#5c6bc0", l: "#e8eaf6" } },
    { id: "c22", name: "Formal Sage", free: false, serif: true, style: "underline", layout: "cFormal", c: { p: "#1a2e05", a: "#65a30d", l: "#ecfccb" } },
    { id: "c23", name: "Formal Crimson", free: false, serif: true, style: "underline", layout: "cFormal", c: { p: "#7f1d1d", a: "#ef4444", l: "#fef2f2" } },
    { id: "c24", name: "Formal Charcoal", free: false, serif: true, style: "underline", layout: "cFormal", c: { p: "#1f2937", a: "#6b7280", l: "#f9fafb" } },
    { id: "c5", name: "Bold", free: true, serif: false, style: "left-bar", layout: "cBold", c: { p: "#7c2d12", a: "#fb923c", l: "#fff7ed" } },
    { id: "c6", name: "Bold Navy", free: false, serif: false, style: "left-bar", layout: "cBold", c: { p: "#172554", a: "#60a5fa", l: "#eff6ff" } },
    { id: "c7", name: "Bold Teal", free: false, serif: false, style: "left-bar", layout: "cBold", c: { p: "#134e4a", a: "#2dd4bf", l: "#f0fdfa" } },
    { id: "c8", name: "Bold Violet", free: false, serif: false, style: "left-bar", layout: "cBold", c: { p: "#3b0764", a: "#c084fc", l: "#faf5ff" } },
    { id: "c25", name: "Bold Forest", free: false, serif: false, style: "left-bar", layout: "cBold", c: { p: "#052e16", a: "#16a34a", l: "#dcfce7" } },
    { id: "c26", name: "Bold Crimson", free: false, serif: false, style: "left-bar", layout: "cBold", c: { p: "#7f1d1d", a: "#f87171", l: "#fef2f2" } },
    { id: "c27", name: "Bold Slate", free: false, serif: false, style: "left-bar", layout: "cBold", c: { p: "#0f172a", a: "#475569", l: "#f8fafc" } },
    { id: "c28", name: "Bold Plum", free: false, serif: false, style: "left-bar", layout: "cBold", c: { p: "#4a0072", a: "#c084fc", l: "#faf5ff" } },
    { id: "c9", name: "Boxed", free: false, serif: true, style: "underline", layout: "cBoxed", c: { p: "#134e4a", a: "#2dd4bf", l: "#f0fdfa" } },
    { id: "c10", name: "Boxed Cobalt", free: false, serif: true, style: "underline", layout: "cBoxed", c: { p: "#1e3a5f", a: "#60a5fa", l: "#dbeafe" } },
    { id: "c11", name: "Boxed Burgundy", free: false, serif: true, style: "underline", layout: "cBoxed", c: { p: "#4c0519", a: "#f43f5e", l: "#fff1f2" } },
    { id: "c12", name: "Boxed Forest", free: false, serif: true, style: "underline", layout: "cBoxed", c: { p: "#14532d", a: "#4ade80", l: "#f0fdf4" } },
    { id: "c29", name: "Boxed Navy", free: false, serif: true, style: "underline", layout: "cBoxed", c: { p: "#0a192f", a: "#4a90d9", l: "#e8f0fe" } },
    { id: "c30", name: "Boxed Crimson", free: false, serif: true, style: "underline", layout: "cBoxed", c: { p: "#500724", a: "#e11d48", l: "#fff1f2" } },
    { id: "c31", name: "Boxed Sage", free: false, serif: true, style: "underline", layout: "cBoxed", c: { p: "#14532d", a: "#4ade80", l: "#f0fdf4" } },
    { id: "c32", name: "Boxed Amber", free: false, serif: true, style: "underline", layout: "cBoxed", c: { p: "#78350f", a: "#d97706", l: "#fffbeb" } },
    { id: "c13", name: "Split", free: false, serif: false, style: "icon-bar", layout: "cSplit", c: { p: "#153F2A", a: "#2E7D53", l: "#E8F0E9" } },
    { id: "c14", name: "Split Forest", free: false, serif: false, style: "icon-bar", layout: "cSplit", c: { p: "#052e16", a: "#16a34a", l: "#dcfce7" } },
    { id: "c15", name: "Split Amber", free: false, serif: false, style: "icon-bar", layout: "cSplit", c: { p: "#78350f", a: "#fbbf24", l: "#fffbeb" } },
    { id: "c16", name: "Split Charcoal", free: false, serif: false, style: "icon-bar", layout: "cSplit", c: { p: "#1c1917", a: "#78716c", l: "#fafaf9" } },
    { id: "c33", name: "Split Ocean", free: false, serif: false, style: "icon-bar", layout: "cSplit", c: { p: "#0c4a6e", a: "#38bdf8", l: "#e0f2fe" } },
    { id: "c34", name: "Split Crimson", free: false, serif: false, style: "icon-bar", layout: "cSplit", c: { p: "#7f1d1d", a: "#ef4444", l: "#fef2f2" } },
    { id: "c35", name: "Split Sage", free: false, serif: false, style: "icon-bar", layout: "cSplit", c: { p: "#14532d", a: "#65a30d", l: "#ecfccb" } },
    { id: "c36", name: "Split Plum", free: false, serif: false, style: "icon-bar", layout: "cSplit", c: { p: "#3b0764", a: "#2E7D53", l: "#faf5ff" } },
    { id: "c17", name: "Clean", free: true, serif: false, style: "minimal", layout: "cClean", c: { p: "#1e293b", a: "#64748b", l: "#f8fafc" } },
    { id: "c18", name: "Clean Ocean", free: false, serif: false, style: "minimal", layout: "cClean", c: { p: "#0c4a6e", a: "#0284c7", l: "#e0f2fe" } },
    { id: "c19", name: "Clean Sage", free: false, serif: false, style: "minimal", layout: "cClean", c: { p: "#1a2e05", a: "#65a30d", l: "#ecfccb" } },
    { id: "c20", name: "Clean Rose", free: false, serif: false, style: "minimal", layout: "cClean", c: { p: "#4c0519", a: "#fb7185", l: "#fff1f2" } },
    { id: "c37", name: "Clean Teal", free: false, serif: false, style: "minimal", layout: "cClean", c: { p: "#134e4a", a: "#14b8a6", l: "#f0fdfa" } },
    { id: "c38", name: "Clean Crimson", free: false, serif: false, style: "minimal", layout: "cClean", c: { p: "#7f1d1d", a: "#ef4444", l: "#fef2f2" } },
    { id: "c39", name: "Clean Forest", free: false, serif: false, style: "minimal", layout: "cClean", c: { p: "#14532d", a: "#22c55e", l: "#f0fdf4" } },
    { id: "c40", name: "Clean Midnight", free: false, serif: false, style: "minimal", layout: "cClean", c: { p: "#0d1117", a: "#4299e1", l: "#ebf8ff" } },
    { id: "c41", name: "Letter Modern Blue", free: false, serif: false, style: "icon-bar", layout: "cModern", c: { p: "#1e3a8a", a: "#3b82f6", l: "#eff6ff" } },
    { id: "c42", name: "Letter Modern Forest", free: false, serif: false, style: "icon-bar", layout: "cModern", c: { p: "#14532d", a: "#22c55e", l: "#f0fdf4" } },
    { id: "c43", name: "Letter Modern Crimson", free: false, serif: false, style: "icon-bar", layout: "cModern", c: { p: "#7f1d1d", a: "#f87171", l: "#fef2f2" } },
    { id: "c44", name: "Letter Modern Plum", free: false, serif: false, style: "icon-bar", layout: "cModern", c: { p: "#4a0072", a: "#ab47bc", l: "#f3e5f5" } },
    { id: "c45", name: "Letter Modern Teal", free: false, serif: false, style: "icon-bar", layout: "cModern", c: { p: "#134e4a", a: "#2dd4bf", l: "#f0fdfa" } },
    { id: "c46", name: "Letter Modern Amber", free: false, serif: false, style: "icon-bar", layout: "cModern", c: { p: "#78350f", a: "#d97706", l: "#fffbeb" } },
    { id: "c47", name: "Letter Modern Slate", free: false, serif: false, style: "icon-bar", layout: "cModern", c: { p: "#1f2937", a: "#64748b", l: "#f9fafb" } },
    { id: "c48", name: "Letter Modern Cobalt", free: false, serif: false, style: "icon-bar", layout: "cModern", c: { p: "#0c4a6e", a: "#0284c7", l: "#e0f2fe" } },
  ],
};

/** Free templates first, stable within groups (mirrors the old picker). */
export function freeFirst(list: Template[]): Template[] {
  return list.slice().sort((a, b) => (a.free === b.free ? 0 : a.free ? -1 : 1));
}

export function findTemplate(cat: "resume" | "cover", id: string): Template {
  return OUT_TPLS[cat].find((t) => t.id === id) || OUT_TPLS[cat][0];
}

// Human-facing style groups for the picker headings.
export const RESUME_GROUPS: { label: string; layout: ResumeLayout }[] = [
  { label: "Classic", layout: "rClassic" },
  { label: "Executive", layout: "rExecutive" },
  { label: "Modern", layout: "rModern" },
  { label: "Sidebar", layout: "rSidebar" },
  { label: "Minimal", layout: "rMinimal" },
  { label: "Two Column", layout: "rTwoCol" },
  { label: "Banner", layout: "rBanner" },
];
export const COVER_GROUPS: { label: string; layout: CoverLayout }[] = [
  { label: "Formal", layout: "cFormal" },
  { label: "Bold", layout: "cBold" },
  { label: "Boxed", layout: "cBoxed" },
  { label: "Split", layout: "cSplit" },
  { label: "Clean", layout: "cClean" },
  { label: "Letter Modern", layout: "cModern" },
];

// Single-column resume layouts parse cleanly in ATS software; table-based ones
// are best for human readers.
const ATS_SAFE_LAYOUTS: Record<string, number> = { rClassic: 1, rMinimal: 1, rExecutive: 1, rBanner: 1 };
export function isAtsSafe(tpl: Template): boolean {
  return !!ATS_SAFE_LAYOUTS[tpl.layout];
}

// ─── AI output parsing ────────────────────────────────────────────────────────
interface ParsedResume {
  name: string;
  contact: string;
  sections: { title: string; lines: string[] }[];
}

export function parseAIOutput(text: string): ParsedResume {
  const lines = text.split("\n");
  let name = "";
  const contactParts: string[] = [];
  const sections: { title: string; lines: string[] }[] = [];
  let currentSection: { title: string; lines: string[] } | null = null;
  let nameDone = false,
    contactDone = false;
  for (const raw of lines) {
    const t = raw.trim().replace(/^#{1,3}\s+/, "");
    if (/^[-*_]{3,}$/.test(t)) continue;
    const clean = t.replace(/\*\*(.*?)\*\*/g, "$1").replace(/\*(.*?)\*/g, "$1").trim();
    if (!clean) continue;
    if (!nameDone) {
      name = clean;
      nameDone = true;
      continue;
    }
    const isHdr = clean.length >= 2 && clean.length <= 60 && /^[A-Z][A-Z\s&/()\-:.]+$/.test(clean);
    if (isHdr) {
      contactDone = true;
      currentSection = { title: clean, lines: [] };
      sections.push(currentSection);
      continue;
    }
    if (!contactDone) {
      contactParts.push(clean);
      continue;
    }
    if (currentSection) currentSection.lines.push(raw.trim());
  }
  return { name, contact: contactParts.join(" | "), sections };
}

const PBI =
  "page-break-inside:avoid;break-inside:avoid;-webkit-column-break-inside:avoid;overflow-wrap:break-word;word-break:normal;hyphens:none;";
const PCA = "-webkit-print-color-adjust:exact;print-color-adjust:exact;";

function lineHtml(raw: string, c: Colors): string {
  const t = raw.replace(/^#{1,3}\s+/, "").trim();
  const clean = t.replace(/\*\*(.*?)\*\*/g, "$1").replace(/\*(.*?)\*/g, "$1").trim();
  if (!clean) return '<div style="height:5px;"></div>';
  const wasBold = /^\*\*[^*]+\*\*$/.test(raw.trim());
  const isBullet = /^[•·\-*]\s/.test(raw.trim());
  const isDate = (clean.includes("—") || clean.includes("–") || (clean.includes("|") && /\d{4}/.test(clean))) && clean.length < 150;
  if (wasBold && clean.length < 70)
    return `<div style="font-size:13px;font-weight:800;color:#1a1a1a;margin:9px 0 1px;${PBI}">${escHtml(clean)}</div>`;
  if (isBullet) {
    const txt = clean.replace(/^[•·\-*]\s*/, "");
    return `<div style="padding-left:12px;font-size:12px;line-height:1.8;color:#444;margin:2px 0;${PBI}">• ${escHtml(txt)}</div>`;
  }
  if (isDate) return `<div style="font-size:11.5px;color:${c.a};font-weight:700;margin-bottom:4px;${PBI}">${escHtml(clean)}</div>`;
  return `<div style="font-size:12.5px;line-height:1.8;color:#444;${PBI}">${escHtml(clean)}</div>`;
}

function groupedSectionHtml(lines: string[], c: Colors, printMode: boolean, headerHtml?: string, footerHtml?: string): string {
  const grpStyle = printMode ? `display:table;width:100%;${PBI}` : PBI;
  const groups: string[][] = [];
  let cur: string[] = [];
  for (const raw of lines) {
    const clean = raw.replace(/^#{1,3}\s+/, "").replace(/\*\*(.*?)\*\*/g, "$1").replace(/\*(.*?)\*/g, "$1").trim();
    const wasBold = /^\*\*[^*]+\*\*$/.test(raw.trim()) && clean.length < 70;
    if (!clean) {
      if (cur.length) {
        groups.push(cur);
        cur = [];
      }
      continue;
    }
    if (wasBold && cur.length) {
      groups.push(cur);
      cur = [];
    }
    cur.push(raw);
  }
  if (cur.length) groups.push(cur);
  if (groups.length === 0)
    return headerHtml || footerHtml ? `<div style="${grpStyle}">${headerHtml || ""}${footerHtml || ""}</div>` : "";

  if (!printMode) {
    return groups
      .map((g, i) => {
        const pre = i === 0 ? headerHtml || "" : "";
        const suf = i === groups.length - 1 ? footerHtml || "" : "";
        return `<div style="${grpStyle}">${pre}${g.map((r) => lineHtml(r, c)).join("")}${suf}</div>`;
      })
      .join('<div style="height:6px;"></div>');
  }

  const isBullet = (raw: string) => /^[•·\-*]\s/.test(raw.trim());
  const out: string[] = [];
  groups.forEach((g, i) => {
    const pre = i === 0 ? headerHtml || "" : "";
    let k = 0;
    while (k < g.length && !isBullet(g[k])) k++;
    if (k < g.length) k++;
    const head = g.slice(0, k),
      rest = g.slice(k);
    out.push(`<div style="display:table;width:100%;${PBI}">${pre}${head.map((r) => lineHtml(r, c)).join("")}</div>`);
    if (rest.length) out.push(rest.map((r) => lineHtml(r, c)).join(""));
  });
  if (footerHtml) out.push(`<div style="display:table;width:100%;${PBI}">${footerHtml}</div>`);
  return out.join("");
}

const SIDE_KEYS = ["SKILL", "CERTIF", "LICENSE", "LICENS", "EDUCAT", "LANGUAGE", "AWARD", "COMPETENC", "TOOL", "TECHNOLOG", "PROFICIEN"];

function renderSidebarOutput(parsed: ParsedResume, c: Colors, font: string, printMode: boolean, photo?: string, sig = ""): string {
  const { name, contact, sections } = parsed;
  const _np = name.trim().split(/\s+/).filter((w) => w && !/^(jr|sr|ii|iii|iv|v)\.?$/i.test(w));
  const initials = (((_np[0] || name.trim() || "?")[0] || "?") + (_np.length > 1 ? _np[_np.length - 1][0] || "" : "")).toUpperCase();
  const sideSecs: typeof sections = [],
    mainSecs: typeof sections = [];
  for (const sec of sections) (SIDE_KEYS.some((k) => sec.title.toUpperCase().includes(k)) ? sideSecs : mainSecs).push(sec);
  const contactLines = contact.split(/\s*\|\s*/).filter(Boolean);
  const sidebarHtml = sideSecs
    .map(
      (sec) =>
        `<div style="margin-bottom:16px;"><div style="font-size:9px;font-weight:800;text-transform:uppercase;letter-spacing:2px;color:${c.a};margin-bottom:8px;border-bottom:1px solid rgba(255,255,255,.2);padding-bottom:4px;">${escHtml(
          sec.title
        )}</div>${sec.lines
          .map((raw) => {
            const t = raw.replace(/^#{1,3}\s+/, "").replace(/\*\*(.*?)\*\*/g, "$1").replace(/\*(.*?)\*/g, "$1").trim();
            if (!t) return "";
            const txt = t.replace(/^[•·\-*]\s*/, "");
            return `<div style="background:rgba(255,255,255,.13);color:#fff;font-size:11px;padding:4px 10px;border-radius:4px;margin-bottom:5px;">${escHtml(
              txt
            )}</div>`;
          })
          .join("")}</div>`
    )
    .join("");
  const sideHdr = (sec: { title: string }) =>
    `<div style="font-size:10.5px;font-weight:800;text-transform:uppercase;letter-spacing:2px;color:${c.p};margin-bottom:5px;">${escHtml(
      sec.title
    )}</div><div style="width:100%;height:2px;background:${c.a};margin-bottom:10px;border-radius:1px;"></div>`;
  const sideMainSec = (sec: { title: string; lines: string[] }) => {
    const hdr = sideHdr(sec);
    const body = printMode ? groupedSectionHtml(sec.lines, c, printMode, hdr) : hdr + groupedSectionHtml(sec.lines, c, printMode);
    return `<div style="margin-bottom:20px;">${body}</div>`;
  };
  const mainHtml = mainSecs.map((sec) => sideMainSec(sec)).join("");
  const avatarHtml = photo
    ? `<div style="margin:0 auto 14px;width:62px;">${photoHtml(photo, 62, { ring: "rgba(255,255,255,.4)" })}</div>`
    : `<div style="width:62px;height:62px;border-radius:50%;margin:0 auto 14px;background:linear-gradient(135deg,${c.a},${c.p});display:flex;align-items:center;justify-content:center;font-size:22px;font-weight:900;letter-spacing:.5px;color:#fff;box-shadow:0 0 0 3px rgba(255,255,255,.4);${PCA}">${escHtml(
        initials
      )}</div>`;
  const outerStyle = printMode
    ? `font-family:${font};color:#222;display:table;table-layout:fixed;width:100%;`
    : `font-family:${font};background:#fff;color:#222;display:flex;overflow:hidden;box-shadow:0 2px 4px rgba(0,0,0,0.06),0 12px 40px rgba(0,0,0,0.12);`;
  const lColStyle = printMode
    ? `display:table-cell;width:215px;background:${c.p};padding:36px 20px;vertical-align:top;height:100%;${PCA}`
    : `width:215px;background:${c.p};padding:36px 20px;flex-shrink:0;${PCA}`;
  const rColStyle = printMode ? `display:table-cell;padding:36px 30px;vertical-align:top;` : `flex:1;padding:36px 30px;min-width:0;`;
  return `<div style="${outerStyle}"><div style="${lColStyle}">${avatarHtml}<div style="color:#fff;text-align:center;margin-bottom:20px;"><div style="font-size:15px;font-weight:800;line-height:1.3;">${escHtml(
    name
  )}</div></div><div style="margin-bottom:16px;"><div style="font-size:9px;font-weight:800;text-transform:uppercase;letter-spacing:2px;color:${c.a};margin-bottom:8px;border-bottom:1px solid rgba(255,255,255,.2);padding-bottom:4px;">Contact</div><div style="font-size:11px;color:rgba(255,255,255,.85);line-height:1.9;">${contactLines
    .map((l) => `<div>${escHtml(l)}</div>`)
    .join("")}</div></div>${sidebarHtml}</div><div style="${rColStyle}">${mainHtml}${sig}</div></div>`;
}

function renderModernOutput(parsed: ParsedResume, c: Colors, font: string, printMode: boolean, photo?: string, sig = ""): string {
  const { name, contact, sections } = parsed;
  const contactParts = contact.split(/\s*\|\s*/).filter(Boolean);
  const modernHdr = (sec: { title: string }) =>
    `<div style="display:flex;align-items:center;gap:10px;margin-bottom:10px;"><div style="width:4px;height:18px;background:${c.a};border-radius:2px;"></div><span style="font-size:10.5px;font-weight:800;text-transform:uppercase;letter-spacing:2px;color:${c.p};">${escHtml(
      sec.title
    )}</span></div>`;
  const modernSec = (sec: { title: string; lines: string[] }) => {
    const hdr = modernHdr(sec);
    const body = printMode ? groupedSectionHtml(sec.lines, c, printMode, hdr) : hdr + groupedSectionHtml(sec.lines, c, printMode);
    return `<div style="margin-bottom:20px;">${body}</div>`;
  };
  const sectionsHtml = sections.map((sec) => modernSec(sec)).join("");
  const outerStyle = printMode
    ? `font-family:${font};color:#222;`
    : `font-family:${font};background:#fff;color:#222;overflow:hidden;box-shadow:0 2px 4px rgba(0,0,0,0.06),0 12px 40px rgba(0,0,0,0.12);`;
  const modernPhoto = photo ? `<div style="flex-shrink:0;">${photoHtml(photo, 74, { ring: "rgba(255,255,255,.35)" })}</div>` : "";
  return `<div style="${outerStyle}"><div style="background:${c.p};padding:24px 44px;color:#fff;display:flex;align-items:center;justify-content:space-between;gap:20px;${PCA}"><div style="min-width:0;"><div style="font-size:26px;font-weight:900;letter-spacing:-0.5px;line-height:1.2;">${escHtml(
    name
  )}</div><div style="font-size:11.5px;color:rgba(255,255,255,.78);margin-top:6px;display:flex;flex-wrap:wrap;gap:12px;">${contactParts
    .map((s) => `<span>${escHtml(s)}</span>`)
    .join("")}</div></div>${modernPhoto}</div><div style="padding:20px 44px 28px;">${sectionsHtml}${sig}</div></div>`;
}

function renderTwoColOutput(parsed: ParsedResume, c: Colors, font: string, printMode: boolean, photo?: string, sig = ""): string {
  const { name, contact, sections } = parsed;
  const sideSecs: typeof sections = [],
    mainSecs: typeof sections = [];
  for (const sec of sections) (SIDE_KEYS.some((k) => sec.title.toUpperCase().includes(k)) ? sideSecs : mainSecs).push(sec);
  const contactLines = contact.split(/\s*\|\s*/).filter(Boolean);
  const twoColPhoto = photo ? `<div style="margin-bottom:12px;">${photoHtml(photo, 84, { ring: `${c.a}55` })}</div>` : "";
  const leftHtml = `${twoColPhoto}<div style="font-size:17px;font-weight:900;color:${c.p};margin-bottom:5px;line-height:1.2;">${escHtml(
    name
  )}</div><div style="margin-bottom:16px;">${contactLines
    .map((l) => `<div style="font-size:10.5px;color:#555;line-height:1.7;">${escHtml(l)}</div>`)
    .join("")}</div>${sideSecs
    .map(
      (sec) =>
        `<div style="margin-bottom:14px;page-break-inside:avoid;break-inside:avoid;"><div style="font-size:9px;font-weight:800;text-transform:uppercase;letter-spacing:2px;color:${c.p};margin-bottom:5px;padding-bottom:3px;border-bottom:1px solid ${c.a}50;">${escHtml(
          sec.title
        )}</div>${sec.lines
          .map((raw) => {
            const t = raw.replace(/^#{1,3}\s+/, "").replace(/\*\*(.*?)\*\*/g, "$1").replace(/\*(.*?)\*/g, "$1").trim();
            if (!t) return "";
            return `<div style="font-size:10.5px;color:#444;line-height:1.65;page-break-inside:avoid;break-inside:avoid;overflow-wrap:break-word;word-break:normal;hyphens:none;">${escHtml(
              t.replace(/^[•·\-*]\s*/, "")
            )}</div>`;
          })
          .join("")}</div>`
    )
    .join("")}`;
  const twoColHdr = (sec: { title: string }) =>
    `<div style="display:flex;align-items:center;gap:8px;margin-bottom:7px;"><div style="width:18px;height:2px;background:${c.a};border-radius:1px;"></div><span style="font-size:10px;font-weight:800;text-transform:uppercase;letter-spacing:2px;color:${c.p};">${escHtml(
      sec.title
    )}</span></div>`;
  const twoColSec = (sec: { title: string; lines: string[] }) => {
    const hdr = twoColHdr(sec);
    const body = printMode ? groupedSectionHtml(sec.lines, c, printMode, hdr) : hdr + groupedSectionHtml(sec.lines, c, printMode);
    return `<div style="margin-bottom:18px;">${body}</div>`;
  };
  const rightHtml = mainSecs.map((sec) => twoColSec(sec)).join("");
  const outerStyle = printMode
    ? `font-family:${font};color:#222;display:table;table-layout:fixed;width:100%;`
    : `font-family:${font};background:#fff;color:#222;display:flex;overflow:hidden;box-shadow:0 2px 4px rgba(0,0,0,0.06),0 12px 40px rgba(0,0,0,0.12);`;
  const lStyle2 = printMode
    ? `display:table-cell;width:220px;padding:32px 18px 32px 24px;border-right:2px solid ${c.a}35;vertical-align:top;${PCA}`
    : `width:220px;padding:32px 18px 32px 24px;border-right:2px solid ${c.a}35;flex-shrink:0;${PCA}`;
  const rStyle2 = printMode ? `display:table-cell;padding:32px 28px;vertical-align:top;` : `flex:1;padding:32px 28px;min-width:0;`;
  const table = `<div style="${outerStyle}"><div style="${lStyle2}">${leftHtml}</div><div style="${rStyle2}">${rightHtml}</div></div>`;
  // Signature spans the FULL width below both columns (FIX 1).
  if (!sig) return table;
  return `<div style="font-family:${font};">${table}<div style="padding:0 28px 8px;">${sig}</div></div>`;
}

function renderBannerOutput(parsed: ParsedResume, c: Colors, font: string, printMode: boolean, photo?: string, sig = ""): string {
  const { name, contact, sections } = parsed;
  const contactParts = contact.split(/\s*\|\s*/).filter(Boolean);
  const contactHtml = contactParts.map((s, i) => `${i > 0 ? `<span style="color:${c.a};margin:0 8px;">·</span>` : ""}${escHtml(s)}`).join("");
  const bannerHdr = (sec: { title: string }) =>
    `<div style="display:inline-block;background:${c.p};color:#fff;font-size:9px;font-weight:800;text-transform:uppercase;letter-spacing:2px;padding:4px 11px;border-radius:3px;margin-bottom:10px;${PCA}">${escHtml(
      sec.title
    )}</div>`;
  const bannerSec = (sec: { title: string; lines: string[] }) => {
    const hdr = bannerHdr(sec);
    const body = printMode ? groupedSectionHtml(sec.lines, c, printMode, hdr) : hdr + groupedSectionHtml(sec.lines, c, printMode);
    return `<div style="margin-bottom:20px;">${body}</div>`;
  };
  const sectionsHtml = sections.map((sec) => bannerSec(sec)).join("");
  const outerStyle = printMode
    ? `font-family:${font};color:#222;`
    : `font-family:${font};background:#fff;color:#222;overflow:hidden;box-shadow:0 2px 4px rgba(0,0,0,0.06),0 12px 40px rgba(0,0,0,0.12);`;
  const bannerPhoto = photo ? `<div style="flex-shrink:0;">${photoHtml(photo, 76, { ring: `${c.a}55` })}</div>` : "";
  return `<div style="${outerStyle}"><div style="padding:26px 44px 18px;border-left:5px solid ${c.p};display:flex;align-items:center;justify-content:space-between;gap:20px;${PCA}"><div style="min-width:0;"><div style="font-size:28px;font-weight:900;color:${c.p};letter-spacing:-0.5px;">${escHtml(
    name
  )}</div><div style="font-size:11.5px;color:#666;margin-top:7px;">${contactHtml}</div><div style="height:2px;background:linear-gradient(to right,${c.p},${c.a},transparent);margin-top:14px;border-radius:1px;${PCA}"></div></div>${bannerPhoto}</div><div style="padding:18px 44px 32px;">${sectionsHtml}${sig}</div></div>`;
}

// ─── Cover letters ────────────────────────────────────────────────────────────
export interface CoverMeta {
  name?: string;
  email?: string;
  phone?: string;
  location?: string;
  company?: string;
  role?: string;
}

function parseCoverOutput(text: string, meta: CoverMeta = {}) {
  const lines = text.split("\n");
  let name = "",
    contactStr = "",
    headerDone = false;
  const rawBody: string[] = [];
  for (let i = 0; i < lines.length; i++) {
    const t = lines[i]
      .trim()
      .replace(/^#{1,3}\s+/, "")
      .replace(/\*\*(.*?)\*\*/g, "$1")
      .replace(/\*(.*?)\*/g, "$1")
      .trim();
    if (!t) {
      if (name) {
        if (headerDone) rawBody.push("");
        else headerDone = true;
      }
      continue;
    }
    if (!name && /^cover letter$/i.test(t)) continue;
    if (!name) {
      name = t;
      continue;
    }
    if (!headerDone && (t.includes("@") || /\(\d{3}\)|\d{3}[-.\s]\d{3}/.test(t) || (t.includes("|") && t.length < 120))) {
      contactStr = t;
      continue;
    }
    if (!headerDone && /\b(jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)\b/i.test(t) && t.length < 50) {
      headerDone = true;
      continue;
    }
    headerDone = true;
    rawBody.push(t);
  }
  const paragraphs: string[] = [];
  let cur: string[] = [];
  for (const line of rawBody) {
    if (!line) {
      if (cur.length) {
        paragraphs.push(cur.join(" "));
        cur = [];
      }
    } else cur.push(line);
  }
  if (cur.length) paragraphs.push(cur.join(" "));
  const CLOSE_RE = /^(sincerely|best regards|regards|warm regards|respectfully|yours truly|cordially|thank you)[,\s]/i;
  const body = paragraphs.filter((p) => !CLOSE_RE.test(p));
  const today = new Date().toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric" });
  return {
    name: name || meta.name || "Applicant",
    contact: contactStr || [meta.email, meta.phone, meta.location].filter(Boolean).join(" | "),
    company: meta.company || "",
    role: meta.role || "",
    date: today,
    body,
  };
}

function renderCoverModernOutput(text: string, c: Colors, font: string, printMode: boolean, sig = ""): string {
  const lines = text.split("\n");
  let name = "";
  const contactLines: string[] = [];
  let bodyStart = 0,
    headerDone = false;
  for (let i = 0; i < lines.length; i++) {
    const raw = lines[i];
    const t = raw.trim().replace(/^#{1,3}\s+/, "").replace(/\*\*(.*?)\*\*/g, "$1").replace(/\*(.*?)\*/g, "$1").trim();
    if (!t) {
      if (name) {
        headerDone = true;
        bodyStart = i + 1;
      }
      continue;
    }
    if (!name) {
      name = t;
      continue;
    }
    if (!headerDone && (t.includes("@") || /\d{3}/.test(t) || (t.includes("|") && t.length < 120))) {
      contactLines.push(t);
      continue;
    }
    if (!headerDone) {
      headerDone = true;
      bodyStart = i;
    }
    if (headerDone) {
      bodyStart = i;
      break;
    }
  }
  const pbi = "page-break-inside:avoid;break-inside:avoid;overflow-wrap:break-word;word-break:normal;hyphens:none;";
  const lineFmt = (t: string) => `<div style="font-size:13px;line-height:1.85;color:#333;margin-bottom:1px;${pbi}">${escHtml(t)}</div>`;
  const groups: string[][] = [];
  let cur: string[] = [];
  for (let i = bodyStart; i < lines.length; i++) {
    const t = lines[i].trim().replace(/^#{1,3}\s+/, "").replace(/\*\*(.*?)\*\*/g, "$1").replace(/\*(.*?)\*/g, "$1").trim();
    if (!t) {
      if (cur.length) {
        groups.push(cur);
        cur = [];
      }
      continue;
    }
    cur.push(t);
  }
  if (cur.length) groups.push(cur);
  let bodyHtml = "";
  groups.forEach((grp, gi) => {
    const linesHtml = grp.map(lineFmt).join("");
    if (gi > 0) bodyHtml += `<div style="height:7px;"></div>`;
    bodyHtml += linesHtml;
  });
  const outerStyle = printMode
    ? `font-family:${font};color:#222;`
    : `font-family:${font};background:#fff;color:#222;overflow:hidden;box-shadow:0 2px 4px rgba(0,0,0,0.06),0 12px 40px rgba(0,0,0,0.12);`;
  const bodyPad = printMode ? "padding:24px 48px 40px;" : "padding:24px clamp(16px,12%,120px) 0;";
  return `<div style="${outerStyle}"><div style="background:${c.p};padding:24px 44px;color:#fff;${PCA}"><div style="font-size:24px;font-weight:900;letter-spacing:-0.5px;">${escHtml(
    name
  )}</div>${
    contactLines.length
      ? `<div style="font-size:11.5px;color:rgba(255,255,255,.78);margin-top:6px;">${escHtml(contactLines.join(" | "))}</div>`
      : ""
  }</div><div style="${bodyPad}">${bodyHtml}${sig}</div></div>`;
}

function renderCoverOutput(text: string, c: Colors, font: string, printMode: boolean, tpl: Template, meta: CoverMeta, sig = ""): string {
  const p = parseCoverOutput(text, meta);
  const cardWrap = printMode
    ? `font-family:${font};color:#222;`
    : `font-family:${font};background:#fff;color:#222;border-radius:8px;border:1px solid #e5e7eb;overflow:hidden;box-shadow:0 2px 4px rgba(0,0,0,0.06),0 12px 40px rgba(0,0,0,0.12);`;
  const _pbip = "page-break-inside:avoid;break-inside:avoid;-webkit-column-break-inside:avoid;overflow-wrap:break-word;word-break:normal;hyphens:none;";
  const bodyParas = p.body.map((para) => `<p style="font-size:13.5px;line-height:1.9;color:#333;margin:0 0 16px;${_pbip}">${escHtml(para)}</p>`).join("");
  const roleLine = [p.role, p.company].filter(Boolean);

  if (tpl.layout === "cFormal") {
    const hdr = printMode ? "padding:48px 48px 28px;" : "padding:clamp(28px,5%,60px) clamp(20px,8%,76px);";
    return `<div style="${cardWrap}${hdr}">
      <div style="margin-bottom:32px;padding-bottom:18px;border-bottom:1.5px solid ${c.p};${PCA}">
        <div style="font-size:22px;font-weight:700;color:${c.p};">${escHtml(p.name)}</div>
        ${p.contact ? `<div style="font-size:12px;color:#888;margin-top:6px;">${escHtml(p.contact)}</div>` : ""}
      </div>
      <div style="font-size:13px;color:#777;margin-bottom:24px;">${p.date}</div>
      ${
        roleLine.length
          ? `<div style="font-size:14px;font-weight:700;margin-bottom:3px;">${escHtml(p.role)} Hiring Team</div><div style="font-size:13px;color:#666;margin-bottom:28px;">${escHtml(
              p.company
            )}</div>`
          : '<div style="margin-bottom:28px;"></div>'
      }
      <div style="font-size:14.5px;font-weight:700;color:${c.p};margin-bottom:22px;">Dear Hiring Manager,</div>
      ${bodyParas}
      ${sig}
    </div>`;
  }

  if (tpl.layout === "cBold") {
    const boldOuter = printMode
      ? `font-family:${font};color:#222;`
      : `font-family:${font};background:#fff;color:#222;overflow:hidden;box-shadow:0 2px 4px rgba(0,0,0,0.06),0 12px 40px rgba(0,0,0,0.12);`;
    const boldBody = printMode ? "padding:24px 48px 40px;" : "padding:24px clamp(16px,12%,120px) 0;";
    const roleDate = roleLine.length
      ? `<div style="display:flex;justify-content:space-between;align-items:center;background:${c.l};padding:12px 48px;${PCA}"><div><div style="font-size:13px;font-weight:800;color:${c.p};">${escHtml(
          p.role
        )}</div><div style="font-size:12px;color:${c.a};font-weight:700;">${escHtml(p.company)}</div></div><div style="font-size:11.5px;color:#999;">${p.date}</div></div>`
      : `<div style="background:${c.l};padding:10px 48px;font-size:11.5px;color:#888;${PCA}">${p.date}</div>`;
    const boldBodyParas = p.body
      .map(
        (para, i) =>
          `<p style="font-size:13.5px;line-height:1.85;color:#333;margin:0 0 16px;${_pbip}${
            i === 0 ? `border-left:3px solid ${c.a};padding-left:14px;${PCA}` : ""
          }">${escHtml(para)}</p>`
      )
      .join("");
    return `<div style="${boldOuter}">
      <div style="background:${c.p};padding:clamp(20px,4%,32px) clamp(16px,7%,52px) clamp(16px,4%,28px);margin-top:0;${PCA}">
        <div style="font-size:clamp(22px,5%,30px);font-weight:900;color:#fff;letter-spacing:-0.5px;overflow-wrap:break-word;">${escHtml(p.name)}</div>
        ${p.contact ? `<div style="font-size:12px;color:${c.a};margin-top:8px;font-weight:600;overflow-wrap:break-word;">${escHtml(p.contact)}</div>` : ""}
      </div>
      ${roleDate}
      <div style="${boldBody}">
        <div style="font-size:14.5px;font-weight:800;color:${c.p};margin-bottom:22px;">Dear Hiring Manager,</div>
        ${boldBodyParas}
        ${sig}
      </div>
    </div>`;
  }

  if (tpl.layout === "cBoxed") {
    const hdr = printMode ? "padding:48px 48px 28px;" : "padding:clamp(20px,5%,52px);";
    return `<div style="${cardWrap}${hdr}">
      <div style="border:2px solid ${c.p};border-radius:8px;padding:clamp(16px,4%,26px) clamp(16px,4%,34px);margin-bottom:32px;display:flex;justify-content:space-between;align-items:center;gap:12px;${PCA}">
        <div style="min-width:0;">
          <div style="font-size:clamp(17px,4%,23px);font-weight:800;color:${c.p};overflow-wrap:break-word;">${escHtml(p.name)}</div>
          ${p.contact ? `<div style="font-size:12px;color:#777;margin-top:5px;overflow-wrap:break-word;">${escHtml(p.contact)}</div>` : ""}
        </div>
        <div style="width:46px;height:46px;border-radius:50%;background:${c.p};display:flex;align-items:center;justify-content:center;color:#fff;font-size:20px;font-weight:900;flex-shrink:0;${PCA}">${escHtml(
          (p.name[0] || "A").toUpperCase()
        )}</div>
      </div>
      <div style="font-size:12px;color:#aaa;margin-bottom:4px;">${p.date}</div>
      ${roleLine.length ? `<div style="font-size:13.5px;color:#555;margin-bottom:26px;">${escHtml(roleLine.join(" — "))}</div>` : '<div style="margin-bottom:26px;"></div>'}
      <div style="font-size:14.5px;font-weight:700;color:${c.p};border-bottom:1px solid ${c.a};padding-bottom:7px;margin-bottom:22px;">Dear Hiring Manager,</div>
      ${bodyParas}
      ${sig}
    </div>`;
  }

  if (tpl.layout === "cSplit") {
    const splitOuter = printMode
      ? `font-family:${font};color:#222;`
      : `font-family:${font};background:#fff;color:#222;overflow:hidden;box-shadow:0 2px 4px rgba(0,0,0,0.06),0 12px 40px rgba(0,0,0,0.12);`;
    const splitBody = printMode ? "padding:24px 48px 40px;" : "padding:24px clamp(16px,12%,120px) 0;";
    const roleInfo = roleLine.length
      ? `<div style="text-align:right;"><div style="font-size:11px;font-weight:700;text-transform:uppercase;letter-spacing:1px;color:rgba(255,255,255,0.7);">${p.date}</div><div style="font-size:14px;font-weight:800;color:#fff;margin-top:4px;">${escHtml(
          p.role
        )}</div><div style="font-size:12px;color:${c.a};">${escHtml(p.company)}</div></div>`
      : `<div style="font-size:11.5px;color:rgba(255,255,255,0.7);">${p.date}</div>`;
    return `<div style="${splitOuter}">
      <div style="background:${c.p};display:flex;align-items:stretch;flex-wrap:wrap;margin-top:0;${PCA}">
        <div style="padding:clamp(20px,4%,32px) clamp(16px,5%,40px) clamp(16px,4%,28px);flex:1;min-width:0;">
          <div style="font-size:clamp(20px,4%,30px);font-weight:900;color:#fff;letter-spacing:-0.5px;overflow-wrap:break-word;">${escHtml(p.name)}</div>
          ${p.contact ? `<div style="font-size:11.5px;color:rgba(255,255,255,0.75);margin-top:10px;line-height:1.6;overflow-wrap:break-word;">${escHtml(p.contact)}</div>` : ""}
        </div>
        <div style="padding:clamp(16px,4%,32px) clamp(16px,4%,32px);display:flex;flex-direction:column;justify-content:center;">${roleInfo}</div>
        <div style="width:8px;background:${c.a};flex-shrink:0;${PCA}"></div>
      </div>
      <div style="${splitBody}">
        <div style="font-size:14.5px;font-weight:700;color:${c.p};margin-bottom:22px;">Dear Hiring Manager,</div>
        ${bodyParas}
        ${sig}
      </div>
    </div>`;
  }

  if (tpl.layout === "cClean") {
    const contactParts = p.contact ? p.contact.split(/\s*\|\s*/) : [];
    const contactHtml = contactParts.length
      ? `<div style="display:flex;gap:14px;margin-top:9px;flex-wrap:wrap;">${contactParts
          .map((pt) => `<span style="font-size:12px;color:${c.a};font-weight:700;">${escHtml(pt)}</span>`)
          .join('<span style="font-size:12px;color:#aaa;">|</span>')}</div>`
      : "";
    const cleanBodyParas = p.body.map((para) => `<p style="font-size:13.5px;line-height:1.9;color:#333;margin:0 0 19px;${_pbip}">${escHtml(para)}</p>`).join("");
    const hdr = printMode ? "padding:48px 48px 28px;" : "padding:clamp(28px,6%,76px) clamp(20px,7%,76px);";
    const cleanWrap = printMode
      ? `font-family:${font};background:${c.l};color:#222;${PCA}`
      : `font-family:${font};background:${c.l};color:#222;border-radius:8px;border:1px solid #e5e7eb;overflow:hidden;box-shadow:0 2px 4px rgba(0,0,0,0.06),0 12px 40px rgba(0,0,0,0.12);${PCA}`;
    return `<div style="${cleanWrap}${hdr}">
      <div style="margin-bottom:44px;">
        <div style="font-size:34px;font-weight:900;letter-spacing:-1.5px;color:${c.p};">${escHtml(p.name)}</div>
        ${contactHtml}
        <div style="height:2px;background:${c.a};margin-top:18px;${PCA}"></div>
      </div>
      <div style="font-size:11.5px;color:${c.p};text-transform:uppercase;letter-spacing:1.5px;margin-bottom:26px;opacity:0.7;">${p.date}</div>
      ${roleLine.length ? `<div style="font-size:16px;font-weight:700;color:${c.p};margin-bottom:26px;">Re: ${escHtml(roleLine.join(" — "))}</div>` : ""}
      ${cleanBodyParas}
      ${sig}
    </div>`;
  }

  return renderCoverModernOutput(text, c, font, printMode, sig);
}

// ─── Top-level renderer (faithful port of renderAIOutput) ─────────────────────
export interface RenderOptions {
  docFont?: string; // body-font key into FONT_MAP; default derives from tpl.serif
  printMode?: boolean; // strip on-screen card chrome for print/PDF
  coverMeta?: CoverMeta; // company/role hints for cover letters
  photo?: string; // data URL — rendered into the template header (FIX 7 #1)
  signature?: string; // typed signature text, rendered in sigFont (FIX 7 #2)
  sigFont?: string; // key into SIG_FONT_MAP for the signature
}

/**
 * Signature sign-off block (FIX 7 #2). Returns just the inner block — the top
 * margin gives it space, and it carries NO horizontal padding so each layout can
 * drop it into the right container (the main column on a sidebar, full width
 * below a two-column grid, the content area otherwise) and it inherits that
 * container's padding. This is what keeps the signature flowing with the
 * document instead of floating over a template (FIX 1). For cover letters it
 * reads as a "Sincerely," close.
 */
function sigBlock(signature: string, sigFontKey: string | undefined, color: string, isCover: boolean): string {
  const f = (sigFontKey && SIG_FONT_MAP[sigFontKey]) || "'Dancing Script','Segoe Script',cursive";
  const close = isCover ? `<div style="font-size:13.5px;color:#333;margin-bottom:6px;">Sincerely,</div>` : "";
  return `<div style="margin-top:26px;${PBI}">${close}<div style="font-family:${f};font-size:30px;line-height:1.1;color:${color};">${escHtml(
    signature
  )}</div><div style="width:180px;border-bottom:1px solid #cbd5e1;margin-top:5px;"></div></div>`;
}

export function renderAIOutput(text: string, tplId: string, mode: Mode, opts: RenderOptions = {}): string {
  const printMode = !!opts.printMode;
  const cat: "resume" | "cover" = mode === "cover_letter" ? "cover" : "resume";
  const tpl = findTemplate(cat, tplId);
  const c = tpl.c;
  const font = (opts.docFont && FONT_MAP[opts.docFont]) || (tpl.serif ? "Georgia,'Times New Roman',serif" : "Arial,sans-serif");
  const sig = opts.signature && opts.signature.trim() ? sigBlock(opts.signature.trim(), opts.sigFont, c.p, cat === "cover") : "";

  if (tpl.layout === "cModern") return renderCoverModernOutput(text, c, font, printMode, sig);
  if (cat === "cover") return renderCoverOutput(text, c, font, printMode, tpl, opts.coverMeta || {}, sig);

  const parsed = parseAIOutput(text);
  if (tpl.layout === "rSidebar") return renderSidebarOutput(parsed, c, font, printMode, opts.photo, sig);
  if (tpl.layout === "rModern") return renderModernOutput(parsed, c, font, printMode, opts.photo, sig);
  if (tpl.layout === "rTwoCol") return renderTwoColOutput(parsed, c, font, printMode, opts.photo, sig);
  if (tpl.layout === "rBanner") return renderBannerOutput(parsed, c, font, printMode, opts.photo, sig);

  // Linear layout (Classic, Executive, Minimal)
  const lines = text.split("\n");
  let html = "";
  let firstLine = true;
  const _grpStyle = printMode ? `display:table;width:100%;${PBI}` : PBI;
  let _grpOpen = false;
  const openGrp = () => {
    if (!_grpOpen) {
      html += `<div style="${_grpStyle}">`;
      _grpOpen = true;
    }
  };
  const closeGrp = () => {
    if (_grpOpen) {
      html += "</div>";
      _grpOpen = false;
    }
  };
  for (let i = 0; i < lines.length; i++) {
    const raw = lines[i];
    let t = raw.trim().replace(/^#{1,3}\s+/, "");
    if (/^[-*_]{3,}$/.test(t)) continue;
    const wasBold = /^\*\*[^*]+\*\*$/.test(raw.trim());
    t = t.replace(/\*\*(.*?)\*\*/g, "$1").replace(/\*(.*?)\*/g, "$1");
    if (!t) {
      closeGrp();
      html += `<div style="height:7px;"></div>`;
      continue;
    }
    if (firstLine) {
      firstLine = false;
      if (tpl.style === "minimal") html += `<div style="font-size:22px;font-weight:300;letter-spacing:4px;text-transform:uppercase;color:#111827;margin-bottom:3px;">${escHtml(t)}</div>`;
      else if (tpl.style === "left-bar") html += `<div style="border-left:4px solid ${c.p};padding-left:13px;font-size:28px;font-weight:800;color:${c.p};letter-spacing:-0.5px;margin-bottom:4px;">${escHtml(t)}</div>`;
      else if (tpl.style === "underline") html += `<div style="text-align:center;font-size:28px;font-weight:800;color:${c.p};letter-spacing:-0.5px;margin-bottom:3px;">${escHtml(t)}</div>`;
      else html += `<div style="font-size:28px;font-weight:800;color:${c.p};letter-spacing:-0.5px;margin-bottom:4px;">${escHtml(t)}</div>`;
      continue;
    }
    if ((t.includes("@") || /\(\d{3}\)/.test(t) || (t.includes("|") && t.length < 80 && !/\d{4}/.test(t))) && t.length < 120) {
      if (tpl.style === "underline") html += `<div style="text-align:center;font-size:12px;color:#666;margin-bottom:14px;letter-spacing:0.3px;border-bottom:1.5px solid ${c.p};padding-bottom:10px;">${escHtml(t)}</div>`;
      else if (tpl.style === "left-bar") html += `<div style="border-left:4px solid ${c.p};padding-left:13px;font-size:12px;color:#666;margin-bottom:14px;letter-spacing:0.3px;">${escHtml(t)}</div>`;
      else if (tpl.style === "minimal") html += `<div style="font-size:12px;color:#6b7280;margin-bottom:6px;letter-spacing:0.3px;">${escHtml(t)}</div><div style="width:100%;height:1px;background:${c.p};margin-bottom:16px;"></div>`;
      else html += `<div style="font-size:12px;color:#666;margin-bottom:14px;letter-spacing:0.3px;">${escHtml(t)}</div>`;
      continue;
    }
    const isHdr = t.length >= 2 && t.length <= 50 && /^[A-Z][A-Z\s&/()\-:.]+$/.test(t);
    if (isHdr) {
      closeGrp();
      if (tpl.style === "left-bar") html += `<div style="font-size:11px;font-weight:800;text-transform:uppercase;letter-spacing:2px;color:${c.p};border-left:3px solid ${c.a};padding-left:12px;margin:24px 0 12px;">${escHtml(t)}</div>`;
      else if (tpl.style === "icon-bar") html += `<div style="display:flex;align-items:center;gap:8px;margin:24px 0 12px;"><div style="width:3px;height:14px;background:${c.a};border-radius:2px;"></div><span style="font-size:11px;font-weight:800;text-transform:uppercase;letter-spacing:2px;color:${c.p};">${escHtml(t)}</span></div>`;
      else if (tpl.style === "minimal") html += `<div style="font-size:10px;font-weight:800;text-transform:uppercase;letter-spacing:3px;color:${c.p};margin:24px 0 12px;">${escHtml(t)}</div>`;
      else html += `<div style="margin-top:24px;"></div><div style="font-size:11px;font-weight:800;text-transform:uppercase;letter-spacing:2px;color:${c.p};border-bottom:1.5px solid ${c.a};padding-bottom:5px;margin-bottom:12px;">${escHtml(t)}</div>`;
      continue;
    }
    if (wasBold && t.length < 70) {
      closeGrp();
      openGrp();
      html += `<div style="font-size:14px;font-weight:800;color:#111827;margin:14px 0 2px;${PBI}">${escHtml(t)}</div>`;
      continue;
    }
    if (/^[•·\-*]\s/.test(raw.trim())) {
      openGrp();
      const txt = t.replace(/^[•·\-*]\s*/, "");
      html += `<div style="padding-left:16px;font-size:13.5px;line-height:1.85;color:#374151;margin:3px 0;${PBI}">• ${escHtml(txt)}</div>`;
      continue;
    }
    if ((t.includes("—") || t.includes("–") || (t.includes("|") && /\d{4}/.test(t))) && t.length < 150) {
      html += `<div style="font-size:12px;color:${c.a};font-weight:600;margin-bottom:8px;${PBI}">${escHtml(t)}</div>`;
      continue;
    }
    html += `<div style="font-size:13px;line-height:1.75;color:#333;${PBI}">${escHtml(t)}</div>`;
  }
  closeGrp();
  html = html.replace(/\x00/g, "");
  // Photo (FIX 7 #1): a circular headshot above the name. Centered for the
  // centered/minimal headers, left-aligned for the left-bar (Executive) header.
  if (opts.photo) {
    const align = tpl.style === "left-bar" ? "left" : "center";
    const mx = align === "center" ? "margin:0 auto 14px;" : "margin:0 0 14px;";
    html = `<div style="text-align:${align};${PBI}"><div style="display:inline-block;${mx}">${photoHtml(opts.photo, 92, { ring: `${c.a}55` })}</div></div>` + html;
  }
  if (sig) html += sig; // flows at the bottom of the content, inside the card
  const bg = tpl.style === "minimal" ? "#fafafa" : "#fff";
  if (printMode) return `<div style="font-family:${font};background:${bg};color:#222;padding:0 0 28px 0;">${html}</div>`;
  return `<div style="font-family:${font};background:${bg};padding:52px 64px;color:#222;border-radius:4px;border:none;box-shadow:0 1px 3px rgba(0,0,0,0.06),0 8px 32px rgba(0,0,0,0.1);">${html}</div>`;
}
