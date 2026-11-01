import { createClient, type SupabaseClient } from "@supabase/supabase-js";

/**
 * SMS conversations/messages store (`sms_conversations`/`sms_messages`,
 * migration 0090) + the per-org number (`sms_numbers`, migration 0089).
 * Pure data access — the send/queue/metering decisions live in
 * lib/sms-send.ts, which calls into this module rather than the other way
 * around.
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

export type MessageDirection = "outbound" | "inbound";
export type MessageStatus = "queued" | "sending" | "sent" | "delivered" | "failed" | "received";
export type QueueReason = "cap" | "quiet_hours";

export interface SmsConversation {
  id: string;
  employerId: string;
  applicantId: number;
  phoneNormalized: string;
  lastMessageAt: string | null;
  unreadCount: number;
  createdAt: string;
}

export interface SmsMessage {
  id: string;
  conversationId: string;
  employerId: string;
  direction: MessageDirection;
  body: string;
  segments: number;
  status: MessageStatus;
  queueReason: QueueReason | null;
  providerMessageSid: string | null;
  actorUserId: string | null;
  scheduledAt: string | null;
  sentAt: string | null;
  deliveredAt: string | null;
  failedReason: string | null;
  createdAt: string;
}

function mapConversation(r: Record<string, unknown>): SmsConversation {
  return {
    id: r.id as string,
    employerId: (r.employer_id as string) || "",
    applicantId: Number(r.applicant_id),
    phoneNormalized: (r.phone_normalized as string) || "",
    lastMessageAt: (r.last_message_at as string) || null,
    unreadCount: Number(r.unread_count) || 0,
    createdAt: (r.created_at as string) || "",
  };
}

function mapMessage(r: Record<string, unknown>): SmsMessage {
  return {
    id: r.id as string,
    conversationId: r.conversation_id as string,
    employerId: (r.employer_id as string) || "",
    direction: r.direction as MessageDirection,
    body: (r.body as string) || "",
    segments: Number(r.segments) || 1,
    status: r.status as MessageStatus,
    queueReason: (r.queue_reason as QueueReason) || null,
    providerMessageSid: (r.provider_message_sid as string) || null,
    actorUserId: (r.actor_user_id as string) || null,
    scheduledAt: (r.scheduled_at as string) || null,
    sentAt: (r.sent_at as string) || null,
    deliveredAt: (r.delivered_at as string) || null,
    failedReason: (r.failed_reason as string) || null,
    createdAt: (r.created_at as string) || "",
  };
}

export async function getSmsNumber(employerId: string): Promise<{ phoneNumber: string; status: string } | null> {
  const c = db();
  if (!c || !employerId) return null;
  try {
    const { data, error } = await c.from("sms_numbers").select("phone_number, status").eq("employer_id", employerId).maybeSingle();
    if (error || !data) return null;
    return { phoneNumber: data.phone_number as string, status: data.status as string };
  } catch {
    return null;
  }
}

export async function saveSmsNumber(employerId: string, phoneNumber: string, twilioSid: string): Promise<boolean> {
  const c = db();
  if (!c || !employerId) return false;
  try {
    const { error } = await c.from("sms_numbers").upsert({ employer_id: employerId, phone_number: phoneNumber, twilio_sid: twilioSid, status: "active" }, { onConflict: "employer_id" });
    return !error;
  } catch {
    return false;
  }
}

/** Which org owns a given Twilio number — resolves the inbound webhook's
 *  `To` address back to an employer. */
export async function employerIdForNumber(phoneNumber: string): Promise<string | null> {
  const c = db();
  if (!c || !phoneNumber) return null;
  try {
    const { data, error } = await c.from("sms_numbers").select("employer_id").eq("phone_number", phoneNumber).maybeSingle();
    if (error || !data) return null;
    return data.employer_id as string;
  } catch {
    return null;
  }
}

export async function getOrCreateConversation(employerId: string, applicantId: number, phoneNormalized: string): Promise<SmsConversation | null> {
  const c = db();
  if (!c || !employerId || !Number.isFinite(applicantId) || !phoneNormalized) return null;
  try {
    const { data: existing } = await c.from("sms_conversations").select("*").eq("employer_id", employerId).eq("applicant_id", applicantId).maybeSingle();
    if (existing) return mapConversation(existing as Record<string, unknown>);
    const { data, error } = await c
      .from("sms_conversations")
      .insert({ employer_id: employerId, applicant_id: applicantId, phone_normalized: phoneNormalized })
      .select("*")
      .single();
    if (error || !data) {
      // A concurrent request may have won the unique(employer_id, applicant_id) race.
      const { data: retry } = await c.from("sms_conversations").select("*").eq("employer_id", employerId).eq("applicant_id", applicantId).maybeSingle();
      return retry ? mapConversation(retry as Record<string, unknown>) : null;
    }
    return mapConversation(data as Record<string, unknown>);
  } catch (e) {
    console.error("[sms-store] getOrCreateConversation threw", e);
    return null;
  }
}

export async function listConversations(employerId: string): Promise<SmsConversation[]> {
  const c = db();
  if (!c || !employerId) return [];
  try {
    const { data, error } = await c.from("sms_conversations").select("*").eq("employer_id", employerId).order("last_message_at", { ascending: false }).limit(200);
    if (error || !data) return [];
    return (data as Record<string, unknown>[]).map(mapConversation);
  } catch {
    return [];
  }
}

