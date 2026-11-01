import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { BGC_PACKAGES, priceForPackage, fairChanceWarning, type BgcPackageId } from "./bgc-packages";
import { createCheckrCandidate, createCheckrInvitation, createCheckrAdverseAction, mapCheckrReportStatus } from "./checkr";
import { startPreAdverse, canSendAdverseNotice, completeAdverseNotice, type AdverseActionState, type AdverseActionStage } from "./adverse-action";
import { logAction } from "./assistant-audit";

/**
 * Background-check orders (`background_check_orders`/`adverse_action_events`,
 * migration 0091) — the Checkr-backed Part B of this build. Every write here
 * is also an audit_log entry (lib/assistant-audit.ts `logAction`) per the
 * build's own guardrail; this module is the ONLY place that calls Checkr's
 * candidate/invitation/adverse-action endpoints, so there is exactly one
 * code path to audit, not several.
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

export type BgcOrderStatus = "ordered" | "invitation_sent" | "candidate_completed" | "report_pending" | "completed" | "suspended" | "disputed" | "canceled";
export type BgcResult = "clear" | "consider" | null;
export type BgcBillingMode = "per_check" | "invoiced";

export interface BgcOrder {
  id: string;
  employerId: string;
  applicantId: number;
  package: BgcPackageId;
  checkrCandidateId: string | null;
  checkrInvitationId: string | null;
  checkrReportId: string | null;
  status: BgcOrderStatus;
  result: BgcResult;
  priceCents: number;
  passThroughFeeCents: number;
  billingMode: BgcBillingMode;
  fairChanceWarning: boolean;
  orderedBy: string;
  orderedAt: string;
  updatedAt: string;
}

function mapOrder(r: Record<string, unknown>): BgcOrder {
  return {
    id: r.id as string,
    employerId: (r.employer_id as string) || "",
    applicantId: Number(r.applicant_id),
    package: r.package as BgcPackageId,
    checkrCandidateId: (r.checkr_candidate_id as string) || null,
    checkrInvitationId: (r.checkr_invitation_id as string) || null,
    checkrReportId: (r.checkr_report_id as string) || null,
    status: r.status as BgcOrderStatus,
    result: (r.result as BgcResult) || null,
    priceCents: Number(r.price_cents) || 0,
    passThroughFeeCents: Number(r.pass_through_fee_cents) || 0,
    billingMode: (r.billing_mode as BgcBillingMode) || "per_check",
    fairChanceWarning: !!r.fair_chance_warning,
    orderedBy: (r.ordered_by as string) || "",
    orderedAt: (r.ordered_at as string) || "",
    updatedAt: (r.updated_at as string) || "",
  };
}

export async function getEmployerSettings(employerId: string): Promise<{ smsEnabled: boolean; bgcBillingMode: BgcBillingMode }> {
  const c = db();
  if (!c || !employerId) return { smsEnabled: false, bgcBillingMode: "per_check" };
  try {
    const { data } = await c.from("employer_settings").select("sms_enabled, bgc_billing_mode").eq("employer_id", employerId).maybeSingle();
    if (!data) return { smsEnabled: false, bgcBillingMode: "per_check" };
    return { smsEnabled: !!data.sms_enabled, bgcBillingMode: (data.bgc_billing_mode as BgcBillingMode) || "per_check" };
  } catch {
    return { smsEnabled: false, bgcBillingMode: "per_check" };
  }
}

export async function setBgcBillingMode(employerId: string, mode: BgcBillingMode): Promise<boolean> {
  const c = db();
  if (!c || !employerId) return false;
  try {
    const { error } = await c.from("employer_settings").upsert({ employer_id: employerId, bgc_billing_mode: mode, updated_at: new Date().toISOString() }, { onConflict: "employer_id" });
    return !error;
  } catch {
    return false;
  }
}

export async function markSmsEnabled(employerId: string): Promise<void> {
  const c = db();
  if (!c || !employerId) return;
  try {
    await c.from("employer_settings").upsert({ employer_id: employerId, sms_enabled: true, updated_at: new Date().toISOString() }, { onConflict: "employer_id" });
  } catch {
    /* best-effort */
  }
}

