/**
 * Branded email-signature block appended to every employer-triggered email.
 *
 * Best-effort by design: `employerSignatureHtml` resolves the employer's saved
 * signature and renders it, and returns "" on anything missing or any error, so
 * a signature-build failure can never block a send (callers just get today's
 * default footer). `renderSignatureHtml` is a pure function, safe to unit-test.
 */
import { getEmployerProfile } from "./employer-store";
import { escapeHtml } from "./email";
import type { EmailSignature } from "./employer-ai";

/** Render a signature block from its fields. Returns "" when there is nothing
 *  meaningful to show, so an unconfigured employer keeps the default footer. */
export function renderSignatureHtml(sig: EmailSignature | null | undefined): string {
  if (!sig) return "";
  const name = (sig.displayName || "").trim();
  const title = (sig.title || "").trim();
  const phone = (sig.phone || "").trim();
  const address = (sig.address || "").trim();
  const footer = (sig.footer || "").trim();
  const logoUrl = (sig.logoUrl || "").trim();
  // A bare logo with no text isn't a useful signature; require some text.
  if (!name && !title && !phone && !address && !footer) return "";

  const lines: string[] = [];
  if (name) lines.push(`<div style="font-weight:600;color:#1a1a1a">${escapeHtml(name)}</div>`);
  if (title) lines.push(`<div style="color:#555">${escapeHtml(title)}</div>`);
  if (phone) lines.push(`<div style="color:#555">${escapeHtml(phone)}</div>`);
  if (address) lines.push(`<div style="color:#555">${escapeHtml(address)}</div>`);

  // Only trust an http(s) image URL in the src attribute.
  const safeLogo = /^https?:\/\//i.test(logoUrl) ? logoUrl : "";
  const logoCell = safeLogo
    ? `<td style="padding:0 14px 0 0;vertical-align:top"><img src="${escapeHtml(
        safeLogo
      )}" alt="" width="56" height="56" style="width:56px;height:56px;border-radius:8px;object-fit:cover;display:block"/></td>`
    : "";

  const footerLine = footer
    ? `<div style="font-size:12px;color:#888;margin-top:8px">${escapeHtml(footer)}</div>`
    : "";

  return `<div style="margin-top:24px;font-size:14px;line-height:1.45">
<table style="border-collapse:collapse"><tr>${logoCell}<td style="vertical-align:top">${lines.join("")}</td></tr></table>
${footerLine}
</div>`;
}

/** Resolve + render the employer's signature. "" on missing/unconfigured/error. */
export async function employerSignatureHtml(employerId: string): Promise<string> {
  try {
    if (!employerId) return "";
    const profile = await getEmployerProfile(employerId);
    return renderSignatureHtml(profile?.emailSignature);
  } catch {
    return "";
  }
}
