import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { sendEmail, emailShell, escapeHtml } from "./email";

/**
 * Welcome Email build (platform-only). New signups get exactly one welcome
 * email — candidate or employer, decided by Clerk `publicMetadata.plan` at
 * send time — and never more than one, ever. `welcome_comms` (migration
 * 0063) is the single source of truth for that: a row starts 'pending' (on
 * Clerk `user.created`, see app/api/webhooks/clerk-welcome/route.ts) and
 * `decideAndSend` is the ONLY thing that flips it to 'welcomed', via an
 * atomic `UPDATE ... WHERE state = 'pending' RETURNING *`. Three callers all
 * funnel through it — the grace scan (`runWelcomeScan`, run from the 15s
 * instrumentation.ts loop), the employer free-claim fast path
 * (app/api/employer/claim-free/route.ts), and a Clerk `user.updated`
 * delivery — and whichever reaches the database first wins; every other
 * caller's claim affects zero rows and sends nothing. There is no code path
 * that sends without first winning that claim.
 *
 * Kept free of lib/employer-notify.ts's heavier import graph (which reaches
 * lib/docusign.ts -> Node `crypto`) for the same reason lib/interview-
 * reminders.ts documents on itself: this file is reachable from
 * instrumentation.ts, which Next also tries to compile for the edge
 * runtime, and an edge bundle has no Node `crypto`. Clerk is imported
 * lazily inside a function (same pattern as lib/email.ts `resolveUserEmail`),
 * never at module scope, for the same reason.
 */

let cached: SupabaseClient | null = null;
function db(): SupabaseClient | null {
  if (cached) return cached;
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SERVICE_KEY;
  if (!url || !key) return null;
  cached = createClient(url, key, { auth: { persistSession: false } });
  return cached;
}

export type WelcomeVersion = "candidate" | "employer";

const SUPPORT_EMAIL = "support@resumetailored.com";
const CTA_BUTTON_STYLE =
  "background:#1F5C3D;color:#fff;padding:12px 28px;border-radius:6px;text-decoration:none;font-weight:600;display:inline-block";

function ctaButton(label: string, href: string): string {
  return `<p style="text-align:center;margin:28px 0"><a href="${href}" style="${CTA_BUTTON_STYLE}">${escapeHtml(label)}</a></p>`;
}

// ── Approved copy (verbatim — do not rewrite; flag to Marvin if a real problem) ──
const WELCOME_COPY: Record<WelcomeVersion, { subject: string; render: (firstName: string) => string }> = {
  candidate: {
    subject: "Welcome to ResumeTailored. Start with one job posting.",
    render: (firstName) =>
      emailShell(
        `<p>Hi ${escapeHtml(firstName)},</p>
<p>Thanks for joining ResumeTailored. Your account is ready.</p>
<p>The fastest way to see what it does: pick one job you actually want, paste the posting, and tailor your resume to it. It takes about a minute, and you will see exactly what changed and why.</p>
<p>Your free account includes unlimited resume tailoring, cover letters, and ATS scans. No credit card needed.</p>
${ctaButton("Tailor my first resume", "https://app.resumetailored.com")}
<p>Questions? Just reply to this email and we will help.</p>
<p>Welcome aboard,<br/>The ResumeTailored Team<br/>${SUPPORT_EMAIL}</p>`
      ),
  },
  employer: {
    subject: "Welcome to ResumeTailored for Employers. Your first job post is free.",
    render: (firstName) =>
      emailShell(
        `<p>Hi ${escapeHtml(firstName)},</p>
<p>Thanks for joining ResumeTailored. Your employer account is ready.</p>
<p>Your free tier covers 1 job post, up to 10 candidates, and 1 seat. Post the job, share the link, and every application lands in one place. You can rank candidates, message them, and schedule interviews without the spreadsheet chaos.</p>
${ctaButton("Post your first job", "https://app.resumetailored.com/employer")}
<p>When you outgrow free, paid plans add more jobs and seats, and our AI assistant can draft messages, schedule interviews, and keep your pipeline moving, with your approval on everything it sends.</p>
<p>Questions? Just reply to this email and we will help.</p>
<p>Welcome aboard,<br/>The ResumeTailored Team<br/>${SUPPORT_EMAIL}</p>`
      ),
  },
};

/** Clerk firstName, fallback: the email's local-part before "@". */
export function resolveFirstName(firstName: string | null | undefined, email: string | null | undefined): string {
  if (firstName && firstName.trim()) return firstName.trim();
  const local = (email || "").split("@")[0];
  return local && local.trim() ? local.trim() : "there";
}

export function renderWelcomeEmail(version: WelcomeVersion, firstName: string): { subject: string; html: string } {
  const copy = WELCOME_COPY[version];
  return { subject: copy.subject, html: copy.render(firstName) };
}

/** Clerk `user.created` handler's only job: record that this user owes a
 *  welcome email, without sending one. Check-then-insert, idempotent against
 *  a provider retry — the table's real `user_id` PRIMARY KEY is the actual
 *  safety net against a genuine race between two concurrent deliveries (same
 *  shape as lib/assistant-inbound.ts `claimInboundEventKey`'s own comment on
 *  itself); this check is just what avoids a needless duplicate-key error on
 *  the far more common case of a simple retry. */
