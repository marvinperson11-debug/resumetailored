/**
 * Watermark policy (owner decision): free-tier exports only, as a footer line on the PDF.
 * It NEVER appears in a DOCX — free or paid — and never in a paid user's file in any format.
 * Every render goes through renderDocument() (docx-render.ts), which asks this one function,
 * so the single-run, batch and export paths cannot diverge.
 */
export type Tier = "free" | "paid";
export type Target = "docx" | "pdf";

export const WATERMARK_TEXT = "Made with ResumeTailored · resumetailored.com";

export function shouldWatermark(tier: Tier, target: Target): boolean {
  return tier === "free" && target === "pdf";
}
