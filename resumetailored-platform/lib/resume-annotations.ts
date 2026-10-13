/**
 * Pure model for resume annotations (highlights + notes) — no database, no network, no React — so the API
 * routes, the viewer's overlay and the tests all share one definition of "a valid annotation".
 *
 * Coordinates are PAGE-NORMALISED: x/y/w/h are fractions (0..1) of the page's width and height, origin at the
 * top-left. That is what lets an annotation survive zoom, a phone vs a desktop, and a renderer swap — it is
 * about the page, not about any one canvas. A highlight is a rectangle; a note is a pin (w = h = 0).
 */
export const ANNOTATION_COLORS = ["yellow", "green", "blue", "pink"] as const;
export type AnnotationColor = (typeof ANNOTATION_COLORS)[number];
export const ANNOTATION_KINDS = ["highlight", "note"] as const;
export type AnnotationKind = (typeof ANNOTATION_KINDS)[number];

export const MAX_NOTE_CHARS = 2000;
/** A runaway client can't turn one resume into an unbounded table. */
export const MAX_ANNOTATIONS_PER_RESUME = 500;
/** A signed resume URL lives this long — long enough to load the file, short enough that a leaked link is useless. */
export const SIGNED_URL_TTL_SECONDS = 60;

export interface ResumeAnnotation {
  id: string;
  candidateResumeId: string;
  page: number;
  x: number;
  y: number;
  w: number;
  h: number;
  kind: AnnotationKind;
  text: string;
  color: AnnotationColor;
  createdBy: string;
  createdAt: string;
  updatedAt?: string;
}

export interface AnnotationInput {
  page: number;
  x: number;
  y: number;
  w: number;
  h: number;
  kind: AnnotationKind;
  text: string;
  color: AnnotationColor;
}

export type ParseResult<T> = { ok: true; value: T } | { ok: false; error: string };

const isNum = (v: unknown): v is number => typeof v === "number" && Number.isFinite(v);
const clamp01 = (n: number) => Math.min(1, Math.max(0, n));

export function isAnnotationColor(v: unknown): v is AnnotationColor {
  return typeof v === "string" && (ANNOTATION_COLORS as readonly string[]).includes(v);
}
export function isAnnotationKind(v: unknown): v is AnnotationKind {
  return typeof v === "string" && (ANNOTATION_KINDS as readonly string[]).includes(v);
}

/**
 * Validate and normalise a create payload. Coordinates outside 0..1 are CLAMPED (a drag that ends a hair past the
 * page edge is a normal gesture, not an error); a box that would run off the page is shrunk to fit. Anything that
 * is not a finite number, an unknown kind/colour, or a page < 1 is refused.
 */
export function parseAnnotationInput(body: unknown): ParseResult<AnnotationInput> {
  const b = (body && typeof body === "object" ? body : {}) as Record<string, unknown>;
  if (!isAnnotationKind(b.kind)) return { ok: false, error: "bad_kind" };
  if (!isNum(b.page) || !Number.isInteger(b.page) || b.page < 1 || b.page > 10000) return { ok: false, error: "bad_page" };
  if (!isNum(b.x) || !isNum(b.y)) return { ok: false, error: "bad_coordinates" };
  const color = b.color === undefined ? "yellow" : b.color;
  if (!isAnnotationColor(color)) return { ok: false, error: "bad_color" };
  const text = b.text === undefined || b.text === null ? "" : b.text;
  if (typeof text !== "string") return { ok: false, error: "bad_text" };
  if (text.length > MAX_NOTE_CHARS) return { ok: false, error: "text_too_long" };

  const x = clamp01(b.x);
  const y = clamp01(b.y);
  let w = 0;
  let h = 0;
  if (b.kind === "highlight") {
    if (!isNum(b.w) || !isNum(b.h)) return { ok: false, error: "bad_coordinates" };
    w = Math.min(clamp01(b.w), 1 - x);
    h = Math.min(clamp01(b.h), 1 - y);
    // A click, not a drag: too small to be a highlight anyone can see or grab.
    if (w < 0.005 || h < 0.003) return { ok: false, error: "too_small" };
  } else if (!text.trim()) {
    return { ok: false, error: "empty_note" };
  }
  return { ok: true, value: { page: b.page, x, y, w, h, kind: b.kind, text: text.trim(), color } };
}

export interface AnnotationPatch {
  text?: string;
  color?: AnnotationColor;
  x?: number;
  y?: number;
  w?: number;
  h?: number;
}

/** A patch may change the text, the colour, or move/resize the box. Page, kind and owner are immutable. */
export function parseAnnotationPatch(body: unknown): ParseResult<AnnotationPatch> {
  const b = (body && typeof body === "object" ? body : {}) as Record<string, unknown>;
  const out: AnnotationPatch = {};
  if (b.text !== undefined) {
    if (typeof b.text !== "string") return { ok: false, error: "bad_text" };
    if (b.text.length > MAX_NOTE_CHARS) return { ok: false, error: "text_too_long" };
    out.text = b.text.trim();
  }
  if (b.color !== undefined) {
    if (!isAnnotationColor(b.color)) return { ok: false, error: "bad_color" };
    out.color = b.color;
  }
  for (const k of ["x", "y", "w", "h"] as const) {
    if (b[k] === undefined) continue;
    const v = b[k];
    if (!isNum(v)) return { ok: false, error: "bad_coordinates" };
    out[k] = clamp01(v);
  }
  if (out.x !== undefined && out.w !== undefined) out.w = Math.min(out.w, 1 - out.x);
  if (out.y !== undefined && out.h !== undefined) out.h = Math.min(out.h, 1 - out.y);
  if (!Object.keys(out).length) return { ok: false, error: "nothing_to_update" };
  return { ok: true, value: out };
}

/** Where a storage path may point: the caller's OWN folder of the private bucket, and a PDF. */
export function isOwnResumePath(employerId: string, path: unknown): path is string {
  if (typeof path !== "string" || !employerId) return false;
  if (path.includes("..") || path.includes("//") || path.startsWith("/")) return false;
  return path.startsWith(`${employerId}/resume/`) && /\.pdf$/i.test(path) && path.length < 300;
}

/** CSS colours for the four swatches. Highlights are drawn translucent over the page (multiply), notes as solid pins. */
export const ANNOTATION_SWATCH: Record<AnnotationColor, { fill: string; solid: string }> = {
  yellow: { fill: "rgba(250, 204, 21, 0.45)", solid: "#facc15" },
  green: { fill: "rgba(74, 222, 128, 0.40)", solid: "#4ade80" },
  blue: { fill: "rgba(96, 165, 250, 0.40)", solid: "#60a5fa" },
  pink: { fill: "rgba(244, 114, 182, 0.40)", solid: "#f472b6" },
};