/** Read-only lookup, unlike getOrCreateConversation — viewing a candidate's
 *  profile must never create a thread; only sending the first message does. */
export async function getConversationByApplicant(employerId: string, applicantId: number): Promise<SmsConversation | null> {
  const c = db();
  if (!c || !employerId || !Number.isFinite(applicantId)) return null;
  try {
    const { data, error } = await c.from("sms_conversations").select("*").eq("employer_id", employerId).eq("applicant_id", applicantId).maybeSingle();
    if (error || !data) return null;
    return mapConversation(data as Record<string, unknown>);
  } catch {
    return null;
  }
}

export async function getConversation(employerId: string, id: string): Promise<SmsConversation | null> {
  const c = db();
  if (!c || !employerId || !id) return null;
  try {
    const { data, error } = await c.from("sms_conversations").select("*").eq("employer_id", employerId).eq("id", id).maybeSingle();
    if (error || !data) return null;
    return mapConversation(data as Record<string, unknown>);
  } catch {
    return null;
  }
}

export async function listMessages(conversationId: string, limit = 200): Promise<SmsMessage[]> {
  const c = db();
  if (!c || !conversationId) return [];
  try {
    const { data, error } = await c.from("sms_messages").select("*").eq("conversation_id", conversationId).order("created_at", { ascending: true }).limit(limit);
    if (error || !data) return [];
    return (data as Record<string, unknown>[]).map(mapMessage);
  } catch {
    return [];
  }
}

export async function markConversationRead(employerId: string, id: string): Promise<void> {
  const c = db();
  if (!c || !employerId || !id) return;
  try {
    await c.from("sms_conversations").update({ unread_count: 0 }).eq("employer_id", employerId).eq("id", id);
  } catch {
    /* best-effort */
  }
}

async function touchConversation(c: SupabaseClient, conversationId: string, bumpUnread: boolean): Promise<void> {
  if (bumpUnread) {
    const { data } = await c.from("sms_conversations").select("unread_count").eq("id", conversationId).maybeSingle();
    const current = Number(data?.unread_count) || 0;
    await c.from("sms_conversations").update({ last_message_at: new Date().toISOString(), unread_count: current + 1 }).eq("id", conversationId);
  } else {
    await c.from("sms_conversations").update({ last_message_at: new Date().toISOString() }).eq("id", conversationId);
  }
}

export interface CreateMessageInput {
  conversationId: string;
  employerId: string;
  direction: MessageDirection;
  body: string;
  segments: number;
  status: MessageStatus;
  queueReason?: QueueReason | null;
  providerMessageSid?: string | null;
  actorUserId?: string | null;
  scheduledAt?: string | null;
}

export async function createMessage(v: CreateMessageInput): Promise<SmsMessage | null> {
  const c = db();
  if (!c) return null;
  try {
    const now = new Date().toISOString();
    const { data, error } = await c
      .from("sms_messages")
      .insert({
        conversation_id: v.conversationId,
        employer_id: v.employerId,
        direction: v.direction,
        body: v.body,
        segments: v.segments,
        status: v.status,
        queue_reason: v.queueReason || null,
        provider_message_sid: v.providerMessageSid || null,
        actor_user_id: v.actorUserId || null,
        scheduled_at: v.scheduledAt || null,
        sent_at: v.status === "sent" || v.status === "delivered" ? now : null,
      })
      .select("*")
      .single();
    if (error || !data) return null;
    await touchConversation(c, v.conversationId, v.direction === "inbound");
    return mapMessage(data as Record<string, unknown>);
  } catch (e) {
    console.error("[sms-store] createMessage threw", e);
    return null;
  }
}

export async function updateMessageStatus(id: string, status: MessageStatus, extra: { failedReason?: string; deliveredAt?: string } = {}): Promise<void> {
  const c = db();
  if (!c || !id) return;
  try {
    const patch: Record<string, unknown> = { status };
    if (extra.failedReason) patch.failed_reason = extra.failedReason;
    if (extra.deliveredAt) patch.delivered_at = extra.deliveredAt;
    if (status === "sent" && !patch.sent_at) patch.sent_at = new Date().toISOString();
    await c.from("sms_messages").update(patch).eq("id", id);
  } catch (e) {
    console.error("[sms-store] updateMessageStatus threw", e);
  }
}

export async function findMessageBySid(sid: string): Promise<SmsMessage | null> {
  const c = db();
  if (!c || !sid) return null;
  try {
    const { data, error } = await c.from("sms_messages").select("*").eq("provider_message_sid", sid).maybeSingle();
    if (error || !data) return null;
    return mapMessage(data as Record<string, unknown>);
  } catch {
    return null;
  }
}

/** Every message currently queued (cap or quiet-hours), across every org —
 *  the in-process flush scan (lib/sms-queue-flush.ts) reads this list and
 *  decides per-row whether it can send now. */
export async function listQueuedMessages(limit = 500): Promise<SmsMessage[]> {
  const c = db();
  if (!c) return [];
  try {
    const { data, error } = await c.from("sms_messages").select("*").eq("status", "queued").order("created_at", { ascending: true }).limit(limit);
    if (error || !data) return [];
    return (data as Record<string, unknown>[]).map(mapMessage);
  } catch {
    return [];
  }
}
