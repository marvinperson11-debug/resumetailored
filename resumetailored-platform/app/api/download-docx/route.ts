import { NextResponse } from "next/server";
import { auth } from "@clerk/nextjs/server";
import {
  Document,
  Packer,
  Paragraph,
  TextRun,
  ImageRun,
  AlignmentType,
  BorderStyle,
  type ISpacingProperties,
} from "docx";
import { findTemplate, parseAIOutput, type Mode } from "@/lib/resume-templates";

export const runtime = "nodejs";
export const maxDuration = 30;

/**
 * Word (.docx) export (FIX 3). A template-aware approximation of the on-screen
 * resume: the template's primary colour drives the name + section headers, the
 * chosen body font is applied throughout, and the photo + signature are
 * included. It reuses the same `parseAIOutput` the HTML renderer uses, so the
 * section structure matches the preview. Word has no way to reproduce every CSS
 * layout (sidebars, columns), so this is a clean single-column document — the
 * PDF remains the pixel-faithful export; see the on-screen disclaimer.
 */
const WORD_FONT: Record<string, string> = {
  arial: "Arial",
  helvetica: "Arial",
  calibri: "Calibri",
  times: "Times New Roman",
  georgia: "Georgia",
  garamond: "Garamond",
  cambria: "Cambria",
};

function clean(raw: string): string {
  return raw
    .replace(/^#{1,3}\s+/, "")
    .replace(/\*\*(.*?)\*\*/g, "$1")
    .replace(/\*(.*?)\*/g, "$1")
    .trim();
}

const hex = (c: string) => c.replace(/^#/, "");

export async function POST(req: Request) {
  const { userId } = await auth();
  if (!userId) return NextResponse.json({ error: "not_signed_in" }, { status: 401 });

  const body = (await req.json().catch(() => ({}))) as {
    text?: string;
    tplId?: string;
    mode?: Mode;
    title?: string;
    photo?: string;
    signature?: string;
    docFont?: string;
  };
  const { text, tplId = "r1", photo, signature } = body;
  if (!text || !text.trim()) return NextResponse.json({ error: "Nothing to export." }, { status: 400 });

  const tpl = findTemplate("resume", tplId);
  const font = WORD_FONT[body.docFont || ""] || (tpl.serif ? "Georgia" : "Arial");
  const primary = hex(tpl.c.p);
  const accent = hex(tpl.c.a);

  const children: Paragraph[] = [];

  // Photo (optional) — a square thumbnail, centered. Word can't circle-crop
  // without pre-processing, so we insert it square (approximation).
  if (photo) {
    const m = /^data:image\/(png|jpe?g|webp);base64,(.+)$/i.exec(photo);
    if (m) {
      try {
        const data = Buffer.from(m[2], "base64");
        const type = m[1].toLowerCase().startsWith("jp") ? "jpg" : m[1].toLowerCase() === "webp" ? "png" : (m[1].toLowerCase() as "png");
        children.push(
          new Paragraph({
            alignment: AlignmentType.CENTER,
            spacing: { after: 120 },
            children: [
              new ImageRun({
                // docx v9 requires an explicit type; webp isn't supported so we
                // best-effort tag it png (most webp headshots still embed fine).
                type: type === "jpg" ? "jpg" : "png",
                data,
                transformation: { width: 96, height: 96 },
              }),
            ],
          })
        );
      } catch {
        /* skip photo on any decode error */
      }
    }
  }

  const parsed = parseAIOutput(text);

  // Name
  children.push(
    new Paragraph({
      spacing: { after: 40 },
      children: [new TextRun({ text: parsed.name || "Resume", bold: true, size: 40, color: primary, font })],
    })
  );
  // Contact line
  if (parsed.contact) {
    children.push(
      new Paragraph({
        spacing: { after: 160 },
        border: { bottom: { style: BorderStyle.SINGLE, size: 6, color: primary, space: 6 } },
        children: [new TextRun({ text: parsed.contact, size: 18, color: "666666", font })],
      })
    );
  }

  const isBullet = (raw: string) => /^[•·\-*]\s/.test(raw.trim());
  const isDate = (t: string) => (t.includes("—") || t.includes("–") || (t.includes("|") && /\d{4}/.test(t))) && t.length < 150;

  for (const sec of parsed.sections) {
    children.push(
      new Paragraph({
        spacing: { before: 240, after: 100 },
        border: { bottom: { style: BorderStyle.SINGLE, size: 4, color: accent, space: 2 } },
        children: [
          new TextRun({ text: sec.title.toUpperCase(), bold: true, size: 20, color: primary, font, allCaps: true }),
        ],
      })
    );
    for (const raw of sec.lines) {
      const t = clean(raw);
      if (!t) continue;
      const wasBold = /^\*\*[^*]+\*\*$/.test(raw.trim());
      const spacing: ISpacingProperties = { after: 40 };
      if (isBullet(raw)) {
        children.push(
          new Paragraph({
            bullet: { level: 0 },
            spacing,
            children: [new TextRun({ text: t.replace(/^[•·\-*]\s*/, ""), size: 21, color: "333333", font })],
          })
        );
      } else if (wasBold && t.length < 70) {
        children.push(new Paragraph({ spacing: { before: 120, after: 20 }, children: [new TextRun({ text: t, bold: true, size: 22, color: "1A1A1A", font })] }));
      } else if (isDate(t)) {
        children.push(new Paragraph({ spacing, children: [new TextRun({ text: t, bold: true, size: 19, color: accent, font })] }));
      } else {
        children.push(new Paragraph({ spacing, children: [new TextRun({ text: t, size: 21, color: "333333", font })] }));
      }
    }
  }

  // Signature (optional) — script-style if a cursive font was chosen.
  if (signature && signature.trim()) {
    const cursive = body.docFont === "dancing" || body.docFont === "greatvibes";
    children.push(
      new Paragraph({
        spacing: { before: 320, after: 0 },
        children: [
          new TextRun({ text: signature.trim(), size: 40, italics: true, color: primary, font: cursive ? "Segoe Script" : font }),
        ],
      })
    );
    children.push(
      new Paragraph({
        border: { bottom: { style: BorderStyle.SINGLE, size: 6, color: "CBD5E1", space: 2 } },
        children: [new TextRun({ text: "", size: 2 })],
      })
    );
  }

  const doc = new Document({
    styles: { default: { document: { run: { font } } } },
    sections: [{ properties: {}, children }],
  });

  const buffer = await Packer.toBuffer(doc);
  const safe = (body.title || "resume").replace(/[^a-z0-9-_ ]/gi, "_");
  return new NextResponse(new Uint8Array(buffer), {
    status: 200,
    headers: {
      "Content-Type": "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
      "Content-Disposition": `attachment; filename="${safe}.docx"`,
    },
  });
}
