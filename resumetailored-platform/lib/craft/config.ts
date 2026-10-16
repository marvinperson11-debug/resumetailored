/**
 * Craft sidecar settings (craft/README.md). Everything defaults to OFF: with no env set, no request ever
 * leaves this process for the sidecar and every export takes the LibreOffice path exactly as before.
 *
 *   CRAFT_BASE_URL       private-network URL of the sidecar, e.g. http://craft.railway.internal:8080
 *   CRAFT_SHARED_SECRET  the same value the sidecar has (>= 16 chars); sent on every call, proven back
 *   PDFCRAFT_ENABLED     kill switch for /api/craft/pdf/* (on|true|1); anything else = off -> 503
 *   WORDCRAFT_PDF_MODE   off | benchmark | pilot (default off) — see exportPdf() in lib/docs/pdf.ts
 */
export type WordCraftMode = "off" | "benchmark" | "pilot";

export function craftEndpoint(): { baseUrl: string; secret: string } | null {
  const baseUrl = (process.env.CRAFT_BASE_URL || "").trim().replace(/\/+$/, "");
  const secret = process.env.CRAFT_SHARED_SECRET || "";
  if (!/^https?:\/\//.test(baseUrl) || secret.length < 16) return null;
  return { baseUrl, secret };
}

export function pdfCraftEnabled(): boolean {
  return /^(1|true|on|yes)$/i.test((process.env.PDFCRAFT_ENABLED || "").trim());
}

/** An unknown value is treated as "off": a typo must never switch a conversion engine on. */
export function wordCraftMode(): WordCraftMode {
  const v = (process.env.WORDCRAFT_PDF_MODE || "").trim().toLowerCase();
  return v === "benchmark" || v === "pilot" ? v : "off";
}

/** The sidecar's own caps (craft/server.cjs), checked here too so an oversized upload never leaves the app. */
export const CRAFT_MAX_BYTES = 10 * 1024 * 1024;
export const CRAFT_MAX_PAGES = 10;