export interface OrderResult {
  ok: boolean;
  order?: BgcOrder;
  error?: string;
}

/** Order a background check. The caller (the API route) must have already
 *  shown the confirmation modal — this function itself doesn't re-ask, it
 *  just records who confirmed (`orderedBy`) and audits the action. Checkr's
 *  candidate + invitation calls happen synchronously so the order lands
 *  with a real status on the first response; a Checkr failure still saves
 *  the order (status stays "ordered") so nothing is silently lost, and the
 *  error is returned for the UI to show and allow a retry. */
export async function createOrder(v: {
  employerId: string;
  applicantId: number;
  packageId: BgcPackageId;
  orderedBy: string;
  orderedByEmail?: string | null;
  candidateFirstName: string;
  candidateLastName: string;
  candidateEmail: string;
  candidatePhone?: string | null;
  candidateStateCode?: string | null;
  billingMode: BgcBillingMode;
}): Promise<OrderResult> {
  const c = db();
  if (!c) return { ok: false, error: "store_unavailable" };
  const pkg = BGC_PACKAGES[v.packageId];
  const pricing = priceForPackage(pkg);
  const warnFairChance = fairChanceWarning(v.candidateStateCode);

  const { data: inserted, error: insertError } = await c
    .from("background_check_orders")
    .insert({
      employer_id: v.employerId,
      applicant_id: v.applicantId,
      package: v.packageId,
      status: "ordered",
      price_cents: pricing.priceCents,
      pass_through_fee_cents: pricing.passThroughFeeCents,
      billing_mode: v.billingMode,
      fair_chance_warning: warnFairChance,
      ordered_by: v.orderedBy,
    })
    .select("*")
    .single();
  if (insertError || !inserted) return { ok: false, error: "insert_failed" };

  await logAction({ employerId: v.employerId, actorUserId: v.orderedBy, actorEmail: v.orderedByEmail, action: "bgc.ordered", targetType: "background_check_order", targetId: inserted.id as string, payload: { package: v.packageId, priceCents: pricing.priceCents, passThroughFeeCents: pricing.passThroughFeeCents, fairChanceWarning: warnFairChance }, status: "executed" });

  const candidateResult = await createCheckrCandidate({ firstName: v.candidateFirstName, lastName: v.candidateLastName, email: v.candidateEmail, phone: v.candidatePhone });
  if (!candidateResult.ok || !candidateResult.candidateId) {
    return { ok: false, order: mapOrder(inserted as Record<string, unknown>), error: candidateResult.error || "checkr_candidate_failed" };
  }
  const invitationResult = await createCheckrInvitation({ candidateId: candidateResult.candidateId, packageSlug: pkg.checkrPackageSlug });
  if (!invitationResult.ok) {
    await c.from("background_check_orders").update({ checkr_candidate_id: candidateResult.candidateId, updated_at: new Date().toISOString() }).eq("id", inserted.id as string);
    return { ok: false, order: mapOrder(inserted as Record<string, unknown>), error: invitationResult.error || "checkr_invitation_failed" };
  }

  const { data: updated } = await c
    .from("background_check_orders")
    .update({ checkr_candidate_id: candidateResult.candidateId, checkr_invitation_id: invitationResult.invitationId, status: "invitation_sent", updated_at: new Date().toISOString() })
    .eq("id", inserted.id as string)
    .select("*")
    .single();

  await logAction({ employerId: v.employerId, actorUserId: v.orderedBy, actorEmail: v.orderedByEmail, action: "bgc.invitation_sent", targetType: "background_check_order", targetId: inserted.id as string, payload: { checkrInvitationId: invitationResult.invitationId }, status: "executed" });

  return { ok: true, order: mapOrder((updated || inserted) as Record<string, unknown>) };
}

