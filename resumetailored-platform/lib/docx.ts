"use client";

/**
 * Client-side .docx (Office Open XML) generator — zero dependencies, no server
 * cost. It writes a minimal OOXML package (a store-only ZIP built by hand) so it
 * adds only a few KB to the bundle rather than the ~hundreds of KB the `docx`
 * npm package would. The output opens correctly in Microsoft Word, Google Docs,
 * and Apple Pages.
 *
 * It mirrors the on-screen resume structure via the same `parseAIOutput` the
 * HTML/PDF renderers use: the template's primary colour drives the name +
 * section headers, the accent colour underlines each section, the chosen body
 * font is applied throughout, and the photo + signature are embedded. Word
 * cannot reproduce every CSS layout (sidebars, columns), so this is a clean
 * single-column document (also the most ATS-friendly) — the PDF stays the
 * pixel-faithful export; see the in-app download disclaimer.
 */
import { findTemplate, parseAIOutput, type Mode } from "./resume-templates";

// docFont key → a Word-standard font that approximates it.
const WORD_FONT: Record<string, string> = {
  arial: "Arial",
  helvetica: "Arial",
  calibri: "Calibri",
  times: "Times New Roman",
  georgia: "Georgia",
  garamond: "Garamond",
  cambria: "Cambria",
};

