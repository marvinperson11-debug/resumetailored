import { inflateSync } from "zlib";
import JSZip from "jszip";
import { ACCENT } from "../docs/docx-render";

/**
 * Checks shared by the WordCraft pilot path (lib/docs/pdf.ts) and scripts/benchmark-wordcraft.cjs, so the
 * route and the benchmark judge a WordCraft PDF by the same rules: decode a page PNG, count Professional-navy
 * pixels, and know from the .docx whether that accent should be on the page at all.
 */

export interface Rgba { width: number; height: number; data: Uint8Array }

const PNG_SIG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

/** 8-bit, non-interlaced RGB/RGBA PNG (what PdfCraft writes) -> RGBA pixels. Anything else throws. */
export function decodePng(buf: Buffer): Rgba {
  if (buf.length < 8 || !buf.subarray(0, 8).equals(PNG_SIG)) throw new Error("not_png");
  let pos = 8;
  let width = 0, height = 0, depth = 0, color = 0, interlace = 0;
  const idat: Buffer[] = [];
  while (pos + 8 <= buf.length) {
    const len = buf.readUInt32BE(pos);
    const type = buf.toString("ascii", pos + 4, pos + 8);
    const chunk = buf.subarray(pos + 8, pos + 8 + len);
    if (type === "IHDR") { width = chunk.readUInt32BE(0); height = chunk.readUInt32BE(4); depth = chunk[8]; color = chunk[9]; interlace = chunk[12]; }
    else if (type === "IDAT") idat.push(chunk);
    else if (type === "IEND") break;
    pos += 12 + len;
  }
  if (depth !== 8 || (color !== 6 && color !== 2) || interlace !== 0 || !width || !height) throw new Error("unsupported_png");
  const bpp = color === 6 ? 4 : 3;
  const stride = width * bpp;
  const raw = inflateSync(Buffer.concat(idat));
  if (raw.length < height * (stride + 1)) throw new Error("truncated_png");
  const data = new Uint8Array(width * height * 4);
  let prev = new Uint8Array(stride);
  let cur = new Uint8Array(stride);
  for (let y = 0; y < height; y++) {
    const off = y * (stride + 1);
    const filter = raw[off];
    for (let i = 0; i < stride; i++) {
      const x = raw[off + 1 + i];
      const a = i >= bpp ? cur[i - bpp] : 0;
      const b = prev[i];
      const c = i >= bpp ? prev[i - bpp] : 0;
      let v = x;
      if (filter === 1) v = x + a;
      else if (filter === 2) v = x + b;
      else if (filter === 3) v = x + ((a + b) >> 1);
      else if (filter === 4) {
        const p = a + b - c, pa = Math.abs(p - a), pb = Math.abs(p - b), pc = Math.abs(p - c);
        v = x + (pa <= pb && pa <= pc ? a : pb <= pc ? b : c);
      }
      cur[i] = v & 255;
    }
    for (let px = 0; px < width; px++) {
      const o = (y * width + px) * 4;
      data[o] = cur[px * bpp];
      data[o + 1] = cur[px * bpp + 1];
      data[o + 2] = cur[px * bpp + 2];
      data[o + 3] = bpp === 4 ? cur[px * bpp + 3] : 255;
    }
    [prev, cur] = [cur, prev];
  }
  return { width, height, data };
}

/** Pixel i composited over white (a transparent page background is white paper). */
export function pixel(img: Rgba, i: number): [number, number, number] {
  const o = i * 4;
  const a = img.data[o + 3] / 255;
  return [img.data[o] * a + 255 * (1 - a), img.data[o + 1] * a + 255 * (1 - a), img.data[o + 2] * a + 255 * (1 - a)];
}

/** Pixels within `tol` (sum of channel differences) of the Professional navy (#1F3A5F). */
export function accentPixels(img: Rgba, hex = ACCENT, tol = 60): number {
  const r = parseInt(hex.slice(0, 2), 16), g = parseInt(hex.slice(2, 4), 16), b = parseInt(hex.slice(4, 6), 16);
  let n = 0;
  for (let i = 0; i < img.width * img.height; i++) {
    const [pr, pg, pb] = pixel(img, i);
    if (Math.abs(pr - r) + Math.abs(pg - g) + Math.abs(pb - b) <= tol) n++;
  }
  return n;
}

/** At 72 dpi a resume's 16pt navy name alone is several hundred pixels; a page without the accent has ~0. */
export const ACCENT_MIN_PIXELS = 40;

/**
 * Accent elements down a page: runs of rows holding navy pixels, with a section heading and its rule merged
 * into one band (gap <= 14 rows at 72 dpi). Glyph weight differs between fonts, so pixel COUNTS differ between
 * two faithful renders; the number of navy elements (name + one per section heading) does not.
 */
export function accentBands(img: Rgba, hex = ACCENT, tol = 60, gap = 14): number {
  const r = parseInt(hex.slice(0, 2), 16), g = parseInt(hex.slice(2, 4), 16), b = parseInt(hex.slice(4, 6), 16);
  let bands = 0, last = -Infinity;
  for (let y = 0; y < img.height; y++) {
    let n = 0;
    for (let x = 0; x < img.width && n < 3; x++) {
      const [pr, pg, pb] = pixel(img, y * img.width + x);
      if (Math.abs(pr - r) + Math.abs(pg - g) + Math.abs(pb - b) <= tol) n++;
    }
    if (n < 3) continue;
    if (y - last > gap) bands++;
    last = y;
  }
  return bands;
}

/** Does this .docx put text in the accent styles (Title = the name, Heading1 = section headings)? */
export async function docxExpectsAccent(docx: Buffer): Promise<boolean> {
  const zip = await JSZip.loadAsync(docx);
  const xml = (await zip.file("word/document.xml")?.async("string")) || "";
  return /<w:pStyle w:val="(Title|Heading1)"\/>/.test(xml);
}