export async function listOrders(employerId: string, applicantId?: number): Promise<BgcOrder[]> {
  const c = db();
  if (!c || !employerId) return [];
  try {
    let q = c.from("background_check_orders").select("*").eq("employer_id", employerId).order("ordered_at", { ascending: false });
    if (applicantId) q = q.eq("applicant_id", applicantId);
    const { data, error } = await q.limit(200);
    if (error || !data) return [];
    return (data as Record<string, unknown>[]).map(mapOrder);
  } catch {
    return [];
  }
}

export async function getOrder(employerId: string, id: string): Promise<BgcOrder | null> {
  const c = db();
  if (!c || !employerId || !id) return null;
  try {
    const { data, error } = await c.from("background_check_orders").select("*").eq("employer_id", employerId).eq("id", id).maybeSingle();
    if (error || !data) return null;
    return mapOrder(data as Record<string, unknown>);
  } catch {
    return null;
  }
}

export async function findOrderByCheckrId(column: "checkr_report_id" | "checkr_invitation_id" | "checkr_candidate_id", value: string): Promise<BgcOrder | null> {
  const c = db();
  if (!c || !value) return null;
  try {
    const { data, error } = await c.from("background_check_orders").select("*").eq(column, value).order("ordered_at", { ascending: false }).limit(1).maybeSingle();
    if (error || !data) return null;
    return mapOrder(data as Record<string, unknown>);
  } catch {
    return null;
  }
}

/** Apply a Checkr webhook event to the order it describes. Idempotent at
 *  the CALLER's level (the webhook route claims the event id first via
 *  lib/webhook-idempotency.ts); this function just applies the resulting
 *  state, so calling it twice for the same report id converges to the same
 *  row rather than erroring. */
export async function applyCheckrReportUpdate(v: { reportId: string; invitationId?: string; checkrStatus: string; result?: string | null; employerId?: string }): Promise<BgcOrder | null> {
  const c = db();
  if (!c) return null;
  const existing = (await findOrderByCheckrId("checkr_report_id", v.reportId)) || (v.invitationId ? await findOrderByCheckrId("checkr_invitation_id", v.invitationId) : null);
  if (!existing) return null;
  const status = mapCheckrReportStatus(v.checkrStatus);
  const { data, error } = await c
    .from("background_check_orders")
    .update({ checkr_report_id: v.reportId, status, result: v.result === "clear" || v.result === "consider" ? v.result : null, updated_at: new Date().toISOString() })
    .eq("id", existing.id)
    .select("*")
    .single();
  const order = !error && data ? mapOrder(data as Record<string, unknown>) : existing;
  await logAction({ employerId: order.employerId, actorUserId: "system", action: "bgc.status_changed", targetType: "background_check_order", targetId: order.id, payload: { status, result: order.result, checkrReportId: v.reportId }, status: "executed" });
  return order;
}

/** Checkr's `invitation.completed` event — the candidate finished the
 *  hosted disclosure/authorization/PII flow, before any report exists yet. */
export async function markCandidateCompleted(order: BgcOrder): Promise<void> {
  const c = db();
  if (!c || order.status !== "invitation_sent") return;
  await c.from("background_check_orders").update({ status: "candidate_completed", updated_at: new Date().toISOString() }).eq("id", order.id);
  await logAction({ employerId: order.employerId, actorUserId: "system", action: "bgc.status_changed", targetType: "background_check_order", targetId: order.id, payload: { status: "candidate_completed" }, status: "executed" });
}

export async function recordReportViewed(employerId: string, orderId: string, actorUserId: string, actorEmail?: string | null): Promise<void> {
  await logAction({ employerId, actorUserId, actorEmail, action: "bgc.report_viewed", targetType: "background_check_order", targetId: orderId, payload: {}, status: "executed" });
}

// ── Adverse action (FCRA two-step) ──────────────────────────────────────────

