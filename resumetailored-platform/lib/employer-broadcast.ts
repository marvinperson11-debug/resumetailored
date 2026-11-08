import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { resolveUserEmail, sendEmail, emailShell } from "./email";

/**
 * One-off admin broadcast to real outside employers about Taylor (the AI
 * hiring assistant). Reads `employer_profiles` directly with a service-role
 * client (same construction as lib/employer-store.ts's `db()`), excludes the
 * known test/admin orgs by exact company name, and sends one email per
 * remaining recipient.
 */
let cached: SupabaseClient | null = null;
function db(): SupabaseClient | null {
  if (cached) return cached;
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SERVICE_KEY;
  if (!url || !key) return null;
  cached = createClient(url, key, {
    auth: { persistSession: false },
    global: { fetch: (input, init) => fetch(input, { ...init, cache: "no-store" }) },
  });
  return cached;
}

// Exact company names to exclude — test/admin orgs, never real outside employers.
const EXCLUDED_COMPANY_NAMES = new Set<string>([
  "TEST Company", // welcome-flow test account
  "Twin Test Co", // owner's test org
  "Walmart", // owner's own admin org
  "Résumé Taylor", // Taylor demo/test org
]);

export interface BroadcastRecipient {
  company: string;
  userId: string;
  email: string;
}

export interface BroadcastSkip {
  company: string;
  userId: string;
  reason: string;
}

export async function listEmployerBroadcastRecipients(): Promise<{
  recipients: BroadcastRecipient[];
  skipped: BroadcastSkip[];
}> {
  const c = db();
  if (!c) return { recipients: [], skipped: [] };

  const { data, error } = await c
    .from("employer_profiles")
    .select("user_id, company_name")
    .order("company_name");
  if (error || !data) return { recipients: [], skipped: [] };

  const recipients: BroadcastRecipient[] = [];
  const skipped: BroadcastSkip[] = [];
  for (const row of data) {
    const userId = row.user_id as string;
    const company = (row.company_name as string) || "";
    if (EXCLUDED_COMPANY_NAMES.has(company)) continue;
    const email = await resolveUserEmail(userId);
    if (!email) {
      skipped.push({ company, userId, reason: "no_email" });
      continue;
    }
    recipients.push({ company, userId, email });
  }
  return { recipients, skipped };
}

export const EMPLOYER_BROADCAST_SUBJECT = "Meet Taylor, your AI hiring assistant";

function broadcastHtml(): string {
  const body = `<p>Hi there,</p>
<p>We added an AI assistant to ResumeTailored for employers. Her name is Taylor, and she lives inside your hiring dashboard.</p>
<p>You can ask her in plain words to post a job, rank your applicants, draft a message to a candidate, or set up an interview. She does the busywork. You make the calls.</p>
<p>If you are on the free plan, you can open your dashboard and try her out. Paid plans let her do more for you.</p>
<p>Give her a try here: <a href="https://app.resumetailored.com/employer">Open your dashboard</a></p>
<p>Thanks,<br/>The ResumeTailored team<br/>support@resumetailored.com</p>
<p>Don't want these updates? Just reply and let us know, and we'll take you off the list.</p>`;
  return emailShell(body);
}

export interface BroadcastSendResult {
  sent: number;
  failed: Array<{ company: string; reason: string }>;
  errors: string[];
}

export async function sendTaylorBroadcast(recipients: BroadcastRecipient[]): Promise<BroadcastSendResult> {
  let sent = 0;
  const failed: Array<{ company: string; reason: string }> = [];
  const errors: string[] = [];
  const html = broadcastHtml();

  for (const r of recipients) {
    try {
      const ok = await sendEmail({
        to: r.email,
        subject: EMPLOYER_BROADCAST_SUBJECT,
        html,
        replyTo: "support@resumetailored.com",
      });
      if (ok) {
        sent++;
      } else {
        failed.push({ company: r.company, reason: "send_failed" });
      }
    } catch (e) {
      const reason = e instanceof Error ? e.message : "unknown_error";
      failed.push({ company: r.company, reason });
      errors.push(`${r.company}: ${reason}`);
    }
    // Small delay to stay within Resend rate limits (same pacing as the legacy broadcast).
    await new Promise((resolve) => setTimeout(resolve, 120));
  }

  return { sent, failed, errors };
}