export async function insertPendingWelcome(userId: string): Promise<void> {
  const c = db();
  if (!c || !userId) return;
  try {
    const { data: existing } = await c.from("welcome_comms").select("user_id").eq("user_id", userId).maybeSingle();
    if (existing) return;
    await c.from("welcome_comms").insert({ user_id: userId, state: "pending" });
  } catch (e) {
    console.error("[welcome-email] insertPendingWelcome failed", { userId, error: e });
  }
}

async function fetchClerkUserInfo(userId: string): Promise<{ plan?: string; firstName: string | null; email: string | null } | null> {
  try {
    const { clerkClient } = await import("@clerk/nextjs/server");
    const client = await clerkClient();
    const user = await client.users.getUser(userId);
    const plan = typeof user?.publicMetadata?.plan === "string" ? (user.publicMetadata.plan as string) : undefined;
    const email = user?.emailAddresses?.[0]?.emailAddress || null;
    return { plan, firstName: user?.firstName ?? null, email };
  } catch {
    return null;
  }
}

export interface DecideAndSendOptions {
  /** Precomputed plan — "employer" means the employer version, anything
   *  else (including undefined/missing) means candidate. Passing this (and
   *  the two hints below) skips the Clerk API round-trip entirely; omit all
   *  three to have this function fetch the user from Clerk itself (the
   *  grace-scan path). */
  planHint?: string;
  firstNameHint?: string | null;
  emailHint?: string | null;
}

export interface DecideAndSendResult {
  sent: boolean;
  version?: WelcomeVersion;
}

/** The one-send-ever enforcement point. Every caller — the grace scan, the
 *  employer free-claim fast path, and a Clerk `user.updated` delivery —
 *  calls this with just a userId (plus optional hints to skip a redundant
 *  Clerk fetch). A user already in state 'welcomed' (or with no pending row
 *  at all) makes the claiming UPDATE match zero rows, so this is a safe
 *  no-op to call repeatedly. The claim itself is unconditional on whether an
 *  email address is known — a user Clerk can't resolve still gets marked
 *  'welcomed' rather than retried forever on every future scan tick (same
 *  "stamp the marker regardless of send outcome" convention
 *  lib/interview-reminders.ts uses for the same reason). */
export async function decideAndSend(userId: string, opts: DecideAndSendOptions = {}): Promise<DecideAndSendResult> {
  const c = db();
  if (!c || !userId) return { sent: false };

  let plan = opts.planHint;
  let firstName = opts.firstNameHint;
  let email = opts.emailHint;
  if (plan === undefined || firstName === undefined || email === undefined) {
    const fetched = await fetchClerkUserInfo(userId);
    if (plan === undefined) plan = fetched?.plan;
    if (firstName === undefined) firstName = fetched?.firstName ?? null;
    if (email === undefined) email = fetched?.email ?? null;
  }
  const version: WelcomeVersion = plan === "employer" ? "employer" : "candidate";

  let claimedRows: unknown[] | null = null;
  try {
    const { data, error } = await c
      .from("welcome_comms")
      .update({ state: "welcomed", version, welcomed_at: new Date().toISOString() })
      .eq("user_id", userId)
      .eq("state", "pending")
      .select();
    claimedRows = error ? null : data;
  } catch (e) {
    console.error("[welcome-email] decideAndSend claim failed", { userId, error: e });
    return { sent: false, version };
  }
  if (!claimedRows || !claimedRows.length) return { sent: false, version };

  if (!email) return { sent: false, version };
  const { subject, html } = renderWelcomeEmail(version, resolveFirstName(firstName, email));
  await sendEmail({ to: email, subject, html, replyTo: SUPPORT_EMAIL });
  return { sent: true, version };
}

export interface WelcomeScanResult {
  scanned: number;
  sent: number;
}

/** Called from the 15s instrumentation.ts loop. Pulls every row still
 *  'pending' and age-filters in application code (rather than a `.lt()`
 *  query) — this feature's volume is "one row per new signup", so there is
 *  no query-planner reason to push the cutoff into SQL, and it keeps the
 *  logic easy to unit-test without a real Postgres. */
export async function runWelcomeScan(now: number = Date.now()): Promise<WelcomeScanResult> {
  const c = db();
  if (!c) return { scanned: 0, sent: 0 };
  const graceMinutesRaw = Number(process.env.WELCOME_GRACE_MINUTES);
  const graceMs = (Number.isFinite(graceMinutesRaw) && graceMinutesRaw >= 0 ? graceMinutesRaw : 30) * 60 * 1000;

  let rows: Array<{ user_id: string; created_at: string }> = [];
  try {
    const { data, error } = await c.from("welcome_comms").select("user_id, created_at").eq("state", "pending");
    if (error) return { scanned: 0, sent: 0 };
    rows = data || [];
  } catch (e) {
    console.error("[welcome-email] runWelcomeScan fetch failed", e);
    return { scanned: 0, sent: 0 };
  }

  const due = rows.filter((r) => now - new Date(r.created_at).getTime() >= graceMs);
  let sent = 0;
  for (const row of due) {
    try {
      const result = await decideAndSend(row.user_id);
      if (result.sent) sent++;
    } catch (e) {
      console.error("[welcome-email] decideAndSend failed during scan", { userId: row.user_id, error: e });
    }
  }
  return { scanned: due.length, sent };
}