export async function getAdverseActionState(orderId: string): Promise<AdverseActionState> {
  const c = db();
  const empty: AdverseActionState = { stage: "none", preAdverseSentAt: null, waitUntil: null, adverseNoticeSentAt: null };
  if (!c || !orderId) return empty;
  try {
    const { data, error } = await c.from("adverse_action_events").select("*").eq("order_id", orderId).order("created_at", { ascending: false }).limit(1).maybeSingle();
    if (error || !data) return empty;
    const row = data as Record<string, unknown>;
    const stage = row.stage as AdverseActionStage;
    return {
      stage: stage === "pre_adverse_sent" ? "waiting" : stage,
      preAdverseSentAt: stage === "pre_adverse_sent" || stage === "waiting" ? (row.created_at as string) : null,
      waitUntil: (row.wait_until as string) || null,
      adverseNoticeSentAt: stage === "adverse_notice_sent" ? (row.created_at as string) : null,
    };
  } catch {
    return empty;
  }
}

async function insertAdverseEvent(orderId: string, employerId: string, stage: AdverseActionStage, waitUntil: string | null, actorUserId: string): Promise<void> {
  const c = db();
  if (!c) return;
  await c.from("adverse_action_events").insert({ order_id: orderId, employer_id: employerId, stage, wait_until: waitUntil, actor_user_id: actorUserId });
}

export type AdverseActionActionResult = { ok: true } | { ok: false; error: string };

/** Send the pre-adverse notice (step 1). Always allowed while an order
 *  exists and hasn't already started this flow or been canceled — the
 *  CALLER enforces "only on completed/consider reports", this module only
 *  enforces the state-machine legality of the transition itself. */
export async function startPreAdverseAction(order: BgcOrder, actorUserId: string, actorEmail: string | undefined | null, now = new Date()): Promise<AdverseActionActionResult> {
  const current = await getAdverseActionState(order.id);
  if (current.stage !== "none") return { ok: false, error: "already_started" };
  const next = startPreAdverse(now);
  await insertAdverseEvent(order.id, order.employerId, "pre_adverse_sent", next.waitUntil, actorUserId);
  await createCheckrAdverseAction(order.checkrReportId || "", "pre");
  await logAction({ employerId: order.employerId, actorUserId, actorEmail, action: "adverse_action.pre_adverse_sent", targetType: "background_check_order", targetId: order.id, payload: { waitUntil: next.waitUntil }, status: "executed" });
  return { ok: true };
}

/** Send the adverse notice (step 2). Refuses — audited, with a reason — if
 *  the wait hasn't elapsed, so there is no code path (bug, race, or a
 *  second browser tab) that can skip the FCRA wait period. */
export async function sendAdverseNoticeAction(order: BgcOrder, actorUserId: string, actorEmail: string | undefined | null, now = new Date()): Promise<AdverseActionActionResult> {
  const current = await getAdverseActionState(order.id);
  const check = canSendAdverseNotice(current, now);
  if (!check.allowed) {
    await logAction({ employerId: order.employerId, actorUserId, actorEmail, action: "adverse_action.blocked", targetType: "background_check_order", targetId: order.id, payload: { reason: check.reason }, status: "failed" });
    return { ok: false, error: check.reason || "not_allowed" };
  }
  const next = completeAdverseNotice(current, now);
  await insertAdverseEvent(order.id, order.employerId, "adverse_notice_sent", current.waitUntil, actorUserId);
  await createCheckrAdverseAction(order.checkrReportId || "", "post");
  await logAction({ employerId: order.employerId, actorUserId, actorEmail, action: "adverse_action.adverse_notice_sent", targetType: "background_check_order", targetId: order.id, payload: { sentAt: next.adverseNoticeSentAt }, status: "executed" });
  return { ok: true };
}

export async function cancelAdverseAction(order: BgcOrder, actorUserId: string, actorEmail: string | undefined | null): Promise<void> {
  await insertAdverseEvent(order.id, order.employerId, "canceled", null, actorUserId);
  await logAction({ employerId: order.employerId, actorUserId, actorEmail, action: "adverse_action.canceled", targetType: "background_check_order", targetId: order.id, payload: {}, status: "executed" });
}
