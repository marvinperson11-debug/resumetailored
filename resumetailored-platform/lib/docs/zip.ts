import JSZip from "jszip";

/** A folder-safe path segment: letters, digits, dashes; spaces become nothing (EmployerName_PositionTitle). */
export function safeSegment(s: string): string {
  const out = (s || "")
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/&/g, "And")
    .replace(/[^A-Za-z0-9]+/g, " ")
    .trim()
    .split(" ")
    .filter(Boolean)
    .map((w) => w[0].toUpperCase() + w.slice(1))
    .join("");
  return out.slice(0, 60) || "Untitled";
}

export interface ZipItem {
  employer: string;
  position: string;
  resume?: Buffer | Uint8Array;
  coverLetter?: Buffer | Uint8Array;
}

/** `EmployerName_PositionTitle/{Resume.docx, CoverLetter.docx}` per vacancy; duplicates get _2, _3… */
export async function buildBatchZip(items: ZipItem[], notes: string[] = []): Promise<Buffer> {
  const zip = new JSZip();
  const used = new Map<string, number>();
  for (const it of items) {
    if (!it.resume && !it.coverLetter) continue;
    const base = `${safeSegment(it.employer)}_${safeSegment(it.position)}`;
    const n = (used.get(base) || 0) + 1;
    used.set(base, n);
    const dir = n === 1 ? base : `${base}_${n}`;
    if (it.resume) zip.file(`${dir}/Resume.docx`, it.resume);
    if (it.coverLetter) zip.file(`${dir}/CoverLetter.docx`, it.coverLetter);
  }
  if (notes.length) zip.file("_REVIEW_REQUIRED.txt", notes.join("\n") + "\n");
  return zip.generateAsync({ type: "nodebuffer", compression: "DEFLATE" });
}
