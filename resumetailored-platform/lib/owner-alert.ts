import { sendEmail, escapeHtml } from "./email";

/**
 * Owner activity alerts for the platform app — the same pattern as notifyOwner() in the legacy server.js:
 * fire-and-forget, never throws into the request, silenced with OWNER_ALERTS=off, sent TO `OWNER_EMAIL`
 * (default support@resumetailored.com) FROM a distinct `alerts@` address on the sending domain (a From that
 * is a Gmail "send mail as" alias of the recipient is silently dropped from the inbox — see server.js).
 */
export function ownerAlertFrom(env: Record<string, string | undefined> = process.env): string {
  if (env.OWNER_ALERT_FROM) return env.OWNER_ALERT_FROM;
  const base = env.RESEND_FROM || "ResumeTailored <noreply@resumetailored.com>";
  const addr = (/<([^>]+)>/.exec(base)?.[1] || base).trim();
  const domain = addr.includes("@") ? addr.split("@").pop() : "resumetailored.com";
  return `ResumeTailored Alerts <alerts@${domain}>`;
}

export function ownerEmail(env: Record<string, string | undefined> = process.env): string {
  return env.OWNER_EMAIL || "support@resumetailored.com";
}

export async function notifyOwner(subject: string, html: string): Promise<boolean> {
  if (process.env.OWNER_ALERTS === "off") return false;
  try {
    const stamp = `<p style="color:#888;font-size:12px;">Time: ${new Date().toUTCString()}</p>`;
    return await sendEmail({ to: ownerEmail(), from: ownerAlertFrom(), subject, html: html + stamp });
  } catch (e) {
    console.error("[Alert] Owner notification failed:", e instanceof Error ? e.message : e);
    return false;
  }
}

/** 12345 → "12,345" (owner emails are always English; avoids a hard-coded locale). */
const num = (n: number) => String(n).replace(/\B(?=(\d{3})+(?!\d))/g, ",");
const row = (k: string, v: string) => `<tr><td style="padding:2px 12px 2px 0;color:#666">${escapeHtml(k)}</td><td style="padding:2px 0"><strong>${escapeHtml(v)}</strong></td></tr>`;

/** Characters of narration → ElevenLabs credits (1 credit per character on eleven_multilingual_v2; Flash/Turbo models are half). */
export function elevenLabsCredits(chars: number, modelId?: string): number {
  const half = /flash|turbo/i.test(modelId || "");
  return Math.ceil(chars * (half ? 0.5 : 1));
}

export function videoGeneratedAlert(a: { email: string | null; planLabel: string; credits: number; usedThisMonth: number | null; limit: number | null; narrated: boolean; test?: boolean }) {
  const used = a.usedThisMonth === null ? "—" : a.limit === null ? `${a.usedThisMonth}` : `${a.usedThisMonth} of ${a.limit}`;
  return {
    subject: `${a.test ? "[TEST] " : ""}🎬 Resume Video generated — ${a.email || "unknown user"} (${num(a.credits)} ElevenLabs credits)`,
    html: `<h3>${a.test ? "TEST — " : ""}Resume Video generated</h3><table>${row("User", a.email || "(email unavailable)")}${row("Plan", a.planLabel)}${row("ElevenLabs credits used", a.narrated ? num(a.credits) : "0 (no narration)")}${row("Videos this month", used)}</table>`,
  };
}

export function elevenLabsFailureAlert(a: { email: string | null; reason: string; status: number; detail: string; test?: boolean }) {
  return {
    subject: `${a.test ? "[TEST] " : ""}⚠️ ElevenLabs voiceover failed (${a.reason}) — check credits / API key`,
    html: `<h3>${a.test ? "TEST — " : ""}ElevenLabs voiceover failed</h3><table>${row("Reason", a.reason)}${row("HTTP status", String(a.status))}${row("User", a.email || "(email unavailable)")}</table><p style="font-size:13px;color:#444">ElevenLabs said: ${escapeHtml(a.detail.slice(0, 400))}</p><p style="font-size:13px;color:#444">Members cannot get narration until this is fixed (their videos render without a voiceover).</p>`,
  };
}

/** Classify an ElevenLabs error response. Returns null for errors that aren't about credits / the account / the key. */
export function classifyElevenLabsError(status: number, bodyText: string): { reason: "insufficient_credits" | "auth" | "voice_permission"; detail: string } | null {
  let detail = bodyText;
  let code = "";
  try {
    const j = JSON.parse(bodyText) as { detail?: { status?: string; message?: string } | string };
    if (j.detail && typeof j.detail === "object") { code = j.detail.status || ""; detail = j.detail.message || bodyText; }
    else if (typeof j.detail === "string") detail = j.detail;
  } catch { /* not JSON */ }
  const hay = `${code} ${detail}`.toLowerCase();
  if (/quota|credit|character limit|exceeds your/.test(hay)) return { reason: "insufficient_credits", detail: `${code} ${detail}`.trim() };
  if (status === 401 || /invalid_api_key|unauthor/.test(hay)) return { reason: "auth", detail: `${code} ${detail}`.trim() };
  if (status === 402 || /payment_required|paid_plan|voice_not_found|permission/.test(hay)) return { reason: "voice_permission", detail: `${code} ${detail}`.trim() };
  return null;
}

// At most one failure alert per reason per window, so a credits outage doesn't send one email per attempt.
const lastFailureAlert = new Map<string, number>();
export const FAILURE_ALERT_WINDOW_MS = 15 * 60 * 1000;
export function shouldSendFailureAlert(reason: string, now = Date.now()): boolean {
  const last = lastFailureAlert.get(reason) ?? 0;
  if (now - last < FAILURE_ALERT_WINDOW_MS) return false;
  lastFailureAlert.set(reason, now);
  return true;
}
