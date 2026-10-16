import JSZip from "jszip";

/**
 * CJK guard for the WordCraft path: WordCraft's docs list a CJK "tofu" bug, so any document with Chinese,
 * Japanese or Korean text goes to LibreOffice instead. Han (incl. extension A and the supplementary planes),
 * kana, Hangul, bopomofo, CJK punctuation and fullwidth forms.
 */
const CJK = /[　-〿぀-ヿ㄀-ㄯ㄰-㆏ㇰ-ㇿ㐀-䶿一-鿿가-힯豈-﫿＀-￯]|[\ud840-\ud87f][\udc00-\udfff]/;

export function hasCjk(text: string): boolean {
  return CJK.test(text);
}

/** Every part that carries document text (body, headers, footers, notes, comments). */
const TEXT_PART = /^word\/(document|header\d*|footer\d*|footnotes|endnotes|comments)\.xml$/;

/** True if the .docx has CJK text anywhere — or cannot be read, because then WordCraft must not be risked either. */
export async function docxHasCjk(docx: Buffer): Promise<boolean> {
  try {
    const zip = await JSZip.loadAsync(docx);
    const parts = Object.keys(zip.files).filter((n) => TEXT_PART.test(n));
    if (!parts.length) return true;
    for (const n of parts) {
      const xml = (await zip.file(n)!.async("string")).replace(/&#(x[0-9a-f]+|\d+);/gi, (_, c: string) =>
        String.fromCodePoint(c[0].toLowerCase() === "x" ? parseInt(c.slice(1), 16) : Number(c))
      );
      if (hasCjk(xml)) return true;
    }
    return false;
  } catch {
    return true;
  }
}