const hex = (c: string) => c.replace(/^#/, "").toUpperCase();
const esc = (s: string) =>
  s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&apos;");
const clean = (raw: string) =>
  raw.replace(/^#{1,3}\s+/, "").replace(/\*\*(.*?)\*\*/g, "$1").replace(/\*(.*?)\*/g, "$1").trim();

interface RunOpts {
  bold?: boolean;
  italics?: boolean;
  caps?: boolean;
  size?: number; // half-points (e.g. 21 = 10.5pt), matching the docx lib scale
  color?: string; // 6-hex, no #
  font: string;
}
function run(text: string, o: RunOpts): string {
  const rpr =
    `<w:rPr>` +
    `<w:rFonts w:ascii="${esc(o.font)}" w:hAnsi="${esc(o.font)}" w:cs="${esc(o.font)}"/>` +
    (o.bold ? "<w:b/>" : "") +
    (o.italics ? "<w:i/>" : "") +
    (o.caps ? "<w:caps/>" : "") +
    (o.color ? `<w:color w:val="${o.color}"/>` : "") +
    (o.size ? `<w:sz w:val="${o.size}"/><w:szCs w:val="${o.size}"/>` : "") +
    `</w:rPr>`;
  return `<w:r>${rpr}<w:t xml:space="preserve">${esc(text)}</w:t></w:r>`;
}

interface ParaOpts {
  before?: number; // twips
  after?: number; // twips
  bottomBorder?: { size: number; color: string; space?: number }; // size in 1/8 pt
  indent?: { left: number; hanging?: number }; // twips
  align?: "center" | "left" | "right";
}
function para(runsXml: string, o: ParaOpts = {}): string {
  const spacing = `<w:spacing${o.before != null ? ` w:before="${o.before}"` : ""}${o.after != null ? ` w:after="${o.after}"` : ""}/>`;
  const border = o.bottomBorder
    ? `<w:pBdr><w:bottom w:val="single" w:sz="${o.bottomBorder.size}" w:space="${o.bottomBorder.space ?? 1}" w:color="${o.bottomBorder.color}"/></w:pBdr>`
    : "";
  const indent = o.indent ? `<w:ind w:left="${o.indent.left}"${o.indent.hanging ? ` w:hanging="${o.indent.hanging}"` : ""}/>` : "";
  const jc = o.align ? `<w:jc w:val="${o.align}"/>` : "";
  return `<w:p><w:pPr>${spacing}${border}${indent}${jc}</w:pPr>${runsXml}</w:p>`;
}

interface Photo {
  bytes: Uint8Array;
  ext: "png" | "jpg";
  mime: string;
}

/** Decode a data: URL photo into raw bytes; returns null for anything Word
 *  can't embed (e.g. webp) so the document is never corrupt. */
function decodePhoto(dataUrl?: string): Photo | null {
  if (!dataUrl) return null;
  const m = /^data:image\/(png|jpe?g);base64,(.+)$/i.exec(dataUrl);
  if (!m) return null;
  try {
    const bin = atob(m[2]);
    const bytes = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
    const isJpg = m[1].toLowerCase().startsWith("jp");
    return { bytes, ext: isJpg ? "jpg" : "png", mime: isJpg ? "image/jpeg" : "image/png" };
  } catch {
    return null;
  }
}

/** Build word/document.xml from the parsed resume. */
function buildDocumentXml(text: string, tplId: string, opts: { photo: Photo | null; signature?: string; docFont?: string }): string {
  const tpl = findTemplate("resume", tplId);
  const font = WORD_FONT[opts.docFont || ""] || (tpl.serif ? "Georgia" : "Arial");
  const primary = hex(tpl.c.p);
  const accent = hex(tpl.c.a);
  const parsed = parseAIOutput(text);
  const body: string[] = [];

  // Photo — an inline ~1" square, centered (Word can't circle-crop).
  if (opts.photo) {
    const emu = 914400; // 1 inch
    const drawing =
      `<w:drawing><wp:inline distT="0" distB="0" distL="0" distR="0">` +
      `<wp:extent cx="${emu}" cy="${emu}"/>` +
      `<wp:docPr id="1" name="Photo"/>` +
      `<a:graphic xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main">` +
      `<a:graphicData uri="http://schemas.openxmlformats.org/drawingml/2006/picture">` +
      `<pic:pic xmlns:pic="http://schemas.openxmlformats.org/drawingml/2006/picture">` +
      `<pic:nvPicPr><pic:cNvPr id="1" name="Photo"/><pic:cNvPicPr/></pic:nvPicPr>` +
      `<pic:blipFill><a:blip r:embed="rId1"/><a:stretch><a:fillRect/></a:stretch></pic:blipFill>` +
      `<pic:spPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="${emu}" cy="${emu}"/></a:xfrm>` +
      `<a:prstGeom prst="rect"><a:avLst/></a:prstGeom></pic:spPr>` +
      `</pic:pic></a:graphicData></a:graphic></wp:inline></w:drawing>`;
    body.push(para(`<w:r>${drawing}</w:r>`, { after: 120, align: "center" }));
  }

  // Name
  body.push(para(run(parsed.name || "Resume", { bold: true, size: 40, color: primary, font }), { after: 40 }));
  // Contact line
  if (parsed.contact) {
    body.push(para(run(parsed.contact, { size: 18, color: "666666", font }), { after: 160, bottomBorder: { size: 6, color: primary, space: 6 } }));
  }

  const isBullet = (raw: string) => /^[•·\-*]\s/.test(raw.trim());
  const isDate = (t: string) => (t.includes("—") || t.includes("–") || (t.includes("|") && /\d{4}/.test(t))) && t.length < 150;

  for (const sec of parsed.sections) {
    body.push(
      para(run(sec.title.toUpperCase(), { bold: true, size: 20, color: primary, caps: true, font }), {
        before: 240,
        after: 100,
        bottomBorder: { size: 4, color: accent, space: 2 },
      })
    );
    for (const raw of sec.lines) {
      const t = clean(raw);
      if (!t) continue;
      const wasBold = /^\*\*[^*]+\*\*$/.test(raw.trim());
      if (isBullet(raw)) {
        // Literal bullet with a hanging indent — renders identically everywhere
        // and stays ATS-parseable (no numbering.xml dependency).
        body.push(
          para(run("•\t" + t.replace(/^[•·\-*]\s*/, ""), { size: 21, color: "333333", font }), {
            after: 40,
            indent: { left: 360, hanging: 360 },
          })
        );
      } else if (wasBold && t.length < 70) {
        body.push(para(run(t, { bold: true, size: 22, color: "1A1A1A", font }), { before: 120, after: 20 }));
      } else if (isDate(t)) {
        body.push(para(run(t, { bold: true, size: 19, color: accent, font }), { after: 40 }));
      } else {
        body.push(para(run(t, { size: 21, color: "333333", font }), { after: 40 }));
      }
    }
  }

  // Signature
  if (opts.signature && opts.signature.trim()) {
    const cursive = opts.docFont === "dancing" || opts.docFont === "greatvibes";
    body.push(para(run(opts.signature.trim(), { size: 40, italics: true, color: primary, font: cursive ? "Segoe Script" : font }), { before: 320, after: 0 }));
    body.push(para(run("", { size: 2, font }), { bottomBorder: { size: 6, color: "CBD5E1", space: 2 } }));
  }

  // Letter page, 0.5in margins (matches the PDF export).
  const sectPr =
    `<w:sectPr><w:pgSz w:w="12240" w:h="15840"/>` +
    `<w:pgMar w:top="720" w:right="720" w:bottom="720" w:left="720" w:header="720" w:footer="720" w:gutter="0"/></w:sectPr>`;

  return (
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>` +
    `<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main" ` +
    `xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships" ` +
    `xmlns:wp="http://schemas.openxmlformats.org/drawingml/2006/wordprocessingDrawing" ` +
    `xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main">` +
    `<w:body>${body.join("")}${sectPr}</w:body></w:document>`
  );
}

// ─── Minimal store-only ZIP writer (with CRC-32) ──────────────────────────────
const CRC_TABLE = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();
function crc32(bytes: Uint8Array): number {
  let c = 0xffffffff;
  for (let i = 0; i < bytes.length; i++) c = CRC_TABLE[(c ^ bytes[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

interface ZipEntry {
  name: string;
  data: Uint8Array;
}
function zip(entries: ZipEntry[]): Uint8Array {
  const enc = new TextEncoder();
  const chunks: Uint8Array[] = [];
  const central: Uint8Array[] = [];
  let offset = 0;

  const u16 = (n: number) => new Uint8Array([n & 0xff, (n >>> 8) & 0xff]);
  const u32 = (n: number) => new Uint8Array([n & 0xff, (n >>> 8) & 0xff, (n >>> 16) & 0xff, (n >>> 24) & 0xff]);
  const cat = (...parts: Uint8Array[]) => {
    const len = parts.reduce((s, p) => s + p.length, 0);
    const out = new Uint8Array(len);
    let o = 0;
    for (const p of parts) {
      out.set(p, o);
      o += p.length;
    }
    return out;
  };

  for (const e of entries) {
    const nameBytes = enc.encode(e.name);
    const crc = crc32(e.data);
    const size = e.data.length;
    const local = cat(
      u32(0x04034b50), u16(20), u16(0), u16(0), u16(0), u16(0),
      u32(crc), u32(size), u32(size), u16(nameBytes.length), u16(0),
      nameBytes, e.data
    );
    chunks.push(local);
    central.push(
      cat(
        u32(0x02014b50), u16(20), u16(20), u16(0), u16(0), u16(0), u16(0),
        u32(crc), u32(size), u32(size), u16(nameBytes.length), u16(0), u16(0),
        u16(0), u16(0), u32(0), u32(offset), nameBytes
      )
    );
    offset += local.length;
  }

  const centralBytes = cat(...central);
  const eocd = cat(
    u32(0x06054b50), u16(0), u16(0), u16(entries.length), u16(entries.length),
    u32(centralBytes.length), u32(offset), u16(0)
  );
  return cat(...chunks, centralBytes, eocd);
}

/**
 * Generate a .docx and trigger its download, entirely in the browser.
 * Returns null on success, or an error-message string on failure.
 */
export function downloadDocx(opts: {
  text: string;
  tplId: string;
  mode: Exclude<Mode, "both">;
  title?: string;
  photo?: string;
  signature?: string;
  docFont?: string;
}): string | null {
  if (!opts.text || !opts.text.trim()) return "Nothing to export yet.";
  try {
    const enc = new TextEncoder();
    const photo = decodePhoto(opts.photo);
    const documentXml = buildDocumentXml(opts.text, opts.tplId, { photo, signature: opts.signature, docFont: opts.docFont });

    const contentTypes =
      `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>` +
      `<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">` +
      `<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>` +
      `<Default Extension="xml" ContentType="application/xml"/>` +
      (photo?.ext === "png" ? `<Default Extension="png" ContentType="image/png"/>` : "") +
      (photo?.ext === "jpg" ? `<Default Extension="jpg" ContentType="image/jpeg"/>` : "") +
      `<Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>` +
      `</Types>`;

    const rootRels =
      `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>` +
      `<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">` +
      `<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/>` +
      `</Relationships>`;

    const docRels =
      `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>` +
      `<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">` +
      (photo ? `<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/image" Target="media/photo.${photo.ext}"/>` : "") +
      `</Relationships>`;

    const entries: ZipEntry[] = [
      { name: "[Content_Types].xml", data: enc.encode(contentTypes) },
      { name: "_rels/.rels", data: enc.encode(rootRels) },
      { name: "word/document.xml", data: enc.encode(documentXml) },
      { name: "word/_rels/document.xml.rels", data: enc.encode(docRels) },
    ];
    if (photo) entries.push({ name: `word/media/photo.${photo.ext}`, data: photo.bytes });

    const bytes = zip(entries);
    // Hand Blob a plain ArrayBuffer (a valid BlobPart) — avoids the generic
    // Uint8Array<ArrayBufferLike> vs BlobPart mismatch under TS 5.7+.
    const buf = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer;
    const blob = new Blob([buf], {
      type: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = (opts.title || "resume").replace(/[^a-z0-9-_ ]/gi, "_") + ".docx";
    a.click();
    URL.revokeObjectURL(a.href);
    return null;
  } catch {
    return "Word export failed. Please try again.";
  }
}
